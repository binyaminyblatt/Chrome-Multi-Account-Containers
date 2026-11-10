// Background Service Worker for Chrome Multi-Account Containers (Firefox-Style + Security Hardened)
// Provides:
// 1. Registrable-Domain (eTLD+1) Cookie Isolation with Multi-Window & Real-Time Sync
// 2. AES-256-GCM Encryption at Rest for Stored Cookie Jars (Web Crypto API)
// 3. Network-Level Background Tab Cookie-Leak Prevention (declarativeNetRequest Session Rules)
// 4. Hardened Per-Container Web Storage Isolation (localStorage, sessionStorage, IndexedDB, CacheStorage, BroadcastChannel + about:blank iframe protection)
// 5. Firefox-Style Context Menus, Toolbar Badge, Top Colored Stripe & Tab Group Management

// --- Constants & Defaults ---
const DEFAULT_CONTAINERS = {
    "default": { name: "Default", color: "grey", icon: "circle" },
    "personal": { name: "Personal", color: "blue", icon: "fingerprint" },
    "work": { name: "Work", color: "orange", icon: "briefcase" },
    "banking": { name: "Banking", color: "green", icon: "dollar" },
    "shopping": { name: "Shopping", color: "pink", icon: "cart" }
};

const COLOR_HEX_MAP = {
    "blue": "#37adff",
    "navy": "#1e40af",
    "sky": "#38bdf8",
    "teal": "#00cbb0",
    "mint": "#10b981",
    "green": "#2cbe4e",
    "lime": "#84cc16",
    "yellow": "#eab308",
    "amber": "#f59e0b",
    "orange": "#ff9400",
    "coral": "#fb7185",
    "red": "#ff0039",
    "crimson": "#be123c",
    "pink": "#ff4bda",
    "magenta": "#d946ef",
    "purple": "#af51f5",
    "indigo": "#6366f1",
    "slate": "#475569",
    "grey": "#8f8f9d"
};

const MULTI_PART_TLDS = new Set([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au",
    "co.nz", "org.nz", "govt.nz",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
    "co.il", "org.il", "ac.il", "gov.il",
    "co.in", "net.in", "org.in", "gov.in", "ac.in",
    "com.br", "org.br", "gov.br", "edu.br",
    "co.za", "org.za", "gov.za",
    "com.sg", "edu.sg", "gov.sg",
    "com.hk", "org.hk", "edu.hk", "gov.hk",
    "com.mx", "org.mx", "gob.mx",
    "com.tr", "org.tr", "gov.tr", "edu.tr",
    "co.kr", "or.kr", "go.kr", "ac.kr",
    "com.tw", "org.tw", "gov.tw", "edu.tw",
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "com.ar", "org.ar", "gov.ar"
]);

// --- In-Memory State Cache (Synced with chrome.storage.local) ---
let stateLoaded = false;
let containersCache = { ...DEFAULT_CONTAINERS };
let tabContainerCache = {};
let siteContainerCache = {};
let managedSiteCache = {};
let enterpriseFlagsCache = {
    disableTemporaryContainers: false,
    allowUserContainers: true
};
let domainOwnerCache = {};
let cachedCryptoKey = null;
const tabSiteExemptionCache = new Map();

// Serialize all cookie-swap and storage-map updates to prevent race conditions
let operationQueue = Promise.resolve();
function enqueueOperation(fn) {
    const next = operationQueue.then(async () => {
        await ensureStateLoaded();
        return fn();
    }).catch(err => {
        console.error("[Container Queue Error]", err);
    });
    operationQueue = next;
    return next;
}

async function ensureStateLoaded() {
    if (stateLoaded) return;
    const data = await chrome.storage.local.get([
        "containers",
        "tabContainerMap",
        "siteContainerMap",
        "managedSiteMap",
        "enterpriseFlags",
        "domainOwnerMap"
    ]);
    containersCache = data.containers || { ...DEFAULT_CONTAINERS };
    if (!containersCache.default) {
        containersCache.default = { ...DEFAULT_CONTAINERS.default };
    }
    tabContainerCache = data.tabContainerMap || {};
    siteContainerCache = data.siteContainerMap || {};
    managedSiteCache = data.managedSiteMap || {};
    if (data.enterpriseFlags) {
        enterpriseFlagsCache = data.enterpriseFlags;
    }
    domainOwnerCache = data.domainOwnerMap || {};
    stateLoaded = true;
    await syncManagedEnterprisePolicies();
    await reconcileTabsWithGroups();
}

/**
 * Synchronizes enterprise policies from chrome.storage.managed (GPO / ADMX / MDM / Google Admin).
 * Enforces policy-defined containers, site assignments, and feature flags.
 */
async function syncManagedEnterprisePolicies() {
    if (!chrome.storage.managed) return;
    try {
        const managed = await chrome.storage.managed.get(null).catch(() => ({}));
        if (!managed || Object.keys(managed).length === 0) return;

        let updatedContainers = false;
        const nextManagedSites = {};

        // 1. Sync enterprise containers
        if (Array.isArray(managed.containers)) {
            for (const c of managed.containers) {
                if (c && c.id && c.name && c.id !== "default") {
                    containersCache[c.id] = {
                        name: String(c.name),
                        color: c.color || "blue",
                        icon: c.icon || "shield",
                        isolated: Boolean(c.isolated),
                        managed: true
                    };
                    updatedContainers = true;
                }
            }
        }

        // 2. Sync enterprise site assignments
        if (Array.isArray(managed.siteAssignments)) {
            for (const rule of managed.siteAssignments) {
                if (rule && rule.domain && rule.containerId) {
                    const cleanPattern = String(rule.domain).trim().toLowerCase();
                    nextManagedSites[cleanPattern] = String(rule.containerId);
                    siteContainerCache[cleanPattern] = String(rule.containerId);
                }
            }
        }

        // 3. Sync enterprise restriction flags
        enterpriseFlagsCache = {
            disableTemporaryContainers: Boolean(managed.disableTemporaryContainers),
            allowUserContainers: managed.allowUserContainers !== false
        };

        managedSiteCache = nextManagedSites;

        await chrome.storage.local.set({
            containers: containersCache,
            siteContainerMap: siteContainerCache,
            managedSiteMap: managedSiteCache,
            enterpriseFlags: enterpriseFlagsCache
        });

        if (updatedContainers) {
            await rebuildContextMenus();
        }
    } catch (e) {
        console.warn("[Enterprise Policy] Sync skipped:", e.message);
    }
}

/**
 * Reconciles open Chrome tabs with their Tab Groups on browser startup or service worker wakeup.
 * - Removes stale tab IDs from previous browser sessions.
 * - Re-links restored tabs ("Continue where you left off") to their container by matching Tab Group title.
 */
async function reconcileTabsWithGroups() {
    try {
        const [allTabs, allGroups] = await Promise.all([
            chrome.tabs.query({}),
            chrome.tabGroups.query({})
        ]);

        const groupById = new Map();
        for (const grp of allGroups) {
            groupById.set(grp.id, grp);
        }

        // Map container names (lowercase) to container IDs
        const nameToContainerId = new Map();
        for (const [cId, cInfo] of Object.entries(containersCache)) {
            if (cInfo && cInfo.name) {
                nameToContainerId.set(cInfo.name.trim().toLowerCase(), cId);
            }
        }

        const openTabIds = new Set();
        let changed = false;

        for (const tab of allTabs) {
            if (!tab.id) continue;
            openTabIds.add(String(tab.id));

            if (!tabContainerCache[tab.id] && tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                if (isExcludedInternalOrFileUrl(tab.url)) {
                    await chrome.tabs.ungroup(tab.id).catch(() => {});
                    continue;
                }
                const grp = groupById.get(tab.groupId);
                if (grp && grp.title) {
                    const matchedId = nameToContainerId.get(grp.title.trim().toLowerCase());
                    if (matchedId && matchedId !== "default") {
                        tabContainerCache[tab.id] = matchedId;
                        changed = true;
                    }
                }
            } else if (tabContainerCache[tab.id] && isExcludedInternalOrFileUrl(tab.url)) {
                delete tabContainerCache[tab.id];
                changed = true;
                if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    await chrome.tabs.ungroup(tab.id).catch(() => {});
                }
            }
        }

        // Prune closed/stale tab IDs from previous sessions
        for (const cachedTabId of Object.keys(tabContainerCache)) {
            if (!openTabIds.has(String(cachedTabId))) {
                delete tabContainerCache[cachedTabId];
                changed = true;
            }
        }

        if (changed) {
            await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
        }

        for (const tab of allTabs) {
            if (tab.id) {
                await updateTabBadge(tab.id);
            }
        }
    } catch (e) {
        console.warn("[Reconcile] Could not reconcile tab groups:", e.message);
    }
}

