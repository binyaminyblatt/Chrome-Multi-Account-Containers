// Firefox-Style Multi-Account Containers Popup Logic

let currentMode = 'newTab'; // 'newTab', 'reopen', 'always'
let containersData = {};
let tabContainerMap = {};
let siteContainerMap = {};
let managedSiteMap = {};
let enterpriseFlags = {};
let activeTab = null;
let allOpenTabs = [];
let expandedContainerId = null;

const COLOR_MAP = {
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

const ICON_MAP = {
    "fingerprint": "🆔",
    "briefcase": "💼",
    "dollar": "💲",
    "cart": "🛒",
    "vacation": "✈️",
    "gift": "🎁",
    "food": "🍽️",
    "fruit": "🍎",
    "pet": "🐾",
    "tree": "🌲",
    "chill": "🕶️",
    "circle": "●",
    "code": "💻",
    "terminal": "⌨️",
    "robot": "🤖",
    "cloud": "☁️",
    "lock": "🔒",
    "key": "🔑",
    "shield": "🛡️",
    "bank": "🏦",
    "chart": "📈",
    "card": "💳",
    "mail": "✉️",
    "chat": "💬",
    "phone": "📱",
    "globe": "🌐",
    "game": "🎮",
    "music": "🎵",
    "video": "🎬",
    "camera": "📷",
    "book": "📚",
    "grad": "🎓",
    "medical": "⚕️",
    "home": "🏠",
    "star": "⭐",
    "fire": "🔥"
};

document.addEventListener('DOMContentLoaded', async () => {
    await refreshStateAndRender();

    // Menu Event Listeners
    document.getElementById('menu-temp-tab').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
            type: "OPEN_TEMP_CONTAINER_TAB",
            url: "chrome://newtab"
        }).catch(() => {});
        window.close();
    });
    document.getElementById('menu-new-tab').addEventListener('click', () => showSubView('newTab', 'Open a New Tab in...'));
    document.getElementById('menu-duplicate').addEventListener('click', () => showSubView('duplicate', 'Duplicate This Tab in...'));
    document.getElementById('menu-split').addEventListener('click', () => showSubView('split', 'Split View This Tab in...'));
    document.getElementById('menu-reopen').addEventListener('click', () => showSubView('reopen', 'Reopen This Tab in...'));
    document.getElementById('menu-always').addEventListener('click', () => showSubView('always', 'Always Open This Site in...'));
    document.getElementById('menu-sort').addEventListener('click', sortTabs);

    // Search Main
    document.getElementById('search-input').addEventListener('input', (e) => {
        renderList('container-list-main', 'newTab', e.target.value);
    });

    // Manage
    document.getElementById('manage-btn').addEventListener('click', () => {
        window.location.href = 'manage.html';
    });

    // Back Button
    document.getElementById('sub-back-btn').addEventListener('click', showMainView);

    // Info Icon
    document.getElementById('info-icon').addEventListener('click', () => {
        chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
    });

    // Credit Link
    document.getElementById('credit-link').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://github.com/binyaminyblatt/Chrome-Multi-Account-Containers' });
    });
});

async function refreshStateAndRender() {
    const [storageData, activeTabs, windowTabs] = await Promise.all([
        chrome.storage.local.get(["containers", "tabContainerMap", "siteContainerMap", "managedSiteMap", "enterpriseFlags"]),
        chrome.tabs.query({ active: true, currentWindow: true }),
        chrome.tabs.query({})
    ]);

    containersData = storageData.containers || {};
    tabContainerMap = storageData.tabContainerMap || {};
    siteContainerMap = storageData.siteContainerMap || {};
    managedSiteMap = storageData.managedSiteMap || {};
    enterpriseFlags = storageData.enterpriseFlags || {};
    activeTab = activeTabs[0] || null;
    allOpenTabs = windowTabs || [];

    // Hide Temporary Container option if disabled by enterprise policy
    document.getElementById('menu-temp-tab')?.classList.toggle('hidden', Boolean(enterpriseFlags.disableTemporaryContainers));

    renderActiveTabBanner();
    const filterVal = document.getElementById('search-input')?.value || '';
    renderList('container-list-main', 'newTab', filterVal);
}

function isExcludedInternalOrFileTab(tab) {
    const url = tab?.url || tab?.pendingUrl || '';
    if (!url) return false;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome://newtab') || url.startsWith('edge://newtab') || url === 'about:blank') {
        return false;
    }
    return (
        url.startsWith('chrome://') ||
        url.startsWith('file://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('devtools://') ||
        url.startsWith('edge://') ||
        url.startsWith('view-source:')
    );
}

