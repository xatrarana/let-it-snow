const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { startWindowTracker } = require('./window-tracker');

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', 'assets');

// ---------- Settings (saved in the user's app data folder) ----------
const DEFAULTS = {
  snowing: true,
  intensity: 'medium', // light | medium | heavy | blizzard
  pileUp: true,
  windowSnow: true, // snow settles on top of open windows
  theme: 'snow', // snow | leaves | blossoms
  autoPlow: true, // bulldozer comes by on its own when the snow gets deep
  showWidget: true,
  widgetPos: null, // {x, y}
};
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };
function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Could not save settings', e);
  }
}

// ---------- Snow overlays: one transparent, click-through window per display ----------
const overlays = new Map(); // displayId -> BrowserWindow

function overlayConfig(display) {
  const { bounds, workArea } = display;
  return {
    enabled: settings.snowing,
    intensity: settings.intensity,
    pileUp: settings.pileUp,
    windowSnow: settings.windowSnow,
    autoPlow: settings.autoPlow,
    theme: settings.theme,
    // Snow lands on top of the taskbar / dock: the bottom of the work area.
    groundY: workArea.y + workArea.height - bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

// Lean renderer settings shared by every window.
const WEB_PREFS = {
  preload: path.join(__dirname, 'preload.js'),
  spellcheck: false,
  devTools: !app.isPackaged,
};

function createOverlay(display) {
  const { bounds } = display;
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: { ...WEB_PREFS, backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true); // clicks pass straight through to whatever is below
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setBounds(bounds); // macOS can clamp the initial size below the menu bar
  win.loadFile(path.join(__dirname, 'overlay.html'));
  win.webContents.on('did-finish-load', () => {
    win.loaded = true;
    win.webContents.send('config', overlayConfig(display));
    sendWindows();
    if (settings.snowing) win.showInactive();
    if (display.id === screen.getPrimaryDisplay().id && settings.showWidget && !widget) createWidget();
  });
  // The countdown widget is opened from the primary overlay with window.open, so it
  // shares that overlay's renderer process instead of starting another one (~100 MB less).
  win.webContents.setWindowOpenHandler(({ url }) =>
    url.endsWith('widget.html') ? { action: 'allow', overrideBrowserWindowOptions: widgetOptions() } : { action: 'deny' }
  );
  win.webContents.on('did-create-window', (child) => setupWidget(child));
  overlays.set(display.id, win);
}

// Which displays need an overlay window right now:
//   snowing         -> every display
//   only countdown  -> just the primary one (hidden), which hosts the widget
//   neither         -> none at all, so the app idles with only the tray icon
function wantedOverlayDisplays() {
  const displays = screen.getAllDisplays();
  if (settings.snowing) return displays;
  if (settings.showWidget) return [screen.getPrimaryDisplay()];
  return [];
}

function syncOverlays() {
  const wanted = wantedOverlayDisplays();
  const ids = new Set(wanted.map((d) => d.id));
  for (const [id, win] of overlays) {
    if (!ids.has(id)) {
      win.destroy();
      overlays.delete(id);
    }
  }
  for (const d of wanted) {
    const win = overlays.get(d.id);
    if (!win) {
      createOverlay(d);
    } else {
      win.setBounds(d.bounds);
      if (win.loaded) win.webContents.send('config', overlayConfig(d));
      if (settings.snowing) win.showInactive();
      else win.hide();
    }
  }
}

function applySnowSettings() {
  syncOverlays();
  syncWindowTracker();
}

function bulldoze() {
  for (const win of overlays.values()) win.webContents.send('bulldoze');
}

// ---------- Open windows, so snow can settle on their top edges ----------
let stopTracker = null;
let lastWindows = [];

function sendWindows() {
  for (const d of screen.getAllDisplays()) {
    const win = overlays.get(d.id);
    if (!win) continue;
    const b = d.bounds;
    // Front-most first, in this overlay's own coordinates.
    const local = lastWindows
      .filter((w) => w.x < b.x + b.width && w.x + w.w > b.x && w.y < b.y + b.height && w.y + w.h > b.y)
      .map((w) => ({ id: w.id, x: w.x - b.x, y: w.y - b.y, w: w.w, h: w.h }));
    win.webContents.send('windows', local);
  }
}

function toDip(w) {
  // Windows reports physical pixels; convert to Electron's DIPs (handles mixed-DPI monitors).
  if (process.platform !== 'win32') return w;
  const r = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h });
  return { id: w.id, x: r.x, y: r.y, w: r.width, h: r.height };
}

