# Chrome Multi-Account Containers

> **Firefox-Style Multi-Account Containers for Google Chrome.**
> *Isolate your online identities with encrypted per-container cookie jars, isolated web storage (`localStorage`, `sessionStorage`, `IndexedDB`), Temporary Containers, Split View, and Enterprise Policy management.*

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.3.0-green.svg)
![Chrome](https://img.shields.io/badge/platform-Chrome%20MV3-red.svg)

---

## 📖 Overview

**Chrome Multi-Account Containers** lets you separate your work, personal, banking, development, and disposable browsing sessions into color-coded **Containers**—just like Firefox Multi-Account Containers.

Each container maintains its own **AES-256-GCM encrypted cookie jar** (scoped by registrable domain / eTLD+1 so multi-subdomain logins like `accounts.google.com` → `mail.google.com` work seamlessly) alongside isolated `localStorage`, `sessionStorage`, `IndexedDB`, `CacheStorage`, and `BroadcastChannel` namespaces.

---

## ✨ Key Features

- **🍪 Deep Session & Storage Isolation**:
  - **Registrable-Domain (eTLD+1) Cookie Isolation**: Sign into multiple accounts on Google, Microsoft 365, AWS, GitHub, and other multi-subdomain sites simultaneously.
  - **AES-256-GCM Encryption at Rest**: Inactive container cookie snapshots are encrypted in `chrome.storage.local` using the Web Crypto API (`crypto.subtle`).
  - **Network-Layer Background Leak Prevention**: Uses `chrome.declarativeNetRequest` session rules to prevent inactive background tabs in other containers from sending or overwriting the active container's cookies.
  - **Isolated Web Storage**: Isolates `localStorage`, `sessionStorage`, `IndexedDB`, `CacheStorage`, and `BroadcastChannel` per container in the page's main world (including `Storage.prototype` and `about:blank` iframe hardening).
- **🔥 Temporary / Burner Containers**:
  - Spawn disposable `Temp #N` containers with a single click or hotkey. When the last tab in a Temporary Container is closed, its container, cookies, and storage are automatically destroyed.
- **◫ Side-by-Side Split View & Instant Hover/Scroll Switching**:
  - Tile your current tab on the left 50% of your screen and open a target container on the right 50% in one click. Moving your cursor into or scrolling either pane immediately activates that pane's container cookies.
- **📌 Site Assignments, Wildcards & Strict Mode**:
  - **Always Open This Site in...**: Bind specific domains (`github.com`) or wildcard patterns (`*.corp.example.com`) to a container.
  - **🔒 Limit to Designated Sites**: Optional strict mode per container that automatically opens non-designated external links back in the `Default` container.
  - **Smart OAuth / SSO Protection**: Child OAuth popups (*"Sign in with Google / Microsoft / GitHub"*) remain inside the container that initiated the login.
- **🎨 Visual Organization & Tab Group Sync**:
  - **36 Icons & 19 Preset Colors + Custom Hex Picker**: Customize every container's look.
  - **Two-Way Chrome Tab Group Integration**: Container tabs are automatically grouped by container. Dragging a tab into a container's Tab Group assigns it to that container and reloads its session; dragging it out converts it back to `Default`.
  - **Click Tab Count (`3 ▾`) Drawer**: Expand any container in the popup to view, jump to, or close individual open tabs.
- **🏢 Enterprise Policy Support (`chrome.storage.managed`)**:
  - Deploy pre-configured, locked containers and domain/wildcard rules across an organization via Windows Group Policy (GPO), Microsoft Intune, Jamf, or Google Admin Console.

---

## ⌨️ Keyboard Shortcuts

Customize these anytime at `chrome://extensions/shortcuts`:

| Action | Default Shortcut |
| :--- | :--- |
| Open Multi-Account Containers Popup | `Alt + Shift + C` |
| Open a New **Temporary Container** Tab | `Alt + Shift + T` |
| Reopen Current Tab in a **Temporary Container** | `Alt + Shift + R` |
| Duplicate Current Tab in a **Temporary Container** | `Alt + Shift + D` |

---

## 🚀 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/binyaminyblatt/Chrome-Multi-Account-Containers.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.

---

## 🏢 Enterprise Policy Deployment (`schema.json`)

IT administrators can pre-configure and enforce containers and domain rules using Chrome's managed storage policy ([`schema.json`](schema.json)).

### Generating a Policy File
1. Open the extension popup → **Manage Containers**.
2. Create your organization's containers and wildcard domain rules (`*.internal.company.com`).
3. Click **🏢 Policy JSON** at the bottom of **Manage Containers** to download `chrome-enterprise-container-policy.json`.

### Example Policy JSON
```json
{
  "containers": [
    {
      "id": "corp-sso",
      "name": "Corporate SSO",
      "color": "navy",
      "icon": "shield",
      "isolated": true
    },
    {
      "id": "aws-prod",
      "name": "AWS Production",
      "color": "orange",
      "icon": "cloud",
      "isolated": false
    }
  ],
  "siteAssignments": [
    {
      "domain": "*.corp.example.com",
      "containerId": "corp-sso"
    },
    {
      "domain": "*.console.aws.amazon.com",
      "containerId": "aws-prod"
    }
  ],
  "disableTemporaryContainers": false,
  "allowUserContainers": true
}
```

### Deploying the Policy
- **Google Admin Console**: Navigate to *Devices → Chrome → Apps & extensions → Users & browsers*, select the extension, and paste the JSON under **Policy for extensions**.
- **Windows Registry / GPO**: Place the policy values under:
  ` HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy`
- **macOS (Jamf / MDM)**: Deploy a configuration profile targeting `com.google.Chrome.extensions.<EXTENSION_ID>`.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

---

<div align="center">
  Maintained by <a href="https://github.com/binyaminyblatt">Binyamin Blatt</a> (Originally built by <a href="https://credshields.com">CredShields</a>)
</div>
