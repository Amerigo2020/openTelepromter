const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');

let controlWindow = null;
let prompterWindow = null;

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 400,
    minHeight: 500,
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
    app.quit();
  });
}

function createPrompterWindow(options) {
  const displays = screen.getAllDisplays();
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

  // Allow click-through when not hovering interactive elements
  if (options.clickThrough) {
    prompterWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  prompterWindow.on('closed', () => {
    prompterWindow = null;
    if (controlWindow) {
      controlWindow.webContents.send('prompter-closed');
    }
  });

  return prompterWindow;
}

app.whenReady().then(() => {
  createControlWindow();

  // Global shortcuts
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
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});

// IPC handlers
ipcMain.on('open-prompter', (event, options) => {
  if (prompterWindow) prompterWindow.close();
  createPrompterWindow(options);
});

ipcMain.on('close-prompter', () => {
  if (prompterWindow) prompterWindow.close();
});

ipcMain.on('update-prompter', (event, data) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('update-content', data);
  }
});

ipcMain.on('update-settings', (event, settings) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('apply-settings', settings);
  }
});

ipcMain.on('scroll-command', (event, cmd) => {
  if (prompterWindow) {
    prompterWindow.webContents.send('scroll-command', cmd);
  }
});

ipcMain.on('resize-prompter', (event, { width, height }) => {
  if (prompterWindow) {
    prompterWindow.setSize(width, height);
  }
});

ipcMain.on('set-prompter-opacity', (event, opacity) => {
  if (prompterWindow) {
    prompterWindow.setOpacity(opacity);
  }
});

ipcMain.on('set-click-through', (event, enabled) => {
  if (prompterWindow) {
    prompterWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }
});

ipcMain.on('get-displays', (event) => {
  event.returnValue = screen.getAllDisplays();
});