/**
 * Detects OAuth / SSO flows or child popup windows so "Always Open This Site in..."
 * does not hijack a "Sign in with Google/Microsoft/GitHub" flow initiated from another container.
 */
function isOAuthOrChildPopupFlow(urlObj, currentContainer, tabId) {
    if (currentContainer === "default") return false;

    // 1. Check standard OAuth 2.0 / OIDC / SAML query parameters and paths
    const params = urlObj.searchParams;
    if (
        params.has("client_id") ||
        params.has("redirect_uri") ||
        params.has("response_type") ||
        params.has("code_challenge") ||
        params.has("SAMLRequest") ||
        /\/(oauth2?|authorize|sso|saml|login\/oauth)\b/i.test(urlObj.pathname)
    ) {
        return true;
    }

    // 2. Check if this tab was spawned as a child popup from a non-default container tab
    if (tabSiteExemptionCache.get(tabId) === "__CHILD_POPUP__") {
        return true;
    }

    return false;
}

/**
 * Matches a hostname against exact domain rules, base domain rules, and wildcard patterns (e.g. *.corp.com).
 * Enterprise managed rules take precedence over user rules.
 */
function matchSiteRule(hostname, baseDomain, ruleMap) {
    if (!ruleMap) return null;
    if (ruleMap[hostname]) return ruleMap[hostname];
    if (ruleMap[baseDomain]) return ruleMap[baseDomain];

    for (const [pattern, targetId] of Object.entries(ruleMap)) {
        if (pattern.startsWith("*.")) {
            const suffix = pattern.slice(2);
            if (hostname === suffix || hostname.endsWith("." + suffix)) {
                return targetId;
            }
        }
    }
    return null;
}

/**
 * Determines if a navigation should be redirected to another container based on:
 * 1. Enterprise & User "Always Open This Site in..." assignment (including *.wildcard rules)
 * 2. Strict Container Mode ("Limit to Designated Sites" — container.isolated === true)
 */
function resolveTargetContainerForNavigation(hostname, baseDomain, currentContainer, urlObj, tabId) {
    const exemptedDomain = tabSiteExemptionCache.get(tabId);
    if (exemptedDomain === baseDomain || isOAuthOrChildPopupFlow(urlObj, currentContainer, tabId)) {
        return null;
    }

    const assignedContainer =
        matchSiteRule(hostname, baseDomain, managedSiteCache) ||
        matchSiteRule(hostname, baseDomain, siteContainerCache);

    if (assignedContainer && assignedContainer !== currentContainer) {
        return assignedContainer;
    }

    // Check if the current container has "Limit to Designated Sites" enabled
    const currentContainerObj = containersCache[currentContainer];
    if (currentContainer !== "default" && currentContainerObj && currentContainerObj.isolated) {
        const hasDesignatedSites =
            Object.values(managedSiteCache).some(cId => cId === currentContainer) ||
            Object.values(siteContainerCache).some(cId => cId === currentContainer);
        if (hasDesignatedSites && assignedContainer !== currentContainer) {
            return assignedContainer || "default";
        }
    }

    return null;
}

// Keep in-memory cache synchronized when popup/manage pages or enterprise policies update
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "managed") {
        enqueueOperation(() => syncManagedEnterprisePolicies());
        return;
    }
    if (areaName !== "local") return;
    if (changes.containers) {
        containersCache = changes.containers.newValue || { ...DEFAULT_CONTAINERS };
        rebuildContextMenus();
    }
    if (changes.tabContainerMap) {
        tabContainerCache = changes.tabContainerMap.newValue || {};
    }
    if (changes.siteContainerMap) {
        siteContainerCache = changes.siteContainerMap.newValue || {};
    }
    if (changes.managedSiteMap) {
        managedSiteCache = changes.managedSiteMap.newValue || {};
    }
    if (changes.enterpriseFlags) {
        enterpriseFlagsCache = changes.enterpriseFlags.newValue || enterpriseFlagsCache;
    }
    if (changes.domainOwnerMap) {
        domainOwnerCache = changes.domainOwnerMap.newValue || {};
    }
});

// --- AES-256-GCM Cookie Encryption at Rest ---

function uint8ToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function getOrCreateCryptoKey() {
    if (cachedCryptoKey) return cachedCryptoKey;

    const stored = await chrome.storage.local.get("__mac_vault_key_jwk__");
    if (stored.__mac_vault_key_jwk__) {
        try {
            cachedCryptoKey = await crypto.subtle.importKey(
                "jwk",
                stored.__mac_vault_key_jwk__,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
            );
            return cachedCryptoKey;
        } catch (e) {
            console.warn("[Crypto] Failed to import existing key, regenerating:", e.message);
        }
    }

    const newKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const exportedJwk = await crypto.subtle.exportKey("jwk", newKey);
    await chrome.storage.local.set({ __mac_vault_key_jwk__: exportedJwk });

    cachedCryptoKey = await crypto.subtle.importKey(
        "jwk",
        exportedJwk,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    return cachedCryptoKey;
}

async function encryptCookieList(cookies) {
    const key = await getOrCreateCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(cookies));
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoded
    );
    return {
        __encrypted__: true,
        v: 1,
        iv: uint8ToBase64(iv),
        data: uint8ToBase64(new Uint8Array(cipherBuffer))
    };
}

async function decryptCookieList(storedValue) {
    if (!storedValue) return [];
    // Backwards compatibility with any pre-existing unencrypted array
    if (Array.isArray(storedValue)) return storedValue;
    if (!storedValue.__encrypted__ || !storedValue.iv || !storedValue.data) return [];

    try {
        const key = await getOrCreateCryptoKey();
        const iv = base64ToUint8(storedValue.iv);
        const cipherBytes = base64ToUint8(storedValue.data);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            cipherBytes
        );
        const jsonStr = new TextDecoder().decode(plainBuffer);
        const parsed = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn("[Crypto] Failed to decrypt cookie jar:", e.message);
        return [];
    }
}

// --- Network-Layer Background Tab Cookie Isolation (declarativeNetRequest) ---
// Blocks inactive background tabs in other containers from sending or overwriting
// the active container's cookies for a domain.

async function syncDnrSessionRules() {
    if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return;

    try {
        const [existingRules, allTabs] = await Promise.all([
            chrome.declarativeNetRequest.getSessionRules(),
            chrome.tabs.query({})
        ]);

        const removeRuleIds = existingRules.map(r => r.id);
        const addRules = [];
        let nextRuleId = 1;

        for (const [baseDomain, ownerContainerId] of Object.entries(domainOwnerCache)) {
            if (!baseDomain) continue;

            // Find all open tabs that do NOT belong to the container that currently owns `baseDomain`
            const nonOwnerTabIds = [];
            for (const tab of allTabs) {
                if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) continue;
                const tabContainer = tabContainerCache[tab.id] || "default";
                if (tabContainer !== ownerContainerId) {
                    nonOwnerTabIds.push(tab.id);
                }
            }

            if (nonOwnerTabIds.length > 0) {
                addRules.push({
                    id: nextRuleId++,
                    priority: 1,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: [{ header: "cookie", operation: "remove" }],
                        responseHeaders: [{ header: "set-cookie", operation: "remove" }]
                    },
                    condition: {
                        requestDomains: [baseDomain],
                        tabIds: nonOwnerTabIds
                    }
                });
            }
        }

        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds,
            addRules
        });
    } catch (e) {
        console.warn("[DNR Sync] Failed to update session rules:", e.message);
    }
}

// --- Helpers ---

function getBaseDomain(hostname) {
    if (!hostname) return "";
    const clean = hostname.toLowerCase().replace(/^\.+|\.+$/g, "");

    if (clean === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(clean) || clean.includes(":")) {
        return clean;
    }

    const parts = clean.split(".");
    if (parts.length <= 2) {
        return clean;
    }

    const lastTwo = parts.slice(-2).join(".");
    if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join(".");
    }

    return lastTwo;
}

function isHttpUrl(urlString) {
    return Boolean(urlString && (urlString.startsWith("http://") || urlString.startsWith("https://")));
}

