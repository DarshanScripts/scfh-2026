const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');

const origin = new URL(process.argv.find((arg) => /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/u.test(arg)));
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.href !== origin.origin + '/') {
  throw new Error('The voice window requires a local loopback URL.');
}
const page = origin.href;
const canvasPage = new URL('/workflow-canvas', origin).href;
app.setName('Voice Agent');
let voiceWindow;

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  function bounds(mode) {
    const area = (screen.getAllDisplays().find((item) => item.id === display.id) || screen.getPrimaryDisplay()).workArea;
    const sidebarWidth = Math.round(area.width * 0.3);
    if (mode === 'collapsed') return { x: area.x + area.width - 42, y: area.y + 16, width: 42, height: 56 };
    if (mode === 'canvas') return { x: area.x, y: area.y, width: area.width - sidebarWidth, height: area.height };
    return { x: area.x + area.width - sidebarWidth, y: area.y, width: sidebarWidth, height: area.height };
  }
  let mode = 'sidebar';
  const window = voiceWindow = new BrowserWindow({
    ...bounds(mode),
    title: 'Voice workspace',
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#f4f7f3',
    webPreferences: {
      preload: path.join(__dirname, 'sidebar-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  let desktopActive = false;
  let canvas;
  const updateBounds = () => {
    window.setBounds(bounds(mode));
    canvas?.window.setBounds(bounds('canvas'));
  };
  screen.on('display-metrics-changed', updateBounds);
  screen.on('display-removed', updateBounds);
  window.once('closed', () => {
    voiceWindow = undefined;
    canvas?.window.destroy();
    screen.off('display-metrics-changed', updateBounds);
    screen.off('display-removed', updateBounds);
    for (const name of ['mode', 'desktop', 'canvas', 'show-canvas']) ipcMain.removeHandler('voice-workspace:' + name);
    ipcMain.off('workflow-canvas:ack', acknowledge);
    ipcMain.off('workflow-canvas:close', closeFromCanvas);
  });
  const from = (event, target, url) => target && !target.isDestroyed() &&
    event.sender === target.webContents && event.senderFrame === target.webContents.mainFrame && event.senderFrame.url === url;

  ipcMain.handle('voice-workspace:mode', (event, next) => {
    if (!from(event, window, page) || !['sidebar', 'collapsed'].includes(next)) return false;
    mode = next;
    updateBounds();
    return true;
  });

  function applyDesktopVisibility(target) {
    target.setFocusable(!desktopActive);
    if (desktopActive) target.hide();
    else target.showInactive();
  }

  ipcMain.handle('voice-workspace:desktop', (event, active) => {
    if (!from(event, window, page) || typeof active !== 'boolean') return false;
    if (active === desktopActive) return true;
    desktopActive = active;
    if (active && window.isFullScreen()) window.setFullScreen(false);
    applyDesktopVisibility(window);
    if (canvas?.shown && active) {
      applyDesktopVisibility(canvas.window);
    }
    return true;
  });

  ipcMain.handle('voice-workspace:show-canvas', (event) => {
    if (!from(event, window, page) || desktopActive || !canvas?.shown) return false;
    applyDesktopVisibility(canvas.window);
    canvas.window.focus();
    return true;
  });

  function openCanvas() {
    const target = new BrowserWindow({
      ...bounds('canvas'),
      title: 'Canvas',
      frame: false,
      show: false,
      movable: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      backgroundColor: '#edf3ed',
      webPreferences: {
        preload: path.join(__dirname, 'workspace-canvas-preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const current = canvas = { window: target, pending: new Map() };
    restrictNavigation(target.webContents, canvasPage);
    target.once('closed', () => {
      if (canvas === current) canvas = undefined;
      for (const settle of current.pending.values()) settle('closed');
      if (current.id && !window.isDestroyed()) window.webContents.send('voice-workspace:canvas-closed', current.id);
    });
    current.loaded = target.loadURL(canvasPage);
    return current;
  }

  function acknowledge(event, id, result) {
    if (from(event, canvas?.window, canvasPage)) canvas.pending.get(id)?.(result);
  }

  function closeFromCanvas(event) {
    if (from(event, canvas?.window, canvasPage)) canvas.window.close();
  }

  ipcMain.on('workflow-canvas:ack', acknowledge);
  ipcMain.on('workflow-canvas:close', closeFromCanvas);
  ipcMain.handle('voice-workspace:canvas', async (event, message) => {
    if (!from(event, window, page) || typeof message?.id !== 'string') return 'invalid';
    if (message.type === 'dismiss') {
      if (message.id !== (canvas?.starting || canvas?.id)) return 'closed';
      canvas.id = undefined;
      canvas.window.destroy();
      return 'ok';
    }
    const beginning = message.type === 'begin';
    if (!canvas && !beginning) return 'closed';
    const current = canvas || openCanvas();
    if (beginning) {
      if (current.starting) return 'failed';
      current.starting = message.id;
    }
    try { await current.loaded; } catch {
      if (!current.window.isDestroyed()) current.window.destroy();
      return 'unavailable';
    }
    if (canvas !== current) return 'closed';
    const result = await new Promise((resolve) => {
      const requestId = randomUUID();
      function settle(value) {
        clearTimeout(timeout);
        current.pending.delete(requestId);
        resolve(value);
      }
      const timeout = setTimeout(() => settle('failed'), 7000);
      current.pending.set(requestId, settle);
      current.window.webContents.send('workflow-canvas:update', requestId, message);
    });
    if (canvas !== current) return 'closed';
    if (beginning) current.starting = undefined;
    if (result === 'ok' && beginning) {
      current.id = message.id;
      current.shown = true;
      applyDesktopVisibility(current.window);
    } else if (!current.shown && !current.pending.size && !current.window.isDestroyed()) {
      current.window.destroy();
    }
    return result;
  });

  const contents = window.webContents;
  const trustedPage = (url) => url === page || url === origin.origin;
  contents.session.setPermissionCheckHandler((source, permission, requestingOrigin, details) =>
    source === contents && trustedPage(requestingOrigin) && details.isMainFrame &&
    ((permission === 'fullscreen' && !canvas && !desktopActive) || (permission === 'media' && details.mediaType === 'audio')));
  contents.session.setPermissionRequestHandler((source, permission, respond, details) => {
    respond(source === contents && trustedPage(details.requestingUrl) && details.isMainFrame &&
      ((permission === 'fullscreen' && !canvas && !desktopActive) || (permission === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio')));
  });
  restrictNavigation(contents, page);

  await window.loadURL(page);
  window.showInactive();
}).catch((error) => {
  console.error('Could not open the floating voice window:', error.message);
  app.exit(1);
});

function restrictNavigation(contents, page) {
  const preventExternalNavigation = (event, url) => {
    if (url !== page) event.preventDefault();
  };
  contents.on('will-navigate', preventExternalNavigation);
  contents.on('will-redirect', preventExternalNavigation);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.on('window-all-closed', () => app.quit());
