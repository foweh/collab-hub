# CollabStudio 🎬

> **Real-time collaborative creative studio** — Write scripts, draw mind maps, and tell stories together over LAN. Zero setup, no cloud dependency.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ Features

| Feature | Description |
|---|---|
| **📜 Script Writer** | Multi-act, scene-by-scene screenplay editor with character dialogues |
| **🧠 Mind Map** | Elegant visual mind mapping with bezier curves, gradients & zoom |
| **📖 Story Editor** | Chapter-based story writing with real-time sync |
| **💬 Group Chat** | Built-in chat across all connected devices |
| **🔒 Conflict Lock** | Zero-latency presence system — see who's editing what, prevents conflicts |
| **📤 Project Transfer** | Select & send projects to specific teammates |
| **🔌 LAN Discovery** | Automatic peer discovery via UDP broadcast |
| **⏱️ 5-min Scan** | Smart scan timeout with user notification |
| **🧪 Local Test Mode** | Run two instances on one machine for testing |

---

## 🚀 Quick Start

### 1. Install

```bash
git clone https://github.com/<你的用户名>/collab-studio.git
cd collab-studio
npm install
```

### 2. Start

```bash
npm start
```

Open `http://localhost:3000` in your browser.

### 3. Collaborate

Everyone on the same LAN opens the same URL, turns on **LAN Mode**, and they'll automatically discover each other within 5 minutes.

---

## 🧪 Testing on One Machine

Run two instances to simulate two computers:

```bash
# Terminal 1 — User A
node server.js

# Terminal 2 — User B (auto-joins A)
node server.js --port 3001 --join localhost:3000
```

Then open:
- **http://localhost:3000** → User A
- **http://localhost:3001** → User B

### One-click scripts

| OS | Command |
|---|---|
| Windows | `test.bat` |
| macOS / Linux | `./test.sh` |

---

## 🏗 Architecture

```
Computer A                        Computer B
┌──────────────────┐             ┌──────────────────┐
│  Browser ←WS→    │             │  Browser ←WS→    │
│  Node.js Server  │◄───UDP─────►│  Node.js Server  │
│  (port 3000)     │◄───WS──────►│  (port 3000)     │
└──────────────────┘             └──────────────────┘
       ↕ Socket.IO                      ↕ Socket.IO
    Script / Mindmap / Story       Script / Mindmap / Story
    Chat / Projects / Locks        Chat / Projects / Locks
```

### Data flow

```
User edits node → focus-lock (instant broadcast) → everyone sees 🔒
User saves      → projects-sync (via WS bridge)  → peer servers merge
Real-time edits → realtime event (with dedup)    → all browsers update
```

### Conflict resolution

| Scenario | Handling |
|---|---|
| A edits node, B clicks same node | B sees 🔒 lock, edit blocked |
| A & B click simultaneously | Server: first wins, second sees lock |
| A disconnects mid-edit | Server auto-releases all A's locks |

---

## 🗂 Project Structure

```
collab-studio/
├── server.js                # Express + Socket.IO + UDP discovery + bridge
├── package.json
├── test.bat / test.sh       # One-click local test scripts
├── public/
│   ├── index.html           # Main entry — 5-panel navigation
│   ├── style.css            # Dark theme UI
│   ├── app.js               # Router, projects, device management, chat
│   ├── script-editor.js     # Screenplay editor (acts/scenes/dialogues)
│   ├── mindmap.js           # Mind map engine (bezier/gradients/zoom)
│   ├── mindmap-full.html    # Fullscreen mind map page
│   ├── story-editor.js      # Story editor (chapters/content)
│   └── devices.js           # Device list & notes
```

---

## ⌨️ Mind Map Shortcuts

| Key | Action |
|---|---|
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| `Delete` / `Backspace` | Delete selected node(s) |
| `Space` / `F2` | Edit node text |
| `Shift + Click` | Multi-select |
| `Ctrl + Scroll` | Zoom in/out |
| `Drag (background)` | Pan canvas |

---

## 🌐 Multi-Computer LAN

Real multi-computer collaboration uses **UDP broadcast** for discovery:

1. Every server broadcasts a `discover` packet to `255.255.255.255:41234` every 5s
2. Other servers reply with `hello` containing their server ID and name
3. **Arbitration**: lower server ID initiates the WebSocket bridge connection
4. Once connected, all state stays in sync via the bridge

No router configuration needed — UDP broadcast works on any typical LAN.

---

## 📄 License

MIT — feel free to use, modify, and share.

---

## 🌐 Bilingual UI

Toggle between **中文** and **English** with the language button in the top-right corner. Settings are saved to localStorage.

---

**Made with ❤️ for creative teams who work together in the same room.**