function isNewTabUrl(urlString) {
    if (!urlString) return false;
    return (
        urlString.startsWith("chrome://newtab") ||
        urlString.startsWith("edge://newtab") ||
        urlString === "about:blank" ||
        urlString === "about:newtab"
    );
}

/**
 * Returns true for chrome:// (except newtab), file://, chrome-extension://, etc.
 * Tabs navigating to these URLs are automatically removed from containers.
 */
function isExcludedInternalOrFileUrl(urlString) {
    if (!urlString) return false;
    if (isHttpUrl(urlString) || isNewTabUrl(urlString)) return false;
    return (
        urlString.startsWith("chrome://") ||
        urlString.startsWith("file://") ||
        urlString.startsWith("chrome-extension://") ||
        urlString.startsWith("devtools://") ||
        urlString.startsWith("edge://") ||
        urlString.startsWith("view-source:")
    );
}

function resolveColorHex(color) {
    if (!color) return "#37adff";
    if (COLOR_HEX_MAP[color]) return COLOR_HEX_MAP[color];
    if (color.startsWith("#")) return color;
    return "#37adff";
}

function getChromeColor(color) {
    const colorMap = {
        "blue": "blue",
        "navy": "blue",
        "sky": "cyan",
        "teal": "cyan",
        "mint": "green",
        "green": "green",
        "lime": "green",
        "yellow": "yellow",
        "amber": "orange",
        "orange": "orange",
        "coral": "red",
        "red": "red",
        "crimson": "red",
        "pink": "pink",
        "magenta": "pink",
        "purple": "purple",
        "indigo": "purple",
        "slate": "grey",
        "grey": "grey"
    };
    if (colorMap[color]) return colorMap[color];

    // If custom #RRGGBB hex color, find the closest Chrome TabGroup color by RGB distance
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const palette = [
            { name: "blue", rgb: [55, 173, 255] },
            { name: "cyan", rgb: [0, 203, 176] },
            { name: "green", rgb: [44, 190, 78] },
            { name: "yellow", rgb: [234, 179, 8] },
            { name: "orange", rgb: [255, 148, 0] },
            { name: "red", rgb: [255, 0, 57] },
            { name: "pink", rgb: [255, 75, 218] },
            { name: "purple", rgb: [175, 81, 245] },
            { name: "grey", rgb: [143, 143, 157] }
        ];
        let best = "blue";
        let bestDist = Infinity;
        for (const p of palette) {
            const dist = (r - p.rgb[0]) ** 2 + (g - p.rgb[1]) ** 2 + (b - p.rgb[2]) ** 2;
            if (dist < bestDist) {
                bestDist = dist;
                best = p.name;
            }
        }
        return best;
    }

    return "grey";
}

// --- Initialization & Context Menus ---

chrome.runtime.onInstalled.addListener(() => {
    enqueueOperation(async () => {
        const data = await chrome.storage.local.get([
            "containers",
            "tabContainerMap",
            "domainOwnerMap",
            "siteContainerMap"
        ]);
        const updates = {};
        if (!data.containers) {
            updates.containers = DEFAULT_CONTAINERS;
            containersCache = { ...DEFAULT_CONTAINERS };
        } else if (!data.containers.default) {
            updates.containers = { default: DEFAULT_CONTAINERS.default, ...data.containers };
            containersCache = updates.containers;
        }
        if (!data.tabContainerMap) updates.tabContainerMap = {};
        if (!data.domainOwnerMap) updates.domainOwnerMap = {};
        if (!data.siteContainerMap) updates.siteContainerMap = {};

        if (Object.keys(updates).length > 0) {
            await chrome.storage.local.set(updates);
        }
        await getOrCreateCryptoKey();
        await rebuildContextMenus();
        await syncDnrSessionRules();
    });
});

chrome.runtime.onStartup.addListener(() => {
    enqueueOperation(async () => {
        await getOrCreateCryptoKey();
        await rebuildContextMenus();
        await syncDnrSessionRules();
    });
});

