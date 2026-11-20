const { app, BrowserWindow, Menu } = require('electron');

const url = new URL(process.argv.at(-1));
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.href !== url.origin + '/') {
  throw new Error('The canvas requires a local loopback URL.');
}

let canvasWindow;
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const win = canvasWindow = new BrowserWindow({
    width: 760, height: 650, title: 'Workflow Canvas', show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'canvas-preview' },
  });
  win.once('closed', () => { canvasWindow = undefined; });
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.setPermissionRequestHandler((_source, _permission, respond) => respond(false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  await win.loadURL(url.href);
  win.show();
  console.log('Workflow Canvas window opened.');
}).catch((error) => { console.error(error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
