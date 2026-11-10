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
    const listElement = document.getElementById('list');
    const siteListElement = document.getElementById('site-list');
    const backBtn = document.querySelector('.back-btn');
    const addBtn = document.getElementById('add-btn');
    const newNameInput = document.getElementById('new-name');
    const colorPicker = document.getElementById('color-picker');
    const customColorPicker = document.getElementById('custom-color-picker');
    const iconPicker = document.getElementById('icon-picker');
    const formTitleText = document.getElementById('form-title-text');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const isolatedCheckbox = document.getElementById('isolated-checkbox');
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const exportPolicyBtn = document.getElementById('export-policy-btn');
    const importFile = document.getElementById('import-file');
    const newSiteDomainInput = document.getElementById('new-site-domain');
    const newSiteContainerSelect = document.getElementById('new-site-container');
    const addSiteBtn = document.getElementById('add-site-btn');

    let selectedColor = 'blue';
    let selectedIcon = 'fingerprint';
    let editingContainerId = null;

    // Back button
    backBtn.addEventListener('click', () => {
        window.location.href = 'popup.html';
    });

    function selectColorOption(color) {
        selectedColor = color;
        let matchedPreset = false;
        colorPicker.querySelectorAll('.color-option').forEach(o => {
            const isMatch = o.dataset.color === color;
            o.classList.toggle('selected', isMatch);
            if (isMatch) matchedPreset = true;
        });
        if (customColorPicker) {
            customColorPicker.value = COLOR_MAP[color] || (color.startsWith('#') ? color : '#37adff');
            customColorPicker.classList.toggle('selected', !matchedPreset);
        }
    }

    function selectIconOption(icon) {
        selectedIcon = icon;
        iconPicker.querySelectorAll('.icon-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.icon === icon);
        });
    }

    // Color picker
    colorPicker.querySelectorAll('.color-option').forEach(opt => {
        opt.addEventListener('click', () => selectColorOption(opt.dataset.color));
    });

    if (customColorPicker) {
        customColorPicker.addEventListener('input', (e) => {
            selectColorOption(e.target.value);
        });
    }

    // Icon picker
    iconPicker.querySelectorAll('.icon-option').forEach(opt => {
        opt.addEventListener('click', () => selectIconOption(opt.dataset.icon));
    });

    selectColorOption('blue');
    selectIconOption('fingerprint');

    cancelEditBtn.addEventListener('click', resetForm);

    function resetForm() {
        editingContainerId = null;
        newNameInput.value = '';
        if (isolatedCheckbox) isolatedCheckbox.checked = false;
        selectColorOption('blue');
        selectIconOption('fingerprint');
        formTitleText.textContent = 'New Container';
        addBtn.textContent = 'Add Container';
        cancelEditBtn.classList.add('hidden');
    }

    function startEditing(id, container) {
        editingContainerId = id;
        newNameInput.value = container.name;
        if (isolatedCheckbox) isolatedCheckbox.checked = Boolean(container.isolated);
        selectColorOption(container.color || 'blue');
        selectIconOption(container.icon || 'fingerprint');
        formTitleText.textContent = `Edit "${container.name}"`;
        addBtn.textContent = 'Save Changes';
        cancelEditBtn.classList.remove('hidden');
        newNameInput.focus();
    }

    // Load and render
    await renderAll();

    // Add or Save container
    addBtn.addEventListener('click', async () => {
        const name = newNameInput.value.trim();
        if (!name) return;

        const data = await chrome.storage.local.get("containers");
        const containers = data.containers || {};
        const id = editingContainerId || ("container-" + Date.now());

        containers[id] = {
            ...containers[id],
            name: name,
            color: selectedColor,
            icon: selectedIcon,
            isolated: Boolean(isolatedCheckbox && isolatedCheckbox.checked)
        };

        await chrome.storage.local.set({ containers });
        resetForm();
        await renderAll();
    });

    // Export Backup
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const data = await chrome.storage.local.get(["containers", "siteContainerMap"]);
            const rawContainers = data.containers || {};
            const exportContainers = {};
            for (const [k, v] of Object.entries(rawContainers)) {
                if (v && !v.temporary) {
                    exportContainers[k] = v;
                }
            }
            const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                containers: exportContainers,
                siteContainerMap: data.siteContainerMap || {}
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'multi-account-containers-backup.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Import Backup
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                if (!parsed || typeof parsed !== 'object' || !parsed.containers) {
                    return;
                }
                const current = await chrome.storage.local.get(["containers", "siteContainerMap"]);
                const mergedContainers = {
                    ...(current.containers || {}),
                    ...parsed.containers
                };
                if (!mergedContainers.default) {
                    mergedContainers.default = { name: "Default", color: "grey", icon: "circle" };
                }
                const mergedSites = {
                    ...(current.siteContainerMap || {}),
                    ...(parsed.siteContainerMap || {})
                };
                await chrome.storage.local.set({
                    containers: mergedContainers,
                    siteContainerMap: mergedSites
                });
                await renderAll();
            } catch (err) {
                console.warn('Invalid backup JSON:', err);
            } finally {
                importFile.value = '';
            }
        });
    }

    // Export Enterprise Policy JSON (for GPO / Intune / Google Admin Console)
    if (exportPolicyBtn) {
        exportPolicyBtn.addEventListener('click', async () => {
            const data = await chrome.storage.local.get(["containers", "siteContainerMap"]);
            const rawContainers = data.containers || {};
            const rawSites = data.siteContainerMap || {};

            const policyContainers = [];
            for (const [id, c] of Object.entries(rawContainers)) {
                if (id === 'default' || !c || c.temporary) continue;
                policyContainers.push({
                    id: id,
                    name: c.name,
                    color: c.color || 'blue',
                    icon: c.icon || 'shield',
                    isolated: Boolean(c.isolated)
                });
            }

            const policySiteAssignments = Object.entries(rawSites).map(([domain, containerId]) => ({
                domain,
                containerId
            }));

            const enterprisePolicy = {
                containers: policyContainers,
                siteAssignments: policySiteAssignments,
                disableTemporaryContainers: false,
                allowUserContainers: true
            };

            const blob = new Blob([JSON.stringify(enterprisePolicy, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'chrome-enterprise-container-policy.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Add Manual Domain / Wildcard Site Rule
    if (addSiteBtn && newSiteDomainInput && newSiteContainerSelect) {
        addSiteBtn.addEventListener('click', async () => {
            let rawDomain = newSiteDomainInput.value.trim().toLowerCase();
            if (!rawDomain) return;

            // Strip protocol or path if user pasted a full URL
            if (rawDomain.startsWith('http://') || rawDomain.startsWith('https://')) {
                try {
                    rawDomain = new URL(rawDomain).hostname.toLowerCase();
                } catch (e) {}
            } else {
                rawDomain = rawDomain.split('/')[0];
            }

            const targetContainerId = newSiteContainerSelect.value;
            if (!rawDomain || !targetContainerId) return;

            const current = await chrome.storage.local.get("siteContainerMap");
            const siteMap = current.siteContainerMap || {};
            siteMap[rawDomain] = targetContainerId;
            await chrome.storage.local.set({ siteContainerMap: siteMap });
            newSiteDomainInput.value = '';
            await renderAll();
        });
    }

    async function renderAll() {
        const allData = await chrome.storage.local.get(null);
        const containers = allData.containers || {};
        const siteMap = allData.siteContainerMap || {};
        const managedSiteMap = allData.managedSiteMap || {};
        const enterpriseFlags = allData.enterpriseFlags || {};

        // Count how many domains have stored cookies per container
        const storedDomainCounts = {};
        for (const storageKey of Object.keys(allData)) {
            if (storageKey.startsWith("cookies_")) {
                const rest = storageKey.slice("cookies_".length);
                const splitIdx = rest.lastIndexOf("_");
                if (splitIdx > 0) {
                    const cId = rest.slice(0, splitIdx);
                    storedDomainCounts[cId] = (storedDomainCounts[cId] || 0) + 1;
                }
            }
        }

        // If enterprise policy disallows user-created containers, hide the New Container form unless editing
        const addForm = document.querySelector('.add-form');
        if (addForm && enterpriseFlags.allowUserContainers === false) {
            newNameInput.disabled = true;
            addBtn.disabled = true;
            newNameInput.placeholder = 'Disabled by Enterprise Policy';
        }

        populateSiteContainerSelect(containers);
        renderContainers(containers, storedDomainCounts);
        renderAssignedSites(siteMap, managedSiteMap, containers);
    }

    function populateSiteContainerSelect(containers) {
        if (!newSiteContainerSelect) return;
        const prevVal = newSiteContainerSelect.value;
        newSiteContainerSelect.textContent = '';

        const orderedKeys = [
            ...(containers.default ? ['default'] : []),
            ...Object.keys(containers).filter(k => k !== 'default')
        ];

        orderedKeys.forEach(key => {
            const c = containers[key];
            if (!c || c.temporary) return;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = c.name;
            newSiteContainerSelect.appendChild(opt);
        });

        if (prevVal && containers[prevVal]) {
            newSiteContainerSelect.value = prevVal;
        } else if (orderedKeys.length > 1) {
            newSiteContainerSelect.value = orderedKeys[1];
        }
    }

    async function moveContainerOrder(containers, key, direction) {
        const nonDefaultKeys = Object.keys(containers).filter(k => k !== 'default');
        const idx = nonDefaultKeys.indexOf(key);
        const targetIdx = idx + direction;
        if (idx < 0 || targetIdx < 0 || targetIdx >= nonDefaultKeys.length) return;

        const temp = nonDefaultKeys[idx];
        nonDefaultKeys[idx] = nonDefaultKeys[targetIdx];
        nonDefaultKeys[targetIdx] = temp;

        const reordered = {};
        if (containers.default) {
            reordered.default = containers.default;
        }
        for (const k of nonDefaultKeys) {
            reordered[k] = containers[k];
        }
        await chrome.storage.local.set({ containers: reordered });
        await renderAll();
    }

    function renderContainers(containers, storedDomainCounts = {}) {
        listElement.textContent = '';

        // Always place "default" container at the very top
        const orderedKeys = [
            ...(containers.default ? ['default'] : []),
            ...Object.keys(containers).filter(k => k !== 'default')
        ];

        const nonDefaultKeys = orderedKeys.filter(k => k !== 'default');

        orderedKeys.forEach(key => {
            const container = containers[key];
            const item = document.createElement('div');
            item.className = 'item';

            const dotColor = COLOR_MAP[container.color] || container.color || '#8f8f9d';
            const iconChar = ICON_MAP[container.icon] || '●';

            const infoDiv = document.createElement('div');
            infoDiv.className = 'item-info';

            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'icon-badge';
            badgeDiv.style.backgroundColor = dotColor;
            badgeDiv.textContent = iconChar;

            const nameDiv = document.createElement('div');
            let label = container.name;
            if (container.isolated) label += ' 🔒';
            if (container.managed) label += ' 🏢';
            nameDiv.textContent = label;

            infoDiv.append(badgeDiv, nameDiv);

            if (key !== 'default') {
                const domainCount = storedDomainCounts[key] || 0;
                if (domainCount > 0) {
                    const countSpan = document.createElement('span');
                    countSpan.className = 'site-badge';
                    countSpan.textContent = `(${domainCount} ${domainCount === 1 ? 'site' : 'sites'})`;
                    countSpan.title = `${domainCount} domain(s) with saved cookies in ${container.name}`;
                    infoDiv.appendChild(countSpan);
                }
            }

            item.appendChild(infoDiv);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'item-actions';

            if (key !== 'default') {
                const pos = nonDefaultKeys.indexOf(key);

                // Move Up button
                if (pos > 0) {
                    const upBtn = document.createElement('button');
                    upBtn.className = 'action-btn';
                    upBtn.textContent = '↑';
                    upBtn.title = 'Move Up';
                    upBtn.addEventListener('click', () => moveContainerOrder(containers, key, -1));
                    actionsDiv.appendChild(upBtn);
                }

                // Move Down button
                if (pos >= 0 && pos < nonDefaultKeys.length - 1) {
                    const downBtn = document.createElement('button');
                    downBtn.className = 'action-btn';
                    downBtn.textContent = '↓';
                    downBtn.title = 'Move Down';
                    downBtn.addEventListener('click', () => moveContainerOrder(containers, key, 1));
                    actionsDiv.appendChild(downBtn);
                }

                // Clear container cookies & site storage button (hidden for Default so no accidents happen)
                const clearBtn = document.createElement('button');
                clearBtn.className = 'action-btn';
                clearBtn.textContent = '🧹';
                clearBtn.title = `Clear cookies & storage for ${container.name}`;
                clearBtn.addEventListener('click', async () => {
                    await chrome.runtime.sendMessage({
                        type: "CLEAR_CONTAINER_DATA",
                        containerId: key
                    });
                    clearBtn.textContent = '✓';
                    setTimeout(() => { renderAll(); }, 600);
                });
                actionsDiv.appendChild(clearBtn);

                if (!container.managed) {
                    // Edit container button
                    const editBtn = document.createElement('button');
                    editBtn.className = 'action-btn';
                    editBtn.textContent = '✎';
                    editBtn.title = `Edit ${container.name}`;
                    editBtn.addEventListener('click', () => startEditing(key, container));
                    actionsDiv.appendChild(editBtn);

                    // Delete container button
                    const delBtn = document.createElement('button');
                    delBtn.className = 'action-btn delete';
                    delBtn.textContent = '\u00D7';
                    delBtn.title = `Delete ${container.name}`;
                    delBtn.addEventListener('click', async () => {
                        if (editingContainerId === key) resetForm();
                        await chrome.runtime.sendMessage({
                            type: "DELETE_CONTAINER",
                            containerId: key
                        });
                        await renderAll();
                    });
                    actionsDiv.appendChild(delBtn);
                } else {
                    const policyLabel = document.createElement('span');
                    policyLabel.className = 'site-badge';
                    policyLabel.textContent = 'Policy';
                    actionsDiv.appendChild(policyLabel);
                }
            } else {
                const defaultLabel = document.createElement('span');
                defaultLabel.className = 'site-badge';
                defaultLabel.textContent = 'Default';
                actionsDiv.appendChild(defaultLabel);
            }

            item.appendChild(actionsDiv);
            listElement.appendChild(item);
        });
    }

    function renderAssignedSites(siteMap, managedSiteMap, containers) {
        siteListElement.textContent = '';
        const combinedMap = { ...siteMap, ...managedSiteMap };
        const domains = Object.keys(combinedMap);

        if (domains.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No sites assigned yet.';
            siteListElement.appendChild(empty);
            return;
        }

        domains.forEach(domain => {
            const isManaged = Boolean(managedSiteMap && managedSiteMap[domain]);
            const containerId = combinedMap[domain];
            const container = containers[containerId];
            const item = document.createElement('div');
            item.className = 'item';

            const infoDiv = document.createElement('div');
            infoDiv.className = 'item-info';

            const badgeDiv = document.createElement('div');
            badgeDiv.className = 'icon-badge';
            badgeDiv.style.backgroundColor = container
                ? (COLOR_MAP[container.color] || container.color || '#8f8f9d')
                : '#8f8f9d';
            badgeDiv.textContent = container ? (ICON_MAP[container.icon] || '●') : '●';

            const domainSpan = document.createElement('span');
            domainSpan.textContent = isManaged ? `${domain} 🏢` : domain;

            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'site-badge';
            badgeSpan.textContent = container ? `(${container.name})` : `(${containerId})`;

            infoDiv.append(badgeDiv, domainSpan, badgeSpan);
            item.appendChild(infoDiv);

            if (!isManaged) {
                const delBtn = document.createElement('button');
                delBtn.className = 'action-btn delete';
                delBtn.textContent = '\u00D7';
                delBtn.title = 'Remove Site Assignment';
                delBtn.addEventListener('click', async () => {
                    const current = await chrome.storage.local.get("siteContainerMap");
                    const updatedMap = current.siteContainerMap || {};
                    delete updatedMap[domain];
                    await chrome.storage.local.set({ siteContainerMap: updatedMap });
                    await renderAll();
                });
                item.appendChild(delBtn);
            } else {
                const policyBadge = document.createElement('span');
                policyBadge.className = 'site-badge';
                policyBadge.textContent = 'Policy';
                item.appendChild(policyBadge);
            }

            siteListElement.appendChild(item);
        });
    }
});