async function rebuildContextMenus() {
    await ensureStateLoaded();
    await new Promise(resolve => chrome.contextMenus.removeAll(resolve));

    chrome.contextMenus.create({
        id: "open-link-in-container-parent",
        title: "Open Link in New Container Tab",
        contexts: ["link"],
        targetUrlPatterns: ["http://*/*", "https://*/*"]
    });

    chrome.contextMenus.create({
        id: "duplicate-tab-in-container-parent",
        title: "Duplicate This Tab in Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });

    chrome.contextMenus.create({
        id: "split-tab-in-container-parent",
        title: "Split View This Tab in Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });

    chrome.contextMenus.create({
        id: "reopen-tab-in-container-parent",
        title: "Reopen This Tab in Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });

    chrome.contextMenus.create({
        id: "action-open-container-parent",
        title: "Open New Tab in Container",
        contexts: ["action"]
    });

    const orderedEntries = [
        ...(containersCache.default ? [["default", containersCache.default]] : []),
        ...Object.entries(containersCache).filter(([id]) => id !== "default")
    ];

    // Quick Temporary Container items at the top of each submenu
    chrome.contextMenus.create({
        id: "action-new-tab:__TEMP__",
        parentId: "action-open-container-parent",
        title: "🔥 New Temporary Container",
        contexts: ["action"]
    });
    chrome.contextMenus.create({
        id: "open-link:__TEMP__",
        parentId: "open-link-in-container-parent",
        title: "🔥 New Temporary Container",
        contexts: ["link"],
        targetUrlPatterns: ["http://*/*", "https://*/*"]
    });
    chrome.contextMenus.create({
        id: "duplicate-tab:__TEMP__",
        parentId: "duplicate-tab-in-container-parent",
        title: "🔥 New Temporary Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
    chrome.contextMenus.create({
        id: "split-tab:__TEMP__",
        parentId: "split-tab-in-container-parent",
        title: "🔥 New Temporary Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
    chrome.contextMenus.create({
        id: "reopen-tab:__TEMP__",
        parentId: "reopen-tab-in-container-parent",
        title: "🔥 New Temporary Container",
        contexts: ["page", "frame"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
    });

    for (const [id, container] of orderedEntries) {
        chrome.contextMenus.create({
            id: `action-new-tab:${id}`,
            parentId: "action-open-container-parent",
            title: container.name,
            contexts: ["action"]
        });

        chrome.contextMenus.create({
            id: `open-link:${id}`,
            parentId: "open-link-in-container-parent",
            title: container.name,
            contexts: ["link"],
            targetUrlPatterns: ["http://*/*", "https://*/*"]
        });

        chrome.contextMenus.create({
            id: `duplicate-tab:${id}`,
            parentId: "duplicate-tab-in-container-parent",
            title: container.name,
            contexts: ["page", "frame"],
            documentUrlPatterns: ["http://*/*", "https://*/*"]
        });

        chrome.contextMenus.create({
            id: `split-tab:${id}`,
            parentId: "split-tab-in-container-parent",
            title: container.name,
            contexts: ["page", "frame"],
            documentUrlPatterns: ["http://*/*", "https://*/*"]
        });

        chrome.contextMenus.create({
            id: `reopen-tab:${id}`,
            parentId: "reopen-tab-in-container-parent",
            title: container.name,
            contexts: ["page", "frame"],
            documentUrlPatterns: ["http://*/*", "https://*/*"]
        });
    }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    const resolveContainerOrTemp = async (rawId) => {
        if (rawId === "__TEMP__") {
            return await createTemporaryContainer();
        }
        return rawId;
    };

    if (info.menuItemId.startsWith("action-new-tab:")) {
        const rawId = info.menuItemId.slice("action-new-tab:".length);
        enqueueOperation(async () => {
            const containerId = await resolveContainerOrTemp(rawId);
            await createContainerTab(containerId, "chrome://newtab", null, false);
        });
    } else if (info.menuItemId.startsWith("open-link:")) {
        const rawId = info.menuItemId.slice("open-link:".length);
        if (info.linkUrl) {
            enqueueOperation(async () => {
                const containerId = await resolveContainerOrTemp(rawId);
                await createContainerTab(containerId, info.linkUrl, null, true);
            });
        }
    } else if (info.menuItemId.startsWith("duplicate-tab:")) {
        const rawId = info.menuItemId.slice("duplicate-tab:".length);
        if (tab && tab.id) {
            enqueueOperation(async () => {
                const containerId = await resolveContainerOrTemp(rawId);
                await createContainerTab(containerId, tab.url || "chrome://newtab", null, true);
            });
        }
    } else if (info.menuItemId.startsWith("split-tab:")) {
        const rawId = info.menuItemId.slice("split-tab:".length);
        if (tab && tab.id) {
            enqueueOperation(async () => {
                const containerId = await resolveContainerOrTemp(rawId);
                await createSplitViewContainerTab(containerId, tab.url || "chrome://newtab", tab);
            });
        }
    } else if (info.menuItemId.startsWith("reopen-tab:")) {
        const rawId = info.menuItemId.slice("reopen-tab:".length);
        if (tab && tab.id) {
            enqueueOperation(async () => {
                const containerId = await resolveContainerOrTemp(rawId);
                await createContainerTab(containerId, tab.url || "chrome://newtab", tab.id, true);
            });
        }
    }
});

// --- Keyboard Shortcuts (chrome.commands) ---

if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener((command) => {
        enqueueOperation(async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
            const activeTab = tabs[0];

            if (command === "open-temp-container") {
                const tempId = await createTemporaryContainer();
                await createContainerTab(tempId, "chrome://newtab", null, false);
            } else if (command === "reopen-in-temp-container" && activeTab && isHttpUrl(activeTab.url)) {
                const tempId = await createTemporaryContainer();
                await createContainerTab(tempId, activeTab.url, activeTab.id, true);
            } else if (command === "duplicate-in-temp-container" && activeTab && isHttpUrl(activeTab.url)) {
                const tempId = await createTemporaryContainer();
                await createContainerTab(tempId, activeTab.url, null, true);
            }
        });
    });
}

// --- Per-Tab Extension Action Badge ---

async function updateTabBadge(tabId) {
    if (!tabId) return;
    await ensureStateLoaded();
    const containerId = tabContainerCache[tabId] || "default";
    const container = containersCache[containerId];

    if (!container || containerId === "default") {
        await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
        await chrome.action.setTitle({ tabId, title: "Chrome Multi-Account Containers (Default)" }).catch(() => {});
        return;
    }

    const badgeChar = container.name ? container.name.trim().charAt(0).toUpperCase() : "C";
    const badgeColor = resolveColorHex(container.color);

    await chrome.action.setBadgeText({ tabId, text: badgeChar }).catch(() => {});
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor }).catch(() => {});
    await chrome.action.setTitle({
        tabId,
        title: `Container: ${container.name}`
    }).catch(() => {});
}

// --- Message API for Popup & Manage UI ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "OPEN_CONTAINER_TAB") {
        enqueueOperation(() => createContainerTab(
            message.containerId,
            message.url,
            message.closeTabId,
            Boolean(message.exemptSite)
        ))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "SPLIT_VIEW_CONTAINER_TAB") {
        enqueueOperation(async () => {
            const sourceTab = message.sourceTabId
                ? await chrome.tabs.get(message.sourceTabId).catch(() => null)
                : null;
            await createSplitViewContainerTab(message.containerId, message.url, sourceTab);
        })
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "PANE_INTERACTION") {
        if (sender.tab && sender.tab.id && isHttpUrl(sender.tab.url)) {
            enqueueOperation(async () => {
                await updateTabBadge(sender.tab.id);
                const parsed = new URL(sender.tab.url);
                const baseDomain = getBaseDomain(parsed.hostname);
                if (baseDomain) {
                    const containerId = tabContainerCache[sender.tab.id] || "default";
                    await ensureDomainCookiesSwapped(baseDomain, containerId);
                }
            }).then(() => sendResponse({ ok: true }));
            return true;
        }
        sendResponse({ ok: false });
        return false;
    }

    if (message.type === "DELETE_CONTAINER") {
        enqueueOperation(() => deleteContainerAndCleanup(message.containerId))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "CLEAR_CONTAINER_DATA") {
        enqueueOperation(() => clearContainerData(message.containerId))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "TOGGLE_CONTAINER_VISIBILITY") {
        enqueueOperation(() => toggleContainerGroupCollapse(message.containerId, message.windowId))
            .then((collapsed) => sendResponse({ ok: true, collapsed }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "CLOSE_CONTAINER_TABS") {
        enqueueOperation(() => closeContainerTabs(message.containerId))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "OPEN_TEMP_CONTAINER_TAB") {
        enqueueOperation(async () => {
            const tempId = await createTemporaryContainer();
            if (message.splitView) {
                const sourceTab = message.sourceTabId
                    ? await chrome.tabs.get(message.sourceTabId).catch(() => null)
                    : null;
                await createSplitViewContainerTab(tempId, message.url || "chrome://newtab", sourceTab);
            } else {
                await createContainerTab(
                    tempId,
                    message.url || "chrome://newtab",
                    message.closeTabId || null,
                    Boolean(message.exemptSite)
                );
            }
        })
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "MOVE_CONTAINER_TO_WINDOW") {
        enqueueOperation(() => moveContainerToNewWindow(message.containerId))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }

    if (message.type === "CLEAR_SITE_IN_CONTAINER") {
        enqueueOperation(() => clearSiteInContainer(message.tabId, message.url, message.containerId))
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
    }
});

// --- Container Tab Creation, Hiding, Closing & Deletion ---

let internalTabCreateCount = 0;
let tempCounter = 1;

async function createTemporaryContainer() {
    const tempColors = ["blue", "teal", "green", "orange", "coral", "red", "pink", "purple", "indigo"];
    const randomColor = tempColors[Math.floor(Math.random() * tempColors.length)];
    const existingTempNums = Object.values(containersCache)
        .filter(c => c && c.temporary && /^Temp #(\d+)$/.test(c.name))
        .map(c => parseInt(c.name.replace("Temp #", ""), 10));
    while (existingTempNums.includes(tempCounter)) {
        tempCounter++;
    }

    const id = `temp-${Date.now()}-${tempCounter}`;
    containersCache[id] = {
        name: `Temp #${tempCounter++}`,
        color: randomColor,
        icon: "fire",
        temporary: true
    };
    await chrome.storage.local.set({ containers: containersCache });
    return id;
}

async function cleanupIfEmptyTempContainer(containerId) {
    if (!containerId || containerId === "default") return;
    const container = containersCache[containerId];
    if (!container || !container.temporary) return;

    const stillHasTabs = Object.values(tabContainerCache).some(cId => cId === containerId);
    if (!stillHasTabs) {
        console.log(`[TempContainer] Auto-destroying empty temporary container: ${container.name}`);
        await deleteContainerAndCleanup(containerId);
    }
}

async function moveContainerToNewWindow(containerId) {
    if (!containerId || containerId === "default") return;
    const tabIds = Object.entries(tabContainerCache)
        .filter(([, cId]) => cId === containerId)
        .map(([tId]) => Number(tId));

    if (tabIds.length === 0) return;

    const newWin = await chrome.windows.create({
        tabId: tabIds[0],
        focused: true
    });

    if (tabIds.length > 1 && newWin && newWin.id) {
        await chrome.tabs.move(tabIds.slice(1), { windowId: newWin.id, index: -1 }).catch(() => {});
    }

    for (const tId of tabIds) {
        await groupTab(tId, containerId);
    }
}

async function createContainerTab(containerId, url = "chrome://newtab", closeTabId = null, exemptSite = false) {
    // Never open chrome:// (except newtab) or file:// URLs inside a container
    if (isExcludedInternalOrFileUrl(url)) {
        url = "chrome://newtab";
    }
    let baseDomain = "";
    if (isHttpUrl(url)) {
        try {
            const parsed = new URL(url);
            baseDomain = getBaseDomain(parsed.hostname);
            if (baseDomain) {
                await ensureDomainCookiesSwapped(baseDomain, containerId);
            }
        } catch (e) {
            console.warn("[CreateTab] Invalid URL:", e.message);
        }
    }

    internalTabCreateCount++;
    let newTab;
    try {
        newTab = await chrome.tabs.create({ url: "about:blank", active: false });
        tabContainerCache[newTab.id] = containerId;
    } finally {
        internalTabCreateCount--;
    }
    if (exemptSite && baseDomain) {
        tabSiteExemptionCache.set(newTab.id, baseDomain);
    }
    await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
    await syncDnrSessionRules();

    await groupTab(newTab.id, containerId);
    await updateTabBadge(newTab.id);
    await chrome.tabs.update(newTab.id, { url: url, active: true });

    if (closeTabId) {
        await chrome.tabs.remove(closeTabId).catch(() => {});
    }
}

/**
 * Tiles the current window on the left half of the display and opens a new window
 * on the right half with the target container tab for side-by-side Split View.
 */
async function createSplitViewContainerTab(containerId, url = "chrome://newtab", sourceTab = null) {
    if (isExcludedInternalOrFileUrl(url)) {
        url = "chrome://newtab";
    }
    let baseDomain = "";
    if (isHttpUrl(url)) {
        try {
            const parsed = new URL(url);
            baseDomain = getBaseDomain(parsed.hostname);
            if (baseDomain) {
                await ensureDomainCookiesSwapped(baseDomain, containerId);
            }
        } catch (e) {}
    }

    const currentWin = sourceTab?.windowId
        ? await chrome.windows.get(sourceTab.windowId).catch(() => null)
        : await chrome.windows.getCurrent().catch(() => null);

    // Determine screen bounds from the current window
    const winLeft = currentWin?.left ?? 0;
    const winTop = currentWin?.top ?? 0;
    const totalWidth = Math.max((currentWin?.width ?? 1400), 1000);
    const totalHeight = Math.max((currentWin?.height ?? 850), 600);
    const halfWidth = Math.max(Math.floor(totalWidth / 2), 500);

    if (currentWin && currentWin.id) {
        await chrome.windows.update(currentWin.id, {
            state: "normal",
            left: winLeft,
            top: winTop,
            width: halfWidth,
            height: totalHeight
        }).catch(() => {});
    }

    // Create the new window on the right half
    internalTabCreateCount++;
    let rightWin;
    try {
        rightWin = await chrome.windows.create({
            url: "about:blank",
            type: "normal",
            left: winLeft + halfWidth,
            top: winTop,
            width: halfWidth,
            height: totalHeight,
            focused: true
        });
        const createdTab = rightWin.tabs && rightWin.tabs[0];
        if (createdTab && createdTab.id) {
            tabContainerCache[createdTab.id] = containerId;
        }
    } finally {
        internalTabCreateCount--;
    }

    const newTab = rightWin.tabs && rightWin.tabs[0];
    if (!newTab || !newTab.id) return;
    if (baseDomain) {
        tabSiteExemptionCache.set(newTab.id, baseDomain);
    }
    await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
    await syncDnrSessionRules();

    await groupTab(newTab.id, containerId);
    await updateTabBadge(newTab.id);
    await chrome.tabs.update(newTab.id, { url: url, active: true });
}

async function toggleContainerGroupCollapse(containerId, windowId) {
    const container = containersCache[containerId];
    if (!container || containerId === "default") return false;

    const queryInfo = { title: container.name };
    if (windowId) queryInfo.windowId = windowId;

    const groups = await chrome.tabGroups.query(queryInfo);
    if (groups.length === 0) return false;

    const newCollapsed = !groups[0].collapsed;
    for (const grp of groups) {
        await chrome.tabGroups.update(grp.id, { collapsed: newCollapsed });
    }
    return newCollapsed;
}

async function closeContainerTabs(containerId) {
    const tabIdsToClose = Object.entries(tabContainerCache)
        .filter(([, cId]) => cId === containerId)
        .map(([tId]) => Number(tId));

    if (tabIdsToClose.length > 0) {
        await chrome.tabs.remove(tabIdsToClose).catch(() => {});
    }
}

async function clearContainerData(containerId) {
    // Never clear the Default container's cookies/storage to prevent accidental data loss
    if (!containerId || containerId === "default") return;
    const allData = await chrome.storage.local.get(null);

    for (const [domain, owner] of Object.entries(domainOwnerCache)) {
        if (owner === containerId) {
            await clearDomainCookies(domain);
            if (containerId !== "default") {
                await restoreDomainCookies(domain, "default");
                domainOwnerCache[domain] = "default";
            }
        }
    }

    const keysToRemove = Object.keys(allData).filter(k => k.startsWith(`cookies_${containerId}_`));
    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
    }
    await chrome.storage.local.set({ domainOwnerMap: domainOwnerCache });
    await syncDnrSessionRules();

    const openTabs = await chrome.tabs.query({});
    for (const t of openTabs) {
        const tContainer = tabContainerCache[t.id] || "default";
        if (tContainer === containerId && isHttpUrl(t.url)) {
            await chrome.scripting.executeScript({
                target: { tabId: t.id },
                world: "MAIN",
                func: () => {
                    try { window.localStorage.clear(); } catch (e) {}
                    try { window.sessionStorage.clear(); } catch (e) {}
                }
            }).catch(() => {});
        }
    }
}

async function clearSiteInContainer(tabId, urlString, containerId) {
    if (!isHttpUrl(urlString)) return;
    const parsed = new URL(urlString);
    const baseDomain = getBaseDomain(parsed.hostname);
    if (!baseDomain) return;

    const targetContainer = containerId || (tabId ? tabContainerCache[tabId] : null) || "default";

    // 1. If this container currently owns the domain's live browser cookies, clear them
    if ((domainOwnerCache[baseDomain] || "default") === targetContainer) {
        await clearDomainCookies(baseDomain);
    }

    // 2. Remove the saved cookie snapshot for this specific (container, domain) pair
    await chrome.storage.local.remove(`cookies_${targetContainer}_${baseDomain}`);

    // 3. Clear isolated localStorage & sessionStorage in the active tab and reload it
    if (tabId) {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
                try { window.localStorage.clear(); } catch (e) {}
                try { window.sessionStorage.clear(); } catch (e) {}
            }
        }).catch(() => {});
        await chrome.tabs.reload(tabId).catch(() => {});
    }
}

async function deleteContainerAndCleanup(containerId) {
    if (!containerId || containerId === "default") return;
    // Prevent deleting enterprise policy-enforced containers
    if (containersCache[containerId]?.managed) return;

    await clearContainerData(containerId);
    delete containersCache[containerId];

    for (const [tabId, cId] of Object.entries(tabContainerCache)) {
        if (cId === containerId) {
            delete tabContainerCache[tabId];
        }
    }

    for (const [site, cId] of Object.entries(siteContainerCache)) {
        if (cId === containerId) {
            delete siteContainerCache[site];
        }
    }

    await chrome.storage.local.set({
        containers: containersCache,
        tabContainerMap: tabContainerCache,
        siteContainerMap: siteContainerCache,
        domainOwnerMap: domainOwnerCache
    });
    await syncDnrSessionRules();
}

// --- Hardened Per-Page Web Storage & Channel Isolation ---

function installPageIsolation(containerId, containerName, containerColorHex) {
    const isDefault = containerId === "default";
    const prefix = isDefault ? "" : `__mac_${containerId}__:`;

    function belongsToContainer(rawKey) {
        if (typeof rawKey !== "string") return false;
        if (isDefault) {
            return !rawKey.startsWith("__mac_");
        }
        return rawKey.startsWith(prefix);
    }

    function toExternalKey(rawKey) {
        return isDefault ? rawKey : rawKey.slice(prefix.length);
    }

    function toInternalKey(extKey) {
        const str = String(extKey);
        if (!isDefault && str.startsWith(prefix)) return str;
        return prefix + str;
    }

    function patchWindowContext(win) {
        if (!win || win.__mac_isolated_container__ === containerId) return;
        win.__mac_isolated_container__ = containerId;

        // 1. Harden Storage.prototype directly so even raw Storage references or about:blank iframes cannot bypass the namespace
        try {
            const StorageProto = win.Storage && win.Storage.prototype;
            if (StorageProto && !StorageProto.__mac_proto_patched__) {
                const origGetItem = StorageProto.getItem;
                const origSetItem = StorageProto.setItem;
                const origRemoveItem = StorageProto.removeItem;
                const origClear = StorageProto.clear;
                const origKey = StorageProto.key;
                const origLengthDesc = Object.getOwnPropertyDescriptor(StorageProto, "length");

                const getFilteredKeys = (storageInstance) => {
                    const keys = [];
                    const total = origLengthDesc && origLengthDesc.get
                        ? origLengthDesc.get.call(storageInstance)
                        : 0;
                    for (let i = 0; i < total; i++) {
                        const k = origKey.call(storageInstance, i);
                        if (belongsToContainer(k)) {
                            keys.push(toExternalKey(k));
                        }
                    }
                    return keys;
                };

                StorageProto.getItem = function(key) {
                    return origGetItem.call(this, toInternalKey(key));
                };
                StorageProto.setItem = function(key, val) {
                    return origSetItem.call(this, toInternalKey(key), String(val));
                };
                StorageProto.removeItem = function(key) {
                    return origRemoveItem.call(this, toInternalKey(key));
                };
                StorageProto.clear = function() {
                    const total = origLengthDesc && origLengthDesc.get
                        ? origLengthDesc.get.call(this)
                        : 0;
                    const toRemove = [];
                    for (let i = 0; i < total; i++) {
                        const k = origKey.call(this, i);
                        if (belongsToContainer(k)) {
                            toRemove.push(k);
                        }
                    }
                    for (const k of toRemove) {
                        origRemoveItem.call(this, k);
                    }
                };
                StorageProto.key = function(index) {
                    const keys = getFilteredKeys(this);
                    return index >= 0 && index < keys.length ? keys[index] : null;
                };
                if (origLengthDesc && origLengthDesc.get) {
                    Object.defineProperty(StorageProto, "length", {
                        get() {
                            return getFilteredKeys(this).length;
                        },
                        configurable: true
                    });
                }
                Object.defineProperty(StorageProto, "__mac_proto_patched__", {
                    value: true,
                    enumerable: false,
                    configurable: false
                });
            }
        } catch (e) {}

        // 2. Wrap window.localStorage and window.sessionStorage in a Proxy for bracket/property access (e.g. localStorage.token)
        try {
            const createStorageProxy = (nativeStorage) => {
                const getContainerKeys = () => {
                    const keys = [];
                    for (let i = 0; i < nativeStorage.length; i++) {
                        const k = nativeStorage.key(i);
                        if (k !== null) keys.push(k);
                    }
                    return keys;
                };

                const methods = {
                    getItem: (k) => nativeStorage.getItem(k),
                    setItem: (k, v) => nativeStorage.setItem(k, v),
                    removeItem: (k) => nativeStorage.removeItem(k),
                    clear: () => nativeStorage.clear(),
                    key: (i) => nativeStorage.key(i)
                };

                return new Proxy(nativeStorage, {
                    get(target, prop) {
                        if (prop === "length") return nativeStorage.length;
                        if (prop in methods) return methods[prop];
                        if (prop === Symbol.toStringTag) return "Storage";
                        if (typeof prop === "symbol") return Reflect.get(target, prop);
                        const val = nativeStorage.getItem(prop);
                        return val !== null ? val : undefined;
                    },
                    set(target, prop, value) {
                        if (typeof prop === "symbol" || prop in methods || prop === "length") return false;
                        nativeStorage.setItem(prop, String(value));
                        return true;
                    },
                    deleteProperty(target, prop) {
                        if (typeof prop === "symbol") return false;
                        nativeStorage.removeItem(prop);
                        return true;
                    },
                    has(target, prop) {
                        if (prop in methods || prop === "length") return true;
                        if (typeof prop === "symbol") return false;
                        return nativeStorage.getItem(prop) !== null;
                    },
                    ownKeys() {
                        return getContainerKeys();
                    },
                    getOwnPropertyDescriptor(target, prop) {
                        if (prop in methods || prop === "length" || typeof prop === "symbol") return undefined;
                        const val = nativeStorage.getItem(prop);
                        if (val === null) return undefined;
                        return { value: val, writable: true, enumerable: true, configurable: true };
                    }
                });
            };

            const proxiedLocal = createStorageProxy(win.localStorage);
            const proxiedSession = createStorageProxy(win.sessionStorage);

            Object.defineProperty(win, "localStorage", { get: () => proxiedLocal, configurable: true });
            Object.defineProperty(win, "sessionStorage", { get: () => proxiedSession, configurable: true });
        } catch (e) {}

        // 3. Isolate BroadcastChannel per container
        if (!isDefault && typeof win.BroadcastChannel === "function") {
            const NativeBroadcastChannel = win.BroadcastChannel;
            class ContainerBroadcastChannel extends NativeBroadcastChannel {
                constructor(channelName) {
                    super(prefix + String(channelName));
                    this.__extName = String(channelName);
                }
                get name() {
                    return this.__extName;
                }
            }
            win.BroadcastChannel = ContainerBroadcastChannel;
        }

        // 4. Isolate IndexedDB databases per container
        if (win.indexedDB && typeof win.IDBFactory !== "undefined") {
            const IDBProto = win.IDBFactory.prototype;
            if (!IDBProto.__mac_idb_patched__) {
                const origOpen = IDBProto.open;
                const origDelete = IDBProto.deleteDatabase;
                const origDatabases = IDBProto.databases;

                if (!isDefault) {
                    IDBProto.open = function(name, version) {
                        const internalName = toInternalKey(name);
                        return arguments.length > 1
                            ? origOpen.call(this, internalName, version)
                            : origOpen.call(this, internalName);
                    };
                    IDBProto.deleteDatabase = function(name) {
                        return origDelete.call(this, toInternalKey(name));
                    };
                }

                if (typeof origDatabases === "function") {
                    IDBProto.databases = async function() {
                        const list = await origDatabases.call(this);
                        return list
                            .filter(db => db && belongsToContainer(db.name))
                            .map(db => ({ ...db, name: toExternalKey(db.name) }));
                    };
                }
                Object.defineProperty(IDBProto, "__mac_idb_patched__", {
                    value: true,
                    enumerable: false,
                    configurable: false
                });
            }
        }

        // 5. Isolate CacheStorage (window.caches) per container
        if (!isDefault && typeof win.CacheStorage !== "undefined") {
            const CacheProto = win.CacheStorage.prototype;
            if (!CacheProto.__mac_cache_patched__) {
                const origCacheOpen = CacheProto.open;
                const origCacheHas = CacheProto.has;
                const origCacheDelete = CacheProto.delete;
                const origCacheKeys = CacheProto.keys;

                CacheProto.open = function(cacheName) {
                    return origCacheOpen.call(this, toInternalKey(cacheName));
                };
                CacheProto.has = function(cacheName) {
                    return origCacheHas.call(this, toInternalKey(cacheName));
                };
                CacheProto.delete = function(cacheName) {
                    return origCacheDelete.call(this, toInternalKey(cacheName));
                };
                CacheProto.keys = async function() {
                    const keys = await origCacheKeys.call(this);
                    return keys.filter(belongsToContainer).map(toExternalKey);
                };
                Object.defineProperty(CacheProto, "__mac_cache_patched__", {
                    value: true,
                    enumerable: false,
                    configurable: false
                });
            }
        }

        // 6. Prevent about:blank / same-origin iframe bypass by automatically patching iframe.contentWindow on access
        try {
            const IFrameProto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
            if (IFrameProto && !IFrameProto.__mac_iframe_patched__) {
                const cwDesc = Object.getOwnPropertyDescriptor(IFrameProto, "contentWindow");
                if (cwDesc && cwDesc.get) {
                    Object.defineProperty(IFrameProto, "contentWindow", {
                        get() {
                            const childWin = cwDesc.get.call(this);
                            try {
                                if (childWin) patchWindowContext(childWin);
                            } catch (e) {}
                            return childWin;
                        },
                        configurable: true
                    });
                }
                Object.defineProperty(IFrameProto, "__mac_iframe_patched__", {
                    value: true,
                    enumerable: false,
                    configurable: false
                });
            }
        } catch (e) {}
    }

    patchWindowContext(window);

    // 7. Render Firefox-style 2px colored container indicator bar at the top of the viewport
    if (!isDefault && window === window.top) {
        const renderBar = () => {
            if (!document.documentElement || document.getElementById("__mac_container_bar__")) return;
            const bar = document.createElement("div");
            bar.id = "__mac_container_bar__";
            bar.title = `Container: ${containerName}`;
            bar.style.cssText = [
                "position: fixed",
                "top: 0",
                "left: 0",
                "right: 0",
                "height: 2px",
                `background: ${containerColorHex}`,
                "z-index: 2147483647",
                "pointer-events: none",
                "opacity: 0.9"
            ].join(";");
            document.documentElement.appendChild(bar);
        };
        if (document.documentElement) {
            renderBar();
        } else {
            window.addEventListener("DOMContentLoaded", renderBar, { once: true });
        }
    }
}

// Inject storage isolation at the earliest navigation commit ONLY for non-default containers.
// The Default container uses 100% native, untouched Chrome storage.
chrome.webNavigation.onCommitted.addListener((details) => {
    if (!isHttpUrl(details.url) && details.url !== "about:blank") return;

    const containerId = tabContainerCache[details.tabId] || "default";

    // Only inject page storage/channel overrides for non-default containers;
    // Default container tabs use Chrome's completely unmodified native storage.
    if (containerId !== "default") {
        const container = containersCache[containerId] || DEFAULT_CONTAINERS.default;
        const colorHex = resolveColorHex(container.color);

        chrome.scripting.executeScript({
            target: { tabId: details.tabId, frameIds: [details.frameId] },
            world: "MAIN",
            injectImmediately: true,
            func: installPageIsolation,
            args: [containerId, container.name, colorHex]
        }).catch(() => {});
    }

    // In the top frame, also attach an ISOLATED-world focus/pointerdown listener so that
    // clicking between panes in Chrome's built-in Split View or side-by-side windows
    // immediately activates that pane's container cookies before any network action fires.
    if (details.frameId === 0 && isHttpUrl(details.url)) {
        chrome.scripting.executeScript({
            target: { tabId: details.tabId, frameIds: [0] },
            world: "ISOLATED",
            injectImmediately: true,
            func: () => {
                if (window.__mac_split_listener__) return;
                window.__mac_split_listener__ = true;
                let lastNotify = 0;
                const notifyInteraction = () => {
                    const now = Date.now();
                    if (now - lastNotify < 500) return;
                    lastNotify = now;
                    chrome.runtime.sendMessage({ type: "PANE_INTERACTION" }).catch(() => {});
                };
                window.addEventListener("focus", notifyInteraction, true);
                window.addEventListener("pointerdown", notifyInteraction, true);
                window.addEventListener("pointerenter", notifyInteraction, true);
                window.addEventListener("wheel", notifyInteraction, { capture: true, passive: true });
                window.addEventListener("keydown", notifyInteraction, true);
            }
        }).catch(() => {});
    }
});

// Pre-navigation cookie swap on main frame navigation
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0 || !isHttpUrl(details.url)) return;

    enqueueOperation(async () => {
        try {
            const url = new URL(details.url);
            const hostname = url.hostname.toLowerCase();
            const baseDomain = getBaseDomain(hostname);
            if (!baseDomain) return;

            const currentContainer = tabContainerCache[details.tabId] || "default";
            const targetContainer = resolveTargetContainerForNavigation(
                hostname,
                baseDomain,
                currentContainer,
                url,
                details.tabId
            );

            if (targetContainer && targetContainer !== currentContainer) {
                console.log(`[Redirect] ${hostname} redirected to ${targetContainer} from ${currentContainer}`);
                await createContainerTab(targetContainer, details.url, details.tabId, false);
                return;
            }

            const tab = await chrome.tabs.get(details.tabId).catch(() => null);
            if (tab && tab.active) {
                await ensureDomainCookiesSwapped(baseDomain, currentContainer);
            }
        } catch (e) {
            // Ignore malformed URLs
        }
    });
});

