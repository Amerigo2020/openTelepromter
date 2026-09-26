# openTeleprompter

A free, open-source teleprompter for **Windows** and **Linux** with real-time word tracking, classic auto-scroll, and voice-activated scrolling.

Inspired by [Textream](https://github.com/f/textream) (macOS only), openTeleprompter brings the same full feature set to Windows and Linux as a lightweight Electron app.

## Features

### 3 Guidance Modes
- **Word Tracking** — Speech recognition follows you through the script and always moves to the last word it heard. It tolerates a few dropped or misheard words, but only jumps to another sentence (skipped ahead or started over) once several words in a row clearly match there (2–4 words, configurable). Fuzzy matching handles inflections, umlauts and numbers ("drei" = "3"), and annotations are skipped. Uses the Chromium Web Speech API; if recognition is unavailable, the overlay says so and falls back to Classic Scroll.
- **Classic Scroll** — Constant-speed auto-scrolling (0.5–8 words/sec). No microphone required.
- **Voice-Activated Scroll** — Scrolls when you speak, pauses during silence. Natural, hands-free pacing.

### Reels & Timing
- Estimated speaking time per page in the status bar and the Reels & Timing panel
- Learns your speaking pace from finished Word Tracking takes (takes with jumps or manual navigation are not used)
- Target length (15 s, 30 s, 60 s, 90 s, 3 min) with a "fits" / "too long, cut ~N words" hint
- Overlay shows the take time and the projected total length, turning orange/red when the take is about to exceed the target
- Take loop: after the last word, a short break (3/5/10 s), then the next take starts from the top
- Every take's length is listed in the control window; restart a take anytime with `R` or the Restart button

### 3 Display Modes
- **Floating** — Draggable, transparent overlay with adjustable opacity. Always on top.
- **Pinned Top** — Anchored to the top center of the screen.
- **Fullscreen** — Full-screen display. Press Escape to close.

### Multi-Page Support
- Page sidebar with numbered page buttons
- Add and delete pages (right-click context menu)
- Read/unread checkmarks per page
- Auto next page with configurable countdown (3 or 5 seconds)
- Page indicator in overlay

### Remote Connection
- Built-in HTTP + WebSocket server for viewing on any device (phone, tablet, TV)
- Real-time synchronization of word position, progress, and state
- Connection URL with copy-to-clipboard
- QR code display for instant access
- Configurable port (default 7373)
- All traffic stays on local network

### External Display
- Output to external monitors
- Modes: Off, Teleprompter, Mirror
- Mirror axis: Horizontal, Vertical, Both (180°)
- Real-time sync from primary display

### File Support
- Import `.txt` and `.md` text files
- Import `.pptx` PowerPoint presenter notes (extracts notes from all slides)
- Save/Load `.json` project files (multi-page with settings)
- Drag & drop file import
- Unsaved changes indicator (orange dot)

### Customization
- Font: System, Georgia, Courier, Arial, OpenDyslexic
- Font size: 14–48pt
- 6 highlight colors (White, Yellow, Green, Blue, Pink, Purple)
- Background opacity: 20–100%
- Overlay dimensions: 280–800px width, 80–500px height
- Mirror/flip mode for physical prompter rigs
- 20+ speech recognition languages

### Overlay Features
- Click any word to jump to that position
- Mouse scroll to jump forward/back
- Live waveform visualization
- Microphone activity indicator (yellow dot)
- Last spoken text display (RTL)
- Elapsed time display (toggleable)
- Progress bar
- Completion screen with checkmark animation
- Page countdown overlay for auto-advance
- Annotation detection — skips `[bracketed]` and `(parenthesized)` stage directions

### System Integration
- System tray icon with quick controls (Start/Stop, Pause, Quit)
- Settings persistence between sessions
- Global keyboard shortcuts
- Collapsible settings sections

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Pause / Resume (global) |
| `Escape` | Close overlay (global) |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save file |
| `Space` (overlay) | Pause / Resume |
| `R` (overlay) | Restart take from the top |
| `Arrow Up/Down` (overlay) | Jump 5 words |
| `Arrow Left/Right` (overlay) | Jump 1 word |
| Mouse scroll (overlay) | Jump 3 words |

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm start
```

### Test

```bash
npm test
```

### Build

```bash
# Windows
npm run build:win

# Linux
npm run build:linux
```

## Project Structure

```
src/
  main.js          — Electron main process (windows, tray, server, IPC)
  control.html     — Editor/control UI (script input, settings, pages)
  prompter.html    — Teleprompter overlay (display, modes, tracking)
  speech-tracker.js — Aligns recognized speech with the script (Word Tracking)
  timing.js        — Speaking-time estimates, learned pace, Reel targets
test/              — Unit tests (node --test)
```

## Tech Stack

- **Electron** — Cross-platform desktop framework
- **Web Speech API** — On-device speech recognition
- **ws** — WebSocket server for remote connections
- **jszip** — PowerPoint .pptx import
- **Vanilla HTML/CSS/JS** — No framework dependencies

## License

MIT
