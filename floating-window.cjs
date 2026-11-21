const path = require('node:path');
const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');

const origin = new URL(process.argv.find((arg) => /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/u.test(arg)));
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.href !== origin.origin + '/') {
  throw new Error('The voice window requires a local loopback URL.');
}
const page = origin.href;
app.setName('Voice Agent');
let voiceWindow;

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  function bounds(mode) {
    const area = (screen.getAllDisplays().find((item) => item.id === display.id) || screen.getPrimaryDisplay()).workArea;
    const sidebarWidth = Math.round(area.width * 0.3);
    if (mode === 'collapsed') return { x: area.x + area.width - 42, y: area.y + 16, width: 42, height: 56 };
    if (mode === 'canvas') {
      const width = Math.round(area.width * 0.7);
      const height = Math.round(area.height * 0.82);
      return { x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2), width, height };
    }
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
  const updateBounds = () => window.setBounds(bounds(mode));
  screen.on('display-metrics-changed', updateBounds);
  screen.on('display-removed', updateBounds);
  window.once('closed', () => {
    voiceWindow = undefined;
    screen.off('display-metrics-changed', updateBounds);
    screen.off('display-removed', updateBounds);
    ipcMain.removeHandler('voice-workspace:mode');
  });
  ipcMain.handle('voice-workspace:mode', (event, next) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== page || !['sidebar', 'collapsed', 'canvas'].includes(next)) return false;
    mode = next;
    updateBounds();
    if (mode === 'canvas') window.focus();
    return true;
  });

  const contents = window.webContents;
  const trustedPage = (url) => url === page || url === origin.origin;
  contents.session.setPermissionCheckHandler((source, permission, requestingOrigin, details) =>
    source === contents && trustedPage(requestingOrigin) && details.isMainFrame &&
    (permission === 'fullscreen' || (permission === 'media' && details.mediaType === 'audio')));
  contents.session.setPermissionRequestHandler((source, permission, respond, details) => {
    respond(source === contents && trustedPage(details.requestingUrl) && details.isMainFrame &&
      (permission === 'fullscreen' || (permission === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio')));
  });
  const preventExternalNavigation = (event, url) => {
    if (url !== page) event.preventDefault();
  };
  contents.on('will-navigate', preventExternalNavigation);
  contents.on('will-redirect', preventExternalNavigation);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  await window.loadURL(page);
  window.showInactive();
}).catch((error) => {
  console.error('Could not open the floating voice window:', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