// --- Domain-Scoped Cookie Isolation ---

let isSwappingCookies = false;

async function ensureDomainCookiesSwapped(baseDomain, targetContainerId) {
    if (!baseDomain) return;

    const currentOwner = domainOwnerCache[baseDomain] || "default";
    if (currentOwner === targetContainerId) {
        await syncDnrSessionRules();
        return;
    }

    console.log(`[Swap] ${baseDomain}: ${currentOwner} → ${targetContainerId}`);
    isSwappingCookies = true;
    try {
        // 1. Save current base-domain cookies (encrypted with AES-256-GCM) under the current owner
        await saveDomainCookies(baseDomain, currentOwner);

        // 2. Clear only this base domain's cookies
        await clearDomainCookies(baseDomain);

        // 3. Decrypt and restore this base domain's cookies for the target container
        await restoreDomainCookies(baseDomain, targetContainerId);

        // 4. Update ownership & refresh network-layer background tab rules
        domainOwnerCache[baseDomain] = targetContainerId;
        await chrome.storage.local.set({ domainOwnerMap: domainOwnerCache });
        await syncDnrSessionRules();
    } finally {
        isSwappingCookies = false;
    }
}

// Real-time debounced cookie sync when a website sets/updates cookies in a non-default container.
// (Default container cookies live directly in Chrome's native cookie store.)
const pendingCookieSyncTimers = new Map();
chrome.cookies.onChanged.addListener((changeInfo) => {
    if (isSwappingCookies || !changeInfo.cookie) return;
    const baseDomain = getBaseDomain(changeInfo.cookie.domain);
    if (!baseDomain) return;

    const owner = domainOwnerCache[baseDomain] || "default";
    if (owner === "default") return;

    if (pendingCookieSyncTimers.has(baseDomain)) {
        clearTimeout(pendingCookieSyncTimers.get(baseDomain));
    }
    pendingCookieSyncTimers.set(baseDomain, setTimeout(() => {
        pendingCookieSyncTimers.delete(baseDomain);
        enqueueOperation(async () => {
            const currentOwner = domainOwnerCache[baseDomain] || "default";
            if (currentOwner !== "default") {
                await saveDomainCookies(baseDomain, currentOwner);
            }
        });
    }, 400));
});