function isWebTab(tab) {
    return Boolean(tab && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://')));
}

function renderActiveTabBanner() {
    const card = document.getElementById('active-tab-card');
    const isWeb = isWebTab(activeTab);

    // Hide current-tab container actions (Duplicate, Split, Reopen, Always Open) on chrome:// and file:// pages
    document.getElementById('menu-duplicate')?.classList.toggle('hidden', !isWeb);
    document.getElementById('menu-split')?.classList.toggle('hidden', !isWeb);
    document.getElementById('menu-reopen')?.classList.toggle('hidden', !isWeb);
    document.getElementById('menu-always')?.classList.toggle('hidden', !isWeb);

    if (!isWeb) {
        card.classList.add('hidden');
        return;
    }

    card.classList.remove('hidden');
    const url = new URL(activeTab.url);
    const domain = url.hostname.toLowerCase();
    const currentContainerId = tabContainerMap[activeTab.id] || 'default';
    const currentContainer = containersData[currentContainerId] || { name: 'Default', color: 'grey', icon: 'circle' };
    const dotColor = COLOR_MAP[currentContainer.color] || currentContainer.color || '#8f8f9d';
    const iconChar = ICON_MAP[currentContainer.icon] || '●';

    const domainText = document.getElementById('active-domain-text');
    domainText.textContent = domain;
    domainText.title = domain;

    const pill = document.getElementById('active-container-pill');
    pill.textContent = `${iconChar} ${currentContainer.name}`;
    pill.style.borderLeft = `4px solid ${dotColor}`;

    const checkbox = document.getElementById('always-open-checkbox');
    const labelText = document.getElementById('always-open-text');
    const resetSiteBtn = document.getElementById('reset-site-btn');
    const assignedContainerId = managedSiteMap[domain] || siteContainerMap[domain];
    const isManagedAssignment = Boolean(managedSiteMap[domain]);

    if (assignedContainerId && containersData[assignedContainerId]) {
        checkbox.checked = true;
        checkbox.disabled = isManagedAssignment;
        labelText.textContent = isManagedAssignment
            ? `🏢 Policy: Always in ${containersData[assignedContainerId].name}`
            : `Always open in ${containersData[assignedContainerId].name}`;
    } else {
        checkbox.checked = false;
        checkbox.disabled = false;
        labelText.textContent = `Always open in ${currentContainer.name}`;
    }

    // Show "🧹 Reset Site" only for non-default containers so Default cookies are never accidentally cleared
    if (resetSiteBtn) {
        resetSiteBtn.classList.toggle('hidden', currentContainerId === 'default');
        resetSiteBtn.onclick = async () => {
            await chrome.runtime.sendMessage({
                type: "CLEAR_SITE_IN_CONTAINER",
                tabId: activeTab.id,
                url: activeTab.url,
                containerId: currentContainerId
            }).catch(() => {});
            window.close();
        };
    }

    checkbox.onchange = async () => {
        const fresh = await chrome.storage.local.get("siteContainerMap");
        const updatedMap = fresh.siteContainerMap || {};
        if (checkbox.checked) {
            updatedMap[domain] = currentContainerId;
        } else {
            delete updatedMap[domain];
        }
        await chrome.storage.local.set({ siteContainerMap: updatedMap });
        siteContainerMap = updatedMap;
        renderActiveTabBanner();
    };
}

function showSubView(mode, title) {
    currentMode = mode;
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('sub-view').classList.remove('hidden');
    document.getElementById('sub-title-text').textContent = title;

    renderList('container-list-sub', mode);
}

function showMainView() {
    currentMode = 'newTab';
    document.getElementById('sub-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
}

function getContainerTabCounts() {
    const counts = {};
    for (const tab of allOpenTabs) {
        if (!tab.id || isExcludedInternalOrFileTab(tab)) continue;
        const cId = tabContainerMap[tab.id] || 'default';
        counts[cId] = (counts[cId] || 0) + 1;
    }
    return counts;
}

function renderList(targetId, mode, filterText = '') {
    const listElement = document.getElementById(targetId);
    listElement.textContent = '';
    const tabCounts = getContainerTabCounts();

    // In sub-view for newTab, duplicate, split, reopen: offer "🔥 New Temporary Container" at the top
    if (targetId === 'container-list-sub' && mode !== 'always') {
        const tempItem = document.createElement('div');
        tempItem.className = 'container-item';
        tempItem.style.borderLeftColor = '#ff4bda';

        const tempBadge = document.createElement('div');
        tempBadge.className = 'container-icon-badge';
        tempBadge.style.backgroundColor = '#ff4bda';
        tempBadge.textContent = '🔥';

        const tempName = document.createElement('div');
        tempName.className = 'container-name';
        tempName.textContent = 'New Temporary Container';

        tempItem.append(tempBadge, tempName);
        tempItem.addEventListener('click', () => handleContainerClick('__TEMP__', mode));
        listElement.appendChild(tempItem);
    }

    // Always place "default" container at the very top
    const orderedKeys = [
        ...(containersData.default ? ['default'] : []),
        ...Object.keys(containersData).filter(k => k !== 'default')
    ];

    orderedKeys.forEach(key => {
        const container = containersData[key];
        if (filterText && !container.name.toLowerCase().includes(filterText.toLowerCase())) return;

        const item = document.createElement('div');
        item.className = 'container-item';
        const dotColor = COLOR_MAP[container.color] || container.color || '#8f8f9d';
        const iconChar = ICON_MAP[container.icon] || '●';

        // Colored left accent on hover / active
        item.style.borderLeftColor = dotColor;

        const iconBadge = document.createElement('div');
        iconBadge.className = 'container-icon-badge';
        iconBadge.style.backgroundColor = dotColor;
        iconBadge.textContent = iconChar;

        const nameDiv = document.createElement('div');
        nameDiv.className = 'container-name';
        let labelStr = container.name;
        if (container.isolated) labelStr += ' 🔒';
        if (container.managed) labelStr += ' 🏢';
        nameDiv.textContent = labelStr;

        item.append(iconBadge, nameDiv);

        // In main view, show tab count (clickable to expand open tabs) + quick-action buttons
        if (targetId === 'container-list-main') {
            const count = tabCounts[key] || 0;
            if (count > 0) {
                const countBadge = document.createElement('span');
                countBadge.className = 'tab-count-badge';
                countBadge.textContent = `${count} ▾`;
                countBadge.title = `Click to view ${count} open tab(s) in ${container.name}`;
                countBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    expandedContainerId = (expandedContainerId === key) ? null : key;
                    const filterVal = document.getElementById('search-input')?.value || '';
                    renderList('container-list-main', 'newTab', filterVal);
                });
                item.appendChild(countBadge);
            }

            const actions = document.createElement('div');
            actions.className = 'row-actions';

            if (isWebTab(activeTab)) {
                // Quick "Duplicate active tab in this container" button
                const duplicateBtn = document.createElement('button');
                duplicateBtn.className = 'row-action-btn';
                duplicateBtn.textContent = '⧉';
                duplicateBtn.title = `Duplicate current tab in ${container.name}`;
                duplicateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleContainerClick(key, 'duplicate');
                });
                actions.appendChild(duplicateBtn);

                // Quick "Split View active tab in this container" button
                const splitBtn = document.createElement('button');
                splitBtn.className = 'row-action-btn';
                splitBtn.textContent = '◫';
                splitBtn.title = `Open Split View in ${container.name}`;
                splitBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleContainerClick(key, 'split');
                });
                actions.appendChild(splitBtn);

                // Quick "Reopen active tab in this container" button
                const reopenBtn = document.createElement('button');
                reopenBtn.className = 'row-action-btn';
                reopenBtn.textContent = '↻';
                reopenBtn.title = `Reopen current tab in ${container.name}`;
                reopenBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleContainerClick(key, 'reopen');
                });
                actions.appendChild(reopenBtn);
            }

            if (count > 0 && key !== 'default') {
                // Move all tabs of this container to a new window
                const moveWinBtn = document.createElement('button');
                moveWinBtn.className = 'row-action-btn';
                moveWinBtn.textContent = '↗';
                moveWinBtn.title = `Move ${container.name} tabs to a new window`;
                moveWinBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await chrome.runtime.sendMessage({
                        type: "MOVE_CONTAINER_TO_WINDOW",
                        containerId: key
                    });
                    window.close();
                });
                actions.appendChild(moveWinBtn);

                // Hide / Collapse or Expand container tab group
                const hideBtn = document.createElement('button');
                hideBtn.className = 'row-action-btn';
                hideBtn.textContent = '👁';
                hideBtn.title = `Hide / Show ${container.name} tab group`;
                hideBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await chrome.runtime.sendMessage({
                        type: "TOGGLE_CONTAINER_VISIBILITY",
                        containerId: key,
                        windowId: activeTab?.windowId
                    });
                });
                actions.appendChild(hideBtn);

                // Close all tabs in this container
                const closeBtn = document.createElement('button');
                closeBtn.className = 'row-action-btn';
                closeBtn.textContent = '×';
                closeBtn.title = `Close all ${container.name} tabs`;
                closeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await chrome.runtime.sendMessage({
                        type: "CLOSE_CONTAINER_TABS",
                        containerId: key
                    });
                    await refreshStateAndRender();
                });
                actions.appendChild(closeBtn);
            }

            item.appendChild(actions);
        }

        item.addEventListener('click', () => handleContainerClick(key, mode));
        listElement.appendChild(item);

        // Render expandable open-tabs drawer if this container's badge was clicked
        if (targetId === 'container-list-main' && expandedContainerId === key) {
            const containerTabs = allOpenTabs.filter(t => {
                if (!t.id || isExcludedInternalOrFileTab(t)) return false;
                return (tabContainerMap[t.id] || 'default') === key;
            });

            if (containerTabs.length > 0) {
                const drawer = document.createElement('div');
                drawer.className = 'expanded-tabs-drawer';

                containerTabs.forEach(t => {
                    const row = document.createElement('div');
                    row.className = 'drawer-tab-row';

                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'drawer-tab-title';
                    titleSpan.textContent = t.title || t.url || 'New Tab';
                    titleSpan.title = t.url || '';

                    const closeTabBtn = document.createElement('button');
                    closeTabBtn.className = 'row-action-btn';
                    closeTabBtn.textContent = '×';
                    closeTabBtn.title = 'Close this tab';
                    closeTabBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await chrome.tabs.remove(t.id).catch(() => {});
                        await refreshStateAndRender();
                    });

                    row.append(titleSpan, closeTabBtn);
                    row.addEventListener('click', async () => {
                        await chrome.tabs.update(t.id, { active: true }).catch(() => {});
                        if (t.windowId) {
                            await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
                        }
                        window.close();
                    });
                    drawer.appendChild(row);
                });

                listElement.appendChild(drawer);
            }
        }
    });
}

