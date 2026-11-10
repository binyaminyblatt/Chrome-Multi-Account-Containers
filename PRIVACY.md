# Privacy Policy for Chrome Multi-Account Containers

**Last Updated:** November 10, 2026

## 1. Data Collection
**We do not collect, transmit, rent, or sell any of your personal or browsing data.**

The **Chrome Multi-Account Containers** extension runs 100% locally on your device. We do not operate backend servers, and we do not include any third-party analytics, telemetry, or tracking scripts.

## 2. Permissions & How They Are Used

To isolate browsing sessions across containers, the extension requests the following Chrome permissions:

* **`<all_urls>` (Host Permission)**: Required to swap domain cookies when switching between container tabs and to inject per-container web storage isolation (`localStorage`, `sessionStorage`, `IndexedDB`, `CacheStorage`) before page scripts execute.
* **`cookies`**: Used to snapshot, clear, and restore domain cookies when switching between containers. Inactive cookie snapshots are encrypted locally at rest using AES-256-GCM (`crypto.subtle`) and never leave your browser.
* **`storage` & `unlimitedStorage`**: Used to store your container configurations, site-to-container assignments, and encrypted container cookie jars locally in `chrome.storage.local`, as well as reading optional organization configurations from `chrome.storage.managed`.
* **`tabs` & `tabGroups`**: Used to associate tabs with containers, visually organize container tabs into color-coded Chrome Tab Groups, and support Split View and window management.
* **`webNavigation` & `scripting`**: Used to detect navigation commits at the earliest possible stage (`injectImmediately: true`) so `localStorage`, `sessionStorage`, `IndexedDB`, and `BroadcastChannel` are isolated per container, and to detect pane focus/scroll interactions in Split View.
* **`declarativeNetRequest`**: Used exclusively to apply session-scoped rules that prevent inactive background tabs in other containers from leaking or overwriting the active container's `Cookie` and `Set-Cookie` headers.
* **`contextMenus`**: Used to provide right-click menu options (*"Open Link in New Container Tab"*, *"Duplicate This Tab in Container"*, *"Split View This Tab in Container"*, and *"Reopen This Tab in Container"*).

## 3. Third-Party Services
This extension does not communicate with any external or third-party servers.

## 4. Contact
The source code for this extension is open source and available for audit at [https://github.com/binyaminyblatt/Chrome-Multi-Account-Containers](https://github.com/binyaminyblatt/Chrome-Multi-Account-Containers).

If you have any questions, please open an issue on our GitHub repository.