function syncWindowTracker() {
  const want = settings.snowing && settings.windowSnow;
  if (want && !stopTracker) {
    if (process.env.SNOW_FAKE_WINDOWS) {
      // Development aid: pretend these windows are open (JSON array of {id,x,y,w,h}).
      lastWindows = JSON.parse(process.env.SNOW_FAKE_WINDOWS);
      sendWindows();
      stopTracker = () => {};
    } else {
      stopTracker = startWindowTracker(
        (wins) => {
          lastWindows = wins;
          sendWindows();
        },
        { toDip }
      );
    }
  } else if (!want && stopTracker) {
    stopTracker();
    stopTracker = null;
    lastWindows = [];
    sendWindows();
  }
}

// ---------- Snow globe countdown widget ----------
let widget = null;
const WIDGET_W = 220;
const WIDGET_H = 260;

function defaultWidgetPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIDGET_W - 24, y: wa.y + wa.height - WIDGET_H - 24 };
}

function widgetOptions() {
  const pos = settings.widgetPos || defaultWidgetPos();
  return {
    x: pos.x,
    y: pos.y,
    width: WIDGET_W,
    height: WIDGET_H,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    webPreferences: { ...WEB_PREFS, backgroundThrottling: true },
  };
}

function setupWidget(win) {
  widget = win;
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.once('did-finish-load', () => {
    if (settings.showWidget) win.showInactive();
    else win.close();
  });
  win.on('closed', () => {
    if (widget === win) widget = null;
  });
}

function createWidget() {
  const host = overlays.get(screen.getPrimaryDisplay().id);
  if (!host) return syncOverlays(); // the host overlay creates the widget once it has loaded
  if (!host.loaded || widget) return;
  host.webContents.executeJavaScript("window.open('widget.html', 'snowglobe')", true).catch(() => {});
}