async function handleContainerClick(containerId, mode) {
    if (containerId === '__TEMP__') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const curTab = tabs[0];
        if (mode === 'newTab') {
            await chrome.runtime.sendMessage({ type: "OPEN_TEMP_CONTAINER_TAB", url: "chrome://newtab" }).catch(() => {});
        } else if (mode === 'duplicate' && curTab) {
            await chrome.runtime.sendMessage({ type: "OPEN_TEMP_CONTAINER_TAB", url: curTab.url || "chrome://newtab", exemptSite: true }).catch(() => {});
        } else if (mode === 'split' && curTab) {
            await chrome.runtime.sendMessage({ type: "OPEN_TEMP_CONTAINER_TAB", url: curTab.url || "chrome://newtab", splitView: true, sourceTabId: curTab.id }).catch(() => {});
        } else if (mode === 'reopen' && curTab) {
            await chrome.runtime.sendMessage({ type: "OPEN_TEMP_CONTAINER_TAB", url: curTab.url || "chrome://newtab", closeTabId: curTab.id, exemptSite: true }).catch(() => {});
        }
        window.close();
        return;
    }

    if (mode === 'newTab') {
        await openInContainer(containerId);
    } else if (mode === 'duplicate') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            await openInContainer(containerId, tabs[0].url || "chrome://newtab", null, true);
        }
    } else if (mode === 'split') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            await chrome.runtime.sendMessage({
                type: "SPLIT_VIEW_CONTAINER_TAB",
                containerId: containerId,
                url: tabs[0].url || "chrome://newtab",
                sourceTabId: tabs[0].id
            }).catch(() => {});
            window.close();
        }
    } else if (mode === 'reopen') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            await openInContainer(containerId, tabs[0].url, tabs[0].id, true);
        }
    } else if (mode === 'always') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        if (currentTab && currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
            const url = new URL(currentTab.url);
            const domain = url.hostname.toLowerCase();
            const data = await chrome.storage.local.get(["siteContainerMap", "tabContainerMap"]);
            const siteMap = data.siteContainerMap || {};
            const tabMap = data.tabContainerMap || {};

            siteMap[domain] = containerId;
            await chrome.storage.local.set({ siteContainerMap: siteMap });

            const currentTabContainer = tabMap[currentTab.id] || "default";
            if (currentTabContainer !== containerId) {
                await openInContainer(containerId, currentTab.url, currentTab.id, false);
                return;
            }
        }
        await refreshStateAndRender();
        showMainView();
    }
}

async function openInContainer(containerId, url = "chrome://newtab", closeTabId = null, exemptSite = false) {
    await chrome.runtime.sendMessage({
        type: "OPEN_CONTAINER_TAB",
        containerId: containerId,
        url: url,
        closeTabId: closeTabId,
        exemptSite: exemptSite
    }).catch(() => {});
    window.close();
}

async function sortTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const cData = await chrome.storage.local.get("tabContainerMap");
    const map = cData.tabContainerMap || {};

    tabs.sort((a, b) => {
        const cA = map[a.id] || "default";
        const cB = map[b.id] || "default";
        if (cA < cB) return -1;
        if (cA > cB) return 1;
        return 0;
    });

    for (let i = 0; i < tabs.length; i++) {
        await chrome.tabs.move(tabs[i].id, { index: i });
    }
    window.close();
}
