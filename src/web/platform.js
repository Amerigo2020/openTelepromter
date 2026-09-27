// ==========================================
// WEB PLATFORM
// Runs the Electron pages in a browser (Android, iPad, any device).
// Provides what Electron's main process does on the desktop:
// - require() for the app modules (bundled by scripts/build-web.js)
// - ipcRenderer, routed between the control page and the prompter,
//   which runs in a fullscreen iframe on top of the control page
// - settings in localStorage, fullscreen, screen wake lock, Back button
// Does nothing inside Electron.
// ==========================================
(function () {
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) return;

  // ---------- Modules ----------
  const factories = {};
  const cache = {};
  const builtins = {
    path: {
      extname: p => { const m = /\.[^./\\]*$/.exec(p || ''); return m ? m[0] : ''; },
      basename: p => String(p || '').split(/[\\/]/).pop(),
    },
    jszip: () => window.JSZip,
  };

  window.otDefine = (name, factory) => { factories[name] = factory; };
  window.require = function (name) {
    if (name === 'electron') return { ipcRenderer };
    if (name in builtins) return typeof builtins[name] === 'function' ? builtins[name]() : builtins[name];
    const key = name.replace(/\.js$/, '');
    if (!cache[key]) {
      if (!factories[key]) throw new Error(`Module not bundled: ${name}`);
      const module = { exports: {} };
      cache[key] = module;
      factories[key](module, module.exports, window.require);
    }
    return cache[key].exports;
  };

  // ---------- IPC ----------
  const isPrompter = window.parent !== window;
  const listeners = {};

  function emit(channel, args) {
    (listeners[channel] || []).forEach(fn => fn({}, ...args));
  }

  const ipcRenderer = {
    on(channel, fn) {
      (listeners[channel] = listeners[channel] || []).push(fn);
    },
    send(channel, ...args) {
      if (isPrompter) {
        window.parent.postMessage({ ot: 'main', channel, args }, location.origin);
      } else {
        handleMain(channel, args);
      }
    },
    sendSync(channel) {
      return channel === 'get-displays' ? [] : undefined;
    },
    invoke(channel) {
      return Promise.reject(new Error(`${channel} is not available in the web app`));
    },
  };

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || !e.data.ot) return;
    if (e.data.ot === 'renderer') emit(e.data.channel, e.data.args);
    else if (e.data.ot === 'main' && !isPrompter) handleMain(e.data.channel, e.data.args);
  });

  window.otPlatform = { isWeb: true, isPrompter };

  if (isPrompter) {
    // Escape and the completion screen close the prompter
    window.close = () => ipcRenderer.send('prompter-closing');
    return;
  }

  // ---------- Main process (control page) ----------
  const SETTINGS_KEY = 'openTeleprompter.settings';
  let host = null;       // fullscreen container with the prompter iframe
  let frame = null;
  let frameReady = false;
  let queue = [];
  let wakeLock = null;
  let historyEntry = false;

  function toPrompter(channel, ...args) {
    if (!frame) return;
    if (!frameReady) { queue.push([channel, args]); return; }
    frame.contentWindow.postMessage({ ot: 'renderer', channel, args }, location.origin);
  }

  function openPrompter() {
    closePrompter({ silent: true });
    host = document.createElement('div');
    host.id = 'prompterHost';
    host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;';
    frame = document.createElement('iframe');
    frame.src = 'prompter.html';
    frame.setAttribute('allow', 'microphone; fullscreen; screen-wake-lock');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000;';
    frameReady = false;
    queue = [];
    frame.addEventListener('load', () => {
      frameReady = true;
      const pending = queue;
      queue = [];
      pending.forEach(([channel, args]) => toPrompter(channel, ...args));
      frame.focus();
    });
    host.appendChild(frame);
    document.body.appendChild(host);
    document.documentElement.style.overflow = 'hidden';

    // Called from the Start click, so fullscreen is allowed where supported
    const fs = host.requestFullscreen || host.webkitRequestFullscreen;
    if (fs) {
      try { Promise.resolve(fs.call(host)).catch(() => {}); } catch (e) {}
    }
    requestWakeLock();
    // Android's Back button closes the prompter instead of the app
    history.pushState({ prompter: true }, '');
    historyEntry = true;
  }

  function closePrompter({ silent = false, fromHistory = false } = {}) {
    if (!host) return;
    host.remove();
    host = null;
    frame = null;
    frameReady = false;
    queue = [];
    document.documentElement.style.overflow = '';
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { Promise.resolve(exit.call(document)).catch(() => {}); } catch (e) {}
    }
    releaseWakeLock();
    if (historyEntry && !fromHistory) history.back();
    historyEntry = false;
    if (!silent) emit('prompter-closed', []);
  }

  window.addEventListener('popstate', () => {
    if (host) closePrompter({ fromHistory: true });
  });

  // Keeps the screen on while reading
  async function requestWakeLock() {
    if (!navigator.wakeLock || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {}
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (host && document.visibilityState === 'visible') requestWakeLock();
  });

  function handleMain(channel, args) {
    const [data] = args;
    switch (channel) {
      case 'open-prompter': openPrompter(); break;
      case 'close-prompter': closePrompter({ silent: true }); break;
      case 'prompter-closing': closePrompter(); break;
      case 'update-prompter': toPrompter('update-content', data); break;
      case 'update-settings': toPrompter('apply-settings', data); break;
      case 'scroll-command':
        if (data === 'page-finished') emit('page-finished', []);
        else toPrompter('scroll-command', data);
        break;
      case 'take-started': emit('prompter-paused', [false]); break;
      case 'prompter-paused': emit('prompter-paused', [data]); break;
      case 'prompter-finished': emit('take-finished', [data || {}]); break;
      case 'prompter-font-size': emit('prompter-font-size', [data]); break;
      case 'save-settings':
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (e) {}
        break;
      default: break; // desktop-only: tray, remote server, external display
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) {}
      if (saved) emit('load-settings', [saved]);
    }, 0);
  });

  // Same shortcuts as the desktop app
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'o') { e.preventDefault(); emit('shortcut-open', []); }
    if (key === 's') { e.preventDefault(); emit('shortcut-save', []); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (window.hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  // Offline support and "Add to Home Screen"
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
