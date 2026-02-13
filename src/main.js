const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

let controlWindow = null;
let prompterWindow = null;
let externalWindow = null;
let tray = null;
let httpServer = null;
let wss = null;
let remoteState = { active: false, words: [], currentIndex: 0, settings: {} };

// Settings persistence
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {}
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// ==========================================
// WINDOWS
// ==========================================

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 580,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: 'openTeleprompter',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  controlWindow.loadFile(path.join(__dirname, 'control.html'));
  controlWindow.setMenuBarVisibility(false);

  controlWindow.on('closed', () => {
    controlWindow = null;
    if (prompterWindow) prompterWindow.close();
    if (externalWindow) externalWindow.close();
    stopRemoteServer();
    app.quit();
  });

  // Send saved settings after load
  controlWindow.webContents.on('did-finish-load', () => {
    const saved = loadSettings();
    if (saved) {
      controlWindow.webContents.send('load-settings', saved);
    }
  });
}

function createPrompterWindow(options) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const winOptions = {
    width: options.width || 480,
    height: options.height || 200,
    x: options.x ?? Math.round((screenWidth - (options.width || 480)) / 2),
    y: options.y ?? 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  };

  if (options.mode === 'pinned') {
    winOptions.x = Math.round((screenWidth - (options.width || 480)) / 2);
    winOptions.y = 0;
  }

  if (options.mode === 'fullscreen') {
    winOptions.width = screenWidth;
    winOptions.height = screenHeight;
    winOptions.x = 0;
    winOptions.y = 0;
    winOptions.resizable = false;
  }

  prompterWindow = new BrowserWindow(winOptions);
  prompterWindow.loadFile(path.join(__dirname, 'prompter.html'));
  prompterWindow.setMenuBarVisibility(false);

  if (options.mode === 'fullscreen') {
    prompterWindow.setFullScreen(true);
  }

  prompterWindow.on('closed', () => {
    prompterWindow = null;
    if (controlWindow) {
      controlWindow.webContents.send('prompter-closed');
    }
  });

  return prompterWindow;
}

function createExternalWindow(displayId) {
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id === displayId) || displays[displays.length - 1];

  if (!targetDisplay || targetDisplay.id === screen.getPrimaryDisplay().id) return null;

  externalWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  externalWindow.loadFile(path.join(__dirname, 'prompter.html'));
  externalWindow.setMenuBarVisibility(false);

  externalWindow.on('closed', () => {
    externalWindow = null;
  });

  return externalWindow;
}

// ==========================================
// SYSTEM TRAY
// ==========================================

function createTray() {
  // Create a simple 16x16 tray icon
  const icon = nativeImage.createFromBuffer(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVQ4T2P8z8BQz0BAwMDAwMjIyMDIwMDwn4GB4T8DA8N/BgYGRkZGhv8MDAwMDAwM/xkYGP4zMDD8Z2RkYGBkZGAAAAf0C/UAAAAASUVORK5CYII=', 'base64')
  );

  tray = new Tray(icon);
  tray.setToolTip('openTeleprompter');

  updateTrayMenu();
}