// When user switches to a tab, swap cookies for that tab's base domain & update badge
chrome.tabs.onActivated.addListener((activeInfo) => {
    enqueueOperation(async () => {
        await updateTabBadge(activeInfo.tabId);
        const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
        if (!tab || !isHttpUrl(tab.url)) return;

        try {
            const url = new URL(tab.url);
            const baseDomain = getBaseDomain(url.hostname);
            if (!baseDomain) return;

            const containerId = tabContainerCache[tab.id] || "default";
            await ensureDomainCookiesSwapped(baseDomain, containerId);
        } catch (e) {
            console.warn("[Swap] Skipped:", e.message);
        }
    });
});

// Multi-window support: when switching between Chrome windows, swap cookies for the newly focused window's active tab
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    enqueueOperation(async () => {
        const tabs = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
        const activeTab = tabs[0];
        if (!activeTab) return;

        await updateTabBadge(activeTab.id);
        if (!isHttpUrl(activeTab.url)) return;

        try {
            const url = new URL(activeTab.url);
            const baseDomain = getBaseDomain(url.hostname);
            if (!baseDomain) return;

            const containerId = tabContainerCache[activeTab.id] || "default";
            await ensureDomainCookiesSwapped(baseDomain, containerId);
        } catch (e) {
            console.warn("[WindowFocus Swap] Skipped:", e.message);
        }
    });
});

