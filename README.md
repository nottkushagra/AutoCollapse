# AutoCollapse 🗂️

> Automatically collapse inactive Chrome tab groups when you switch between them.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

## 🤔 Problem

You use tab groups to organize your work — Research, Code, Social, etc. But as you switch between groups, they all stay expanded. Your tab bar becomes a cluttered mess of 40+ tabs, and you can't find anything.

## ✅ Solution

**AutoCollapse** watches which tab group you're currently using. When you switch to a different group, it automatically collapses all other groups — keeping your tab bar clean and focused.

## ✨ Features

### Current (v0.1.0)
- [x] Extension loads in Chrome
- [ ] Collapse all groups (coming in v0.2.0)
- [ ] Expand all groups (coming in v0.3.0)
- [ ] Auto-collapse on tab switch (coming in v0.4.0)

### Planned
- ⏱️ Auto-collapse after inactivity
- 📚 Workspace modes (Study / Entertainment)
- 📊 Analytics dashboard
- ⚙️ Settings page

## 🚀 Installation (Developer Mode)

Since this extension isn't on the Chrome Web Store yet, install it manually:

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

## 🏗️ Project Structure

```
AutoCollapse/
├── manifest.json              # Extension configuration (Manifest V3)
├── src/
│   ├── background/
│   │   └── service-worker.js  # Background event listeners
│   └── popup/
│       ├── popup.html         # Popup UI (click extension icon)
│       ├── popup.css          # Popup styles
│       └── popup.js           # Popup logic
├── assets/
│   └── icons/                 # Extension icons (coming soon)
├── docs/                      # Project documentation
├── screenshots/               # Chrome Web Store screenshots
├── .gitignore                 # Git ignore rules
├── README.md                  # This file
└── LICENSE                    # MIT License
```

## 🛠️ Tech Stack

- **Platform**: Chrome Extensions API (Manifest V3)
- **Languages**: JavaScript, HTML, CSS
- **APIs Used**: `chrome.tabGroups`, `chrome.tabs`, `chrome.storage`

## 📝 Development Roadmap

| Milestone | Feature | Status |
|-----------|---------|--------|
| 1 | Basic extension loads | ✅ Done |
| 2 | Collapse all groups button | 🔲 Next |
| 3 | Expand all groups button | 🔲 Planned |
| 4 | Auto-collapse on tab switch | 🔲 Planned |
| 5 | Settings page | 🔲 Planned |
| 6 | Inactivity timer | 🔲 Planned |
| 7 | Workspace modes | 🔲 Planned |
| 8 | Analytics dashboard | 🔲 Planned |
| 9 | Chrome Web Store release | 🔲 Planned |

## 🤝 Contributing

This is a learning project! If you'd like to contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'feat: add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

Built with 💙 as a learning project for professional Chrome Extension development.
