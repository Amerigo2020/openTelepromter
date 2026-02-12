# openTeleprompter

A free, open-source teleprompter for **Windows** and **Linux** with real-time word tracking, classic auto-scroll, and voice-activated scrolling.

Inspired by [Textream](https://github.com/f/textream) (macOS only), openTeleprompter brings the same functionality to Windows and Linux as a lightweight Electron app.

## Features

### Guidance Modes
- **Word Tracking** — Uses on-device speech recognition to highlight words as you speak. All processing happens locally.
- **Classic Scroll** — Constant-speed auto-scrolling without microphone. Set your pace from 0.5–8 words per second.
- **Voice-Activated Scroll** — Scrolls when you speak, pauses during silence. Hands-free and natural.

### Display Modes
- **Floating** — Draggable, translucent overlay window with adjustable opacity. Always on top.
- **Pinned Top** — Anchored to the top of the screen, bar-style overlay.
- **Fullscreen** — Full-screen display on any monitor. Press Escape to close.

### Customization
- Adjustable overlay dimensions (280–800px width, 80–500px height)
- Font selection including OpenDyslexic for accessibility
- Font size from 14–48pt
- 6 highlight color options
- Background opacity control (20–100%)
- Mirror/flip mode for physical prompter rigs

### Additional Features
- Import `.txt` files
- Click any word to jump to that position
- Live waveform display showing microphone activity
- Progress bar
- Global keyboard shortcuts

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Pause / Resume |
| `Escape` | Close overlay |
| `Space` (in overlay) | Pause / Resume |
| `Arrow Up/Down` (in overlay) | Jump 5 words back/forward |

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm start
```

### Build

```bash
# Windows
npm run build:win

# Linux
npm run build:linux
```

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **Web Speech API** — On-device speech recognition for word tracking and voice modes
- **Vanilla HTML/CSS/JS** — No framework dependencies, minimal and fast

## License

MIT