// Tab Creation — New Tab button / Ctrl+T always uses Default container;
// only links/popups opened from a page inherit the opener tab's container.
chrome.tabs.onCreated.addListener((tab) => {
    const isInternalCreate = internalTabCreateCount > 0;

    enqueueOperation(async () => {
        if (isInternalCreate || tabContainerCache[tab.id]) return;

        const targetUrl = tab.pendingUrl || tab.url || "";

        // If opened via the New Tab (+) button or Ctrl+T, always keep in the Default container
        if (!targetUrl || isNewTabUrl(targetUrl)) {
            delete tabContainerCache[tab.id];
            if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await chrome.tabs.ungroup(tab.id).catch(() => {});
            }
            await updateTabBadge(tab.id);
            return;
        }

        if (!tab.openerTabId) return;

        const parentContainer = tabContainerCache[tab.openerTabId];
        if (parentContainer && parentContainer !== "default") {
            tabContainerCache[tab.id] = parentContainer;
            await chrome.storage.local.set({ tabContainerMap: tabContainerCache });

            // Check if this is an OAuth/popup window; if so, exempt it from site-assignment hijacking
            const win = await chrome.windows.get(tab.windowId).catch(() => null);
            if (win && win.type === "popup") {
                tabSiteExemptionCache.set(tab.id, "__CHILD_POPUP__");
            } else {
                await groupTab(tab.id, parentContainer);
            }

            await syncDnrSessionRules();
            await updateTabBadge(tab.id);
        }
    });
});

