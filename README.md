# AutoCollapse 🗂️

> Automatically collapse inactive Chrome tab groups when you switch between them.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

---

## 🤔 The Problem

You use tab groups to organize your work — Research, Code, Social, etc. But as you switch between groups, they all stay expanded. Your tab bar becomes a cluttered mess of 40+ tabs, and you can't find anything.

## ✅ The Solution

**AutoCollapse** watches which tab group you're currently using. When you switch to a different group, it automatically collapses all other groups — keeping your tab bar clean and focused.

---

## ✨ Features

- **Auto-collapse on tab switch** — switch to a group, all others collapse automatically
- **Manual controls** — Collapse All / Expand All buttons for quick actions
- **Multi-window support** — works seamlessly across multiple Chrome windows
- **Inactivity timer** — collapse all groups after a configurable idle period (seconds or minutes)
- **Analytics dashboard** — track tab switches, groups collapsed, most-used group, and 7-day activity chart
- **Settings sync** — preferences sync across devices via Chrome Sync
- **Custom icons** — gradient blue/purple icon at 16, 48, and 128px

---

## 🚀 Installation

### Developer Mode (Manual)

1. **Clone the repository**
   ```bash
   git clone https://github.com/nottkushagra/AutoCollapse.git
   ```

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/`
   - Or: Menu → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the `AutoCollapse` folder (the one containing `manifest.json`)

5. **Pin the extension**
   - Click the puzzle piece icon (🧩) in the toolbar
   - Pin "AutoCollapse" for easy access

---

## 🏗️ Project Structure

```
AutoCollapse/
├── manifest.json              # Extension configuration (Manifest V3)
├── src/
│   ├── background/
│   │   └── service-worker.js  # Auto-collapse engine, alarms, analytics tracking
│   └── popup/
│       ├── popup.html         # Popup UI (Main + Analytics tabs)
│       ├── popup.css          # Styles (design tokens, dark theme, components)
│       └── popup.js           # Popup logic (settings, analytics, chart rendering)
├── assets/
│   └── icons/                 # Extension icons (16, 48, 128px — SVG + PNG)
├── docs/                      # Project documentation
├── screenshots/               # Chrome Web Store screenshots
├── CHROMEWEBSTORE.md           # Chrome Web Store listing metadata
├── .gitignore                 # Git ignore rules
├── README.md                  # This file
└── LICENSE                    # MIT License
```

## 🛠️ Tech Stack

- **Platform**: Chrome Extensions API (Manifest V3)
- **Languages**: JavaScript, HTML, CSS
- **APIs Used**: `chrome.tabGroups`, `chrome.tabs`, `chrome.storage`, `chrome.alarms`, `chrome.windows`

---

## 🧠 How It Works

AutoCollapse runs as a Manifest V3 service worker with a few simple rules:

| Rule | Trigger | Action |
|------|---------|--------|
| **Active Group** | Switch to a tab in a group | Expand that group, collapse all others |
| **Group Switch** | Switch from one group to another | Old group collapses, new group expands |
| **Ungrouped Tab** | Click a tab not in any group | Collapse ALL groups |
| **Single Group** | Only one group exists | Keep it expanded while active |
| **Browser Startup** | Chrome launches | Detect active tab, apply rules immediately |
| **Window Switch** | Focus moves to another window | Apply rules in the newly focused window |
| **Inactivity Timer** | No tab activity for configured duration | Collapse ALL groups across all windows |

Tab switches are **debounced** (50ms) to avoid rapid-fire processing during fast switching. Group updates include **retry logic** (up to 3 attempts) to handle transient Chrome API errors.

---

## 🧪 Testing

### Manual Testing Checklist

1. **Auto-collapse**: Create 3+ tab groups → switch between tabs in different groups → other groups should collapse
2. **Ungrouped tabs**: Click a tab not in any group → all groups should collapse
3. **Window switching**: Open two Chrome windows with groups → switch between windows → groups auto-collapse in the focused window
4. **Toggle on/off**: Disable auto-collapse → switch tabs → nothing should collapse → re-enable → verify it works again
5. **Inactivity timer**: Enable timer with minimum duration → stop interacting → all groups collapse after the timer fires
6. **Analytics**: Switch tabs several times → open the Analytics tab → verify counts and chart update
7. **Reset stats**: Click "Reset All Stats" → verify all analytics return to 0
8. **Settings persistence**: Change settings → close popup → reopen → verify all settings are preserved

### Required Permissions

| Permission | Purpose |
|---|---|
| `tabGroups` | Query and update tab group collapsed state |
| `tabs` | Read active tab's group membership |
| `storage` | Persist settings (sync) and analytics (local) |
| `alarms` | Inactivity timer via `chrome.alarms` API |

---

## 🤝 Contributing

Contributions are welcome! If you'd like to help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'feat: add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

Built with 💙 by [nottkushagra](https://github.com/nottkushagra)