ipcMain.on('widget-drag', (_e, dx, dy) => {
  if (!widget) return;
  const [x, y] = widget.getPosition();
  widget.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('widget-drag-end', () => {
  if (!widget) return;
  const [x, y] = widget.getPosition();
  settings.widgetPos = { x, y };
  saveSettings();
});
ipcMain.on('widget-hide', () => setAndApply({ showWidget: false }, applyWidgetSettings));

function applyWidgetSettings() {
  if (settings.showWidget) {
    syncOverlays();
    createWidget();
  } else {
    widget?.close(); // free it completely rather than keeping a hidden window around
    syncOverlays();
  }
}

// ---------- Tray / menu bar ----------
let tray = null;

function setAndApply(patch, apply) {
  Object.assign(settings, patch);
  saveSettings();
  apply();
  rebuildMenu();
}

function rebuildMenu() {
  if (!tray) return;
  const noun = { snow: 'Snow', leaves: 'Leaves', blossoms: 'Petals' }[settings.theme] || 'Snow';
  const snowy = settings.theme === 'snow';
  const theme = (id, label) => ({
    label,
    type: 'radio',
    checked: settings.theme === id,
    click: () => setAndApply({ theme: id, snowing: true }, applySnowSettings),
  });
  const level = (id, label) => ({
    label,
    type: 'radio',
    checked: settings.intensity === id,
    click: () => setAndApply({ intensity: id, snowing: true }, applySnowSettings),
  });
  const loginSupported = isMac || process.platform === 'win32';
  const menu = Menu.buildFromTemplate([
    {
      label: snowy ? 'Let it snow' : `Let the ${noun.toLowerCase()} fall`,
      type: 'checkbox',
      checked: settings.snowing,
      click: (item) => setAndApply({ snowing: item.checked }, applySnowSettings),
    },
    {
      label: 'Theme',
      submenu: [
        theme('snow', '❄️  Snow'),
        theme('leaves', '🍁  Autumn leaves'),
        theme('blossoms', '🌸  Cherry blossoms'),
      ],
    },
    {
      label: snowy ? 'How much snow' : 'How many',
      submenu: snowy
        ? [
            level('light', 'Light flurries'),
            level('medium', 'Gentle snow'),
            level('heavy', 'Heavy snow'),
            level('blizzard', 'Blizzard'),
          ]
        : [
            level('light', 'A few'),
            level('medium', 'Gentle'),
            level('heavy', 'Lots'),
            level('blizzard', 'Windy storm'),
          ],
    },
    {
      label: 'Pile up on the taskbar / dock',
      type: 'checkbox',
      checked: settings.pileUp,
      click: (item) => setAndApply({ pileUp: item.checked }, applySnowSettings),
    },
    ...(isMac || process.platform === 'win32'
      ? [
          {
            label: `${noun} on top of windows`,
            type: 'checkbox',
            checked: settings.windowSnow,
            click: (item) => setAndApply({ windowSnow: item.checked }, applySnowSettings),
          },
        ]
      : []),
    { type: 'separator' },
    { label: 'Send the bulldozer', enabled: settings.snowing, click: bulldoze },
    {
      label: 'Bulldozer clears deep snow on its own',
      type: 'checkbox',
      checked: settings.autoPlow,
      click: (item) => setAndApply({ autoPlow: item.checked }, applySnowSettings),
    },
    { type: 'separator' },
    {
      label: 'Show Christmas countdown',
      type: 'checkbox',
      checked: settings.showWidget,
      click: (item) => setAndApply({ showWidget: item.checked }, applyWidgetSettings),
    },
    {
      label: 'Reset countdown position',
      click: () => {
        settings.widgetPos = null;
        saveSettings();
        const p = defaultWidgetPos();
        widget?.setPosition(p.x, p.y);
      },
    },
    { type: 'separator' },
    ...(loginSupported
      ? [
          {
            label: 'Start when I log in',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
        ]
      : []),
    { label: 'Quit Let It Snow', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const icon = isMac
    ? nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Let It Snow');
  rebuildMenu();
}

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Opening the app again brings the countdown back.
    setAndApply({ showWidget: true }, applyWidgetSettings);
  });

  // Transparent windows on Linux need this; harmless elsewhere.
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
  // Trim Chromium down for a small tray app:
  //  - run the network service inside the main process (one process fewer; we never go online)
  //  - no spare pre-launched renderer, no media keys / media session handling
  //  - no native occlusion tracking (our overlay covers the screen and would confuse it)
  app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
  app.commandLine.appendSwitch(
    'disable-features',
    'SpareRendererForSitePerProcess,CalculateNativeWinOcclusion,HardwareMediaKeyHandling,MediaSessionService,WebRtcHideLocalIpsWithMdns'
  );
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  app.whenReady().then(() => {
    if (isMac) app.dock?.hide(); // menu bar app, no dock icon
    loadSettings();
    createTray();
    syncOverlays(); // the primary overlay opens the countdown widget once it has loaded
    syncWindowTracker();
    if (process.env.SNOW_BULLDOZE_AFTER) setTimeout(bulldoze, Number(process.env.SNOW_BULLDOZE_AFTER));
    screen.on('display-added', syncOverlays);
    screen.on('display-removed', syncOverlays);
    screen.on('display-metrics-changed', () => {
      syncOverlays();
      sendWindows();
    });
  });

  // Keep running in the tray even with no visible windows.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => stopTracker?.());
}