// Tab URL or Group change — handle manual Tab Group dragging, site assignment, badge, and domain cookie swap
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Handle user manually dragging a tab into or out of a Chrome Tab Group
    if (changeInfo.groupId !== undefined) {
        enqueueOperation(async () => {
            const convertTabToDefault = async () => {
                const oldContainer = tabContainerCache[tabId];
                if (oldContainer && oldContainer !== "default") {
                    delete tabContainerCache[tabId];
                    await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
                    await updateTabBadge(tabId);
                    await cleanupIfEmptyTempContainer(oldContainer);

                    if (isHttpUrl(tab.url)) {
                        try {
                            const url = new URL(tab.url);
                            const baseDomain = getBaseDomain(url.hostname);
                            if (baseDomain) {
                                // Exempt this tab from "Always Open This Site in..." so it stays in Default
                                tabSiteExemptionCache.set(tabId, baseDomain);
                                if (tab.active) {
                                    await ensureDomainCookiesSwapped(baseDomain, "default");
                                } else {
                                    await syncDnrSessionRules();
                                }
                                // Reload the tab so it immediately switches to the Default session
                                await chrome.tabs.reload(tabId).catch(() => {});
                            }
                        } catch (e) {}

                        // Remove the 2px top colored container bar from the page
                        chrome.scripting.executeScript({
                            target: { tabId },
                            world: "MAIN",
                            func: () => {
                                document.getElementById("__mac_container_bar__")?.remove();
                            }
                        }).catch(() => {});
                    } else {
                        await syncDnrSessionRules();
                    }
                }
            };

            if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                // Tab was dragged out of a group -> convert to Default container
                await convertTabToDefault();
            } else {
                const grp = await chrome.tabGroups.get(changeInfo.groupId).catch(() => null);
                const grpTitle = grp?.title ? grp.title.trim().toLowerCase() : "";
                const matchedEntry = grpTitle
                    ? Object.entries(containersCache).find(
                        ([id, c]) => id !== "default" && c.name.trim().toLowerCase() === grpTitle
                    )
                    : null;

                if (matchedEntry) {
                    // This is a Container Tab Group
                    if (isExcludedInternalOrFileUrl(tab.url)) {
                        await chrome.tabs.ungroup(tabId).catch(() => {});
                        return;
                    }
                    const newContainerId = matchedEntry[0];
                    if (tabContainerCache[tabId] !== newContainerId) {
                        tabContainerCache[tabId] = newContainerId;
                        await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
                        await updateTabBadge(tabId);

                        if (isHttpUrl(tab.url)) {
                            try {
                                const baseDomain = getBaseDomain(new URL(tab.url).hostname);
                                if (baseDomain) {
                                    if (tab.active) {
                                        await ensureDomainCookiesSwapped(baseDomain, newContainerId);
                                    } else {
                                        await syncDnrSessionRules();
                                    }
                                    // Reload the tab so it immediately switches to the new container's session
                                    await chrome.tabs.reload(tabId).catch(() => {});
                                }
                            } catch (e) {}
                        } else {
                            await syncDnrSessionRules();
                        }
                    }
                } else {
                    // User placed the tab into a custom non-container Chrome Tab Group -> keep group, use Default container
                    await convertTabToDefault();
                }
            }
        });
    }

    if (changeInfo.status !== "loading") return;

    enqueueOperation(async () => {
        // If a container tab navigates to a chrome:// (non-newtab) or file:// URL, remove it from containers
        if (isExcludedInternalOrFileUrl(tab.url)) {
            if (tabContainerCache[tabId]) {
                delete tabContainerCache[tabId];
                await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
                await syncDnrSessionRules();
            }
            if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await chrome.tabs.ungroup(tabId).catch(() => {});
            }
            await updateTabBadge(tabId);
            return;
        }

        await updateTabBadge(tabId);
        if (!isHttpUrl(tab.url)) return;

        try {
            const url = new URL(tab.url);
            const hostname = url.hostname.toLowerCase();
            const baseDomain = getBaseDomain(hostname);
            if (!baseDomain) return;

            const currentContainer = tabContainerCache[tabId] || "default";
            const exemptedDomain = tabSiteExemptionCache.get(tabId);

            if (exemptedDomain && exemptedDomain !== "__CHILD_POPUP__" && exemptedDomain !== baseDomain) {
                tabSiteExemptionCache.delete(tabId);
            }

            const targetContainer = resolveTargetContainerForNavigation(
                hostname,
                baseDomain,
                currentContainer,
                url,
                tabId
            );

            if (targetContainer && targetContainer !== currentContainer) {
                console.log(`[Redirect] ${hostname} needs ${targetContainer}, currently in ${currentContainer}`);
                await createContainerTab(targetContainer, tab.url, tabId, false);
                return;
            }

            if (currentContainer !== "default" && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                await groupTab(tabId, currentContainer);
            }

            if (tab.active) {
                await ensureDomainCookiesSwapped(baseDomain, currentContainer);
            } else {
                await syncDnrSessionRules();
            }
        } catch (e) {
            console.warn("[Update] Skipped:", e.message);
        }
    });
});

// Tab Removal — cleanup & auto-destroy empty Temporary Containers
chrome.tabs.onRemoved.addListener((tabId) => {
    tabSiteExemptionCache.delete(tabId);
    enqueueOperation(async () => {
        const oldContainer = tabContainerCache[tabId];
        if (oldContainer) {
            delete tabContainerCache[tabId];
            await chrome.storage.local.set({ tabContainerMap: tabContainerCache });
            await cleanupIfEmptyTempContainer(oldContainer);
        }
        await syncDnrSessionRules();
    });
});

// --- Visual Grouping ---

async function groupTab(tabId, containerId) {
    const container = containersCache[containerId];
    if (!container || containerId === "default") return;

    try {
        const tab = await chrome.tabs.get(tabId);
        const existingGroups = await chrome.tabGroups.query({
            windowId: tab.windowId,
            title: container.name
        });

        if (existingGroups.length > 0) {
            await chrome.tabs.group({ tabIds: tabId, groupId: existingGroups[0].id });
        } else {
            const groupId = await chrome.tabs.group({ tabIds: tabId });
            await chrome.tabGroups.update(groupId, {
                color: getChromeColor(container.color),
                title: container.name
            });
        }
    } catch (e) {
        console.error("Grouping failed", e);
    }
}

// --- Encrypted Domain-Scoped Cookie Management ---

function buildCookieUrl(cookie) {
    const cookieDomain = cookie.domain.startsWith(".")
        ? cookie.domain.substring(1)
        : cookie.domain;
    return "http" + (cookie.secure ? "s" : "") + "://" + cookieDomain + (cookie.path || "/");
}

async function saveDomainCookies(baseDomain, containerId) {
    const cookies = await chrome.cookies.getAll({ domain: baseDomain });
    const storeKey = `cookies_${containerId}_${baseDomain}`;
    const encryptedPayload = await encryptCookieList(cookies);
    await chrome.storage.local.set({ [storeKey]: encryptedPayload });
    console.log(`[Save-Encrypted] ${cookies.length} cookies for ${baseDomain} → ${containerId}`);
}

async function clearDomainCookies(baseDomain) {
    const cookies = await chrome.cookies.getAll({ domain: baseDomain });
    const promises = cookies.map(c => {
        const removeDetails = {
            url: buildCookieUrl(c),
            name: c.name,
            storeId: c.storeId
        };
        if (c.partitionKey) {
            removeDetails.partitionKey = c.partitionKey;
        }
        return chrome.cookies.remove(removeDetails).catch(() => {});
    });
    await Promise.all(promises);
    console.log(`[Clear] Removed ${cookies.length} cookies for ${baseDomain}`);
}

async function restoreDomainCookies(baseDomain, containerId) {
    const storeKey = `cookies_${containerId}_${baseDomain}`;
    const data = await chrome.storage.local.get(storeKey);
    const cookies = await decryptCookieList(data[storeKey]);
    const nowSeconds = Date.now() / 1000;

    const promises = cookies.map(c => {
        if (c.expirationDate && c.expirationDate < nowSeconds) {
            return Promise.resolve();
        }

        const details = {
            url: buildCookieUrl(c),
            name: c.name,
            value: c.value,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            storeId: c.storeId
        };

        if (c.expirationDate) {
            details.expirationDate = c.expirationDate;
        }
        if (!c.hostOnly && !c.name.startsWith("__Host-")) {
            details.domain = c.domain;
        }
        if (c.sameSite) {
            details.sameSite = c.sameSite;
        }
        if (c.partitionKey) {
            details.partitionKey = c.partitionKey;
        }

        return chrome.cookies.set(details).catch(e => {
            console.warn("Failed to restore cookie", c.name, e.message);
        });
    });

    await Promise.all(promises);
    console.log(`[Restore-Decrypted] ${cookies.length} cookies for ${baseDomain} ← ${containerId}`);
}