function updateTrayMenu(isRunning = false) {
  if (!tray) return;

  const template = [
    { label: 'openTeleprompter', enabled: false },
    { type: 'separator' },
    {
      label: 'Show Control Window',
      click: () => {
        if (controlWindow) {
          controlWindow.show();
          controlWindow.focus();
        }
      }
    },
    {
      label: isRunning ? 'Stop Prompter' : 'Start Prompter',
      click: () => {
        if (controlWindow) {
          controlWindow.webContents.send(isRunning ? 'tray-stop' : 'tray-start');
        }
      }
    },
    {
      label: 'Pause / Resume',
      enabled: isRunning,
      click: () => {
        if (prompterWindow) {
          prompterWindow.webContents.send('toggle-pause');
        }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ==========================================
// REMOTE SERVER (HTTP + WebSocket)
// ==========================================

function startRemoteServer(port = 7373) {
  if (httpServer) stopRemoteServer();

  const browserHTML = generateBrowserPage();

  httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(browserHTML);
  });

  wss = new WebSocketServer({ port: port + 1 });

  wss.on('connection', (ws) => {
    // Send current state immediately
    ws.send(JSON.stringify(remoteState));
  });

  httpServer.listen(port, '0.0.0.0', () => {
    const ip = getLocalIP();
    if (controlWindow) {
      controlWindow.webContents.send('remote-server-started', { ip, port, url: `http://${ip}:${port}` });
    }
  });

  httpServer.on('error', (err) => {
    if (controlWindow) {
      controlWindow.webContents.send('remote-server-error', err.message);
    }
  });
}

function stopRemoteServer() {
  if (wss) { try { wss.close(); } catch (e) {} wss = null; }
  if (httpServer) { try { httpServer.close(); } catch (e) {} httpServer = null; }
}

function broadcastRemoteState() {
  if (!wss) return;
  const data = JSON.stringify(remoteState);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function generateBrowserPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>openTeleprompter Remote</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1e;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column}
#status{padding:8px 16px;background:rgba(255,255,255,.05);font-size:12px;color:rgba(255,255,255,.4);text-align:center}
#content{flex:1;overflow:hidden;padding:20px;position:relative;display:flex;align-items:center;justify-content:center}
#textWrap{transition:transform .3s ease}
.word{display:inline;font-size:clamp(28px,calc(100vw/14),64px);color:rgba(255,255,255,.3);transition:color .2s;line-height:1.6}
.word.active{color:#fff;text-decoration:underline;text-decoration-color:#e94560;text-underline-offset:4px}
.word.spoken{color:rgba(255,255,255,.15)}
#progress{height:3px;background:rgba(255,255,255,.1)}
#progressFill{height:100%;width:0;background:#e94560;transition:width .3s}
#waiting{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
#waiting h2{font-size:24px;margin-bottom:8px}
#waiting p{color:rgba(255,255,255,.5);font-size:14px}
#complete{display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
#complete .check{font-size:64px;animation:pop .5s ease}
@keyframes pop{0%{transform:scale(0)}50%{transform:scale(1.2)}100%{transform:scale(1)}}
#waveBar{height:24px;display:flex;align-items:center;justify-content:center;gap:2px}
.wb{width:3px;height:4px;background:rgba(255,255,255,.2);border-radius:1px}
</style>
</head>
<body>
<div id="status">Connecting...</div>
<div id="content">
  <div id="waiting"><h2>openTeleprompter</h2><p>Waiting for script...</p></div>
  <div id="complete"><div class="check">&#10003;</div><p style="margin-top:12px;font-size:18px">Done!</p></div>
  <div id="textWrap"></div>
</div>
<div id="waveBar"></div>
<div id="progress"><div id="progressFill"></div></div>
<script>
const wsPort=location.port?parseInt(location.port)+1:7374;
const wsUrl='ws://'+location.hostname+':'+wsPort;
let ws,reconnTimer;
function connect(){
  ws=new WebSocket(wsUrl);
  ws.onopen=()=>{document.getElementById('status').textContent='Connected';};
  ws.onmessage=(e)=>{
    try{const d=JSON.parse(e.data);render(d);}catch(ex){}
  };
  ws.onclose=()=>{
    document.getElementById('status').textContent='Reconnecting...';
    reconnTimer=setTimeout(connect,2000);
  };
}
function render(state){
  const tw=document.getElementById('textWrap');
  const waiting=document.getElementById('waiting');
  const complete=document.getElementById('complete');
  if(!state.active){waiting.style.display='block';tw.innerHTML='';complete.style.display='none';return;}
  waiting.style.display='none';
  if(state.currentIndex>=state.words.length&&state.words.length>0){
    complete.style.display='block';tw.innerHTML='';return;
  }
  complete.style.display='none';
  if(tw.children.length!==state.words.length){
    tw.innerHTML='';
    state.words.forEach((w,i)=>{
      const s=document.createElement('span');
      s.className='word';s.textContent=w+' ';tw.appendChild(s);
    });
  }
  const spans=tw.querySelectorAll('.word');
  spans.forEach((s,i)=>{
    s.className='word';
    if(i<state.currentIndex)s.classList.add('spoken');
    if(i===state.currentIndex)s.classList.add('active');
  });
  if(spans[state.currentIndex]){
    spans[state.currentIndex].scrollIntoView({behavior:'smooth',block:'center'});
  }
  document.getElementById('progressFill').style.width=((state.currentIndex/state.words.length)*100)+'%';
}
for(let i=0;i<15;i++){const b=document.createElement('div');b.className='wb';document.getElementById('waveBar').appendChild(b);}
connect();
</script>
</body>
</html>`;
}

// ==========================================
// FILE DIALOGS
// ==========================================

ipcMain.handle('show-open-dialog', async (event, options) => {
  return dialog.showOpenDialog(controlWindow, options);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return dialog.showSaveDialog(controlWindow, options);
});

ipcMain.handle('read-file', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('read-file-buffer', async (event, filePath) => {
  return fs.readFileSync(filePath);
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf-8');
});

// ==========================================
// APP LIFECYCLE
// ==========================================

app.whenReady().then(() => {
  createControlWindow();
  createTray();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (prompterWindow) {
      prompterWindow.webContents.send('toggle-pause');
    }
  });

  globalShortcut.register('Escape', () => {
    if (prompterWindow) {
      prompterWindow.close();
    }
  });

  globalShortcut.register('CommandOrControl+O', () => {
    if (controlWindow) {
      controlWindow.webContents.send('shortcut-open');
    }
  });

  globalShortcut.register('CommandOrControl+S', () => {
    if (controlWindow) {
      controlWindow.webContents.send('shortcut-save');
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopRemoteServer();
  app.quit();
});

// ==========================================
// IPC HANDLERS
// ==========================================

ipcMain.on('open-prompter', (event, options) => {
  if (prompterWindow) prompterWindow.close();
  createPrompterWindow(options);
  updateTrayMenu(true);
});

ipcMain.on('close-prompter', () => {
  if (prompterWindow) prompterWindow.close();
  updateTrayMenu(false);
});

ipcMain.on('update-prompter', (event, data) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('update-content', data);
  }
  // Also update external display
  if (externalWindow) {
    externalWindow.webContents.send('update-content', { ...data, isExternal: true });
  }
  // Update remote state
  remoteState.active = true;
  remoteState.words = data.text.split(/\s+/).filter(w => w.length > 0);
  remoteState.settings = data;
  remoteState.currentIndex = 0;
  broadcastRemoteState();
});

ipcMain.on('update-settings', (event, settings) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('apply-settings', settings);
  }
  if (externalWindow) {
    externalWindow.webContents.send('apply-settings', settings);
  }
});

ipcMain.on('scroll-command', (event, cmd) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('scroll-command', cmd);
  }
});

ipcMain.on('prompter-progress', (event, data) => {
  // Sync to external display
  if (externalWindow) {
    externalWindow.webContents.send('sync-progress', data);
  }
  // Sync to remote
  remoteState.currentIndex = data.currentIndex;
  broadcastRemoteState();
});

ipcMain.on('prompter-finished', () => {
  remoteState.currentIndex = remoteState.words.length;
  broadcastRemoteState();
  updateTrayMenu(false);
});

ipcMain.on('save-settings', (event, settings) => {
  saveSettings(settings);
});

ipcMain.on('start-remote-server', (event, port) => {
  startRemoteServer(port);
});

ipcMain.on('stop-remote-server', () => {
  stopRemoteServer();
  if (controlWindow) {
    controlWindow.webContents.send('remote-server-stopped');
  }
});

ipcMain.on('open-external-display', (event, displayId) => {
  if (externalWindow) externalWindow.close();
  createExternalWindow(displayId);
});

ipcMain.on('close-external-display', () => {
  if (externalWindow) externalWindow.close();
});

ipcMain.on('get-displays', (event) => {
  event.returnValue = screen.getAllDisplays().map(d => ({
    id: d.id,
    label: `${d.bounds.width}x${d.bounds.height}` + (d.id === screen.getPrimaryDisplay().id ? ' (Primary)' : ''),
    isPrimary: d.id === screen.getPrimaryDisplay().id,
  }));
});

ipcMain.on('resize-prompter', (event, { width, height }) => {
  if (prompterWindow) {
    prompterWindow.setSize(width, height);
  }
});
