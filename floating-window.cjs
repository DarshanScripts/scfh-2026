const { app, BrowserWindow, Menu, screen } = require('electron');

const origin = new URL(process.argv.at(-1));
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.href !== origin.origin + '/') {
  throw new Error('The voice window requires a local loopback URL.');
}
const page = origin.href;
app.setName('Voice Agent');
let voiceWindow;

function circleRegion(diameter) {
  const radius = diameter / 2;
  return Array.from({ length: diameter }, (_, y) => {
    const halfWidth = Math.sqrt(radius ** 2 - (y + 0.5 - radius) ** 2);
    const x = Math.floor(radius - halfWidth);
    return { x, y, width: diameter - 2 * x, height: 1 };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const diameter = 88;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const window = voiceWindow = new BrowserWindow({
    x: area.x + Math.max(0, area.width - diameter - 24),
    y: area.y + Math.max(0, area.height - diameter - 24),
    width: diameter,
    height: diameter,
    useContentSize: true,
    title: 'Voice Agent',
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  window.once('closed', () => { voiceWindow = undefined; });
  if (process.platform === 'win32') window.setShape(circleRegion(diameter));

  const contents = window.webContents;
  const trustedPage = (url) => url === page || url === origin.origin;
  contents.session.setPermissionCheckHandler((source, permission, requestingOrigin, details) =>
    source === contents && permission === 'media' && trustedPage(requestingOrigin) &&
    details.isMainFrame && details.mediaType === 'audio');
  contents.session.setPermissionRequestHandler((source, permission, respond, details) => {
    respond(source === contents && permission === 'media' && trustedPage(details.requestingUrl) &&
      details.isMainFrame && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio');
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
