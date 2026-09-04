/**
 * Electron main process (hoofdstuk 2.2 en 2.8).
 *
 * Main owns the window, the Dutch menu, the tray, notifications, dialogs and
 * PDF. The business logic lives in a utility process ("de kern"); if that
 * crashes, main restarts it and says so instead of taking the window down.
 */
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  BrowserWindow,
  Notification,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { buildMenu } from './menu.ts';
import { createTray, type TrayHandle } from './tray.ts';
import { loadWindowState, trackWindowState } from './window-state.ts';
import { renderHtmlToPdf } from './pdf.ts';

// De build levert ESM op, waar here niet bestaat; afleiden uit import.meta.
const here = dirname(fileURLToPath(import.meta.url));

const APP_NAME = 'Showroom Suite';
const PROTOCOL = 'showroom';

type CoreStatus = {
  port: number;
  appToken: string;
  schemaVersion: string;
  mode: 'standalone' | 'host' | 'client';
  address: string;
  status: 'starten' | 'gestart' | 'fout';
  message?: string;
};

type AppConfig = {
  mode: 'standalone' | 'host' | 'client';
  port: number;
  hostAddress?: string;
  dataDirectory?: string;
  minimiseToTray: boolean;
  globalShortcut: string;
  autoStart: boolean;
};

const DEFAULT_CONFIG: AppConfig = {
  mode: 'standalone',
  port: 4317,
  minimiseToTray: false,
  globalShortcut: 'CommandOrControl+Alt+S',
  autoStart: false,
};

let mainWindow: BrowserWindow | null = null;
let tray: TrayHandle | null = null;
let core: UtilityProcess | null = null;
let coreStatus: CoreStatus = {
  port: 0,
  appToken: '',
  schemaVersion: '',
  mode: 'standalone',
  address: '',
  status: 'starten',
};
let quitting = false;
let pendingDeepLink: string | null = null;

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

function readConfig(): AppConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath(), 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// De kern in een utility process
// ---------------------------------------------------------------------------

function startCoreProcess(config: AppConfig): void {
  const entry = join(here, '../core/host.js');
  core = utilityProcess.fork(entry, [], { serviceName: 'Showroom Suite kern', stdio: 'pipe' });

  core.postMessage({
    type: 'start',
    dataDirectory: config.dataDirectory ?? app.getPath('userData'),
    mode: config.mode,
    port: config.mode === 'host' ? config.port : undefined,
  });

  core.on('message', (message: Record<string, unknown>) => {
    if (message.type === 'gestart') {
      coreStatus = {
        port: Number(message.port),
        appToken: String(message.appToken),
        schemaVersion: String(message.schemaVersion),
        address: String(message.address),
        mode: config.mode,
        status: 'gestart',
      };
      mainWindow?.webContents.send('kern:status-gewijzigd', coreStatus);
      return;
    }
    if (message.type === 'fout') {
      coreStatus = { ...coreStatus, status: 'fout', message: String(message.message) };
      mainWindow?.webContents.send('kern:status-gewijzigd', coreStatus);
      dialog.showErrorBox('De kern kon niet starten', String(message.message));
    }
  });

  core.on('exit', (code) => {
    if (quitting) return;
    // Een crash in de bedrijfslogica mag het venster niet meenemen: herstarten
    // en het melden (hoofdstuk 2.2).
    coreStatus = { ...coreStatus, status: 'starten' };
    mainWindow?.webContents.send('kern:status-gewijzigd', coreStatus);
    notify(
      'De kern is opnieuw gestart',
      `Het achtergrondproces stopte onverwacht (code ${code}) en is herstart.`,
    );
    setTimeout(() => startCoreProcess(readConfig()), 1000);
  });
}

// ---------------------------------------------------------------------------
// Venster
// ---------------------------------------------------------------------------

function createWindow(config: AppConfig): BrowserWindow {
  const state = loadWindowState(app.getPath('userData'));

  const window = new BrowserWindow({
    ...state,
    show: false,
    title: APP_NAME,
    icon: join(here, '../../build/icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f19' : '#f8fafc',
    webPreferences: {
      preload: join(here, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (state.maximised) window.maximize();
  trackWindowState(app.getPath('userData'), window);

  window.once('ready-to-show', () => {
    window.show();
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  // Navigatie buiten de app blokkeren; externe links gaan naar de browser,
  // maar alleen https: en mailto: (hoofdstuk 2.9).
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  window.on('close', (event) => {
    if (quitting) return;
    if (config.minimiseToTray) {
      event.preventDefault();
      window.hide();
    }
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(here, '../renderer/index.html'));

  return window;
}

function openExternal(url: string): void {
  // Whitelist: alleen echte webadressen en mailto-links verlaten de app.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
    void shell.openExternal(url);
  }
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function navigate(route: string): void {
  showWindow();
  mainWindow?.webContents.send('navigeer', route);
}

function notify(title: string, body: string, link?: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', () => {
    if (link) navigate(link);
    else showWindow();
  });
  notification.show();
}

// ---------------------------------------------------------------------------
// Diepe links: showroom://klant/123
// ---------------------------------------------------------------------------

function handleDeepLink(url: string): void {
  const match = /^showroom:\/\/([a-z]+)\/(\d+)/i.exec(url);
  if (!match) return;
  const routes: Record<string, string> = {
    klant: '/klanten',
    kans: '/kansen',
    project: '/projecten',
    offerte: '/duurzaamheid/offertes',
  };
  const base = routes[match[1]!.toLowerCase()];
  if (base) navigate(`${base}/${match[2]}`);
}

// ---------------------------------------------------------------------------
// IPC — precies wat preload aanbiedt, niet meer
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('app:versie', () => app.getVersion());
  ipcMain.handle('kern:status', () => coreStatus);

  ipcMain.handle('bestand:opslaan-als', async (_event, voorstel: string, inhoud: string, codering: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Opslaan als',
      defaultPath: join(app.getPath('documents'), voorstel),
      filters: filtersFor(voorstel),
    });
    if (result.canceled || !result.filePath) return { opgeslagen: false };
    await writeFile(result.filePath, inhoud, codering === 'base64' ? 'base64' : 'utf8');
    // Na een export: melding met "Toon in map" en "Openen" (hoofdstuk 2.8).
    notifyExport(result.filePath);
    return { opgeslagen: true, pad: result.filePath };
  });

  ipcMain.handle('bestand:openen', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Bestand kiezen',
      properties: ['openFile'],
      filters: [
        { name: 'Excel-werkmap', extensions: ['xlsx', 'xlsm'] },
        { name: 'CSV-bestand', extensions: ['csv'] },
        { name: 'Alle bestanden', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return { geopend: false };
    return { geopend: true, pad: result.filePaths[0] };
  });

  ipcMain.handle('bestand:toon-in-map', (_event, pad: string) => {
    if (existsSync(pad)) shell.showItemInFolder(pad);
  });

  ipcMain.handle('bestand:openen-met', async (_event, pad: string) => {
    if (existsSync(pad)) await shell.openPath(pad);
  });

  ipcMain.handle('pdf:afdrukken', async (_event, html: string, voorstel: string, liggend: boolean) => {
    const result = await dialog.showSaveDialog({
      title: 'PDF opslaan',
      defaultPath: join(app.getPath('documents'), voorstel),
      filters: [{ name: 'PDF-document', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { opgeslagen: false };
    await renderHtmlToPdf(html, result.filePath, { landscape: liggend });
    notifyExport(result.filePath);
    return { opgeslagen: true, pad: result.filePath };
  });

  ipcMain.handle('melding:tonen', (_event, titel: string, tekst: string, link?: string) => {
    notify(titel, tekst, link);
  });

  ipcMain.handle('link:extern', (_event, url: string) => openExternal(url));
}

function filtersFor(filename: string): Electron.FileFilter[] {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, Electron.FileFilter> = {
    xlsx: { name: 'Excel-werkmap', extensions: ['xlsx'] },
    csv: { name: 'CSV-bestand', extensions: ['csv'] },
    docx: { name: 'Word-document', extensions: ['docx'] },
    pdf: { name: 'PDF-document', extensions: ['pdf'] },
    eml: { name: 'E-mailbericht', extensions: ['eml'] },
    db: { name: 'Databaseback-up', extensions: ['db'] },
  };
  const match = known[extension];
  return match ? [match, { name: 'Alle bestanden', extensions: ['*'] }] : [{ name: 'Alle bestanden', extensions: ['*'] }];
}

function notifyExport(path: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: 'Export klaar',
    body: `${basename(path)} is opgeslagen. Klik om de map te openen.`,
  });
  notification.on('click', () => shell.showItemInFolder(path));
  notification.show();
}

// ---------------------------------------------------------------------------
// Opstarten
// ---------------------------------------------------------------------------

// Eén instantie tegelijk: een tweede start brengt het bestaande venster naar
// voren en verwerkt de eventuele diepe link.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    const link = argv.find((argument) => argument.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow) handleDeepLink(url);
    else pendingDeepLink = url;
  });

  void app.whenReady().then(() => {
    app.setName(APP_NAME);
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        join(process.argv[1] ?? ''),
      ]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }

    const config = readConfig();
    registerIpc();
    startCoreProcess(config);

    mainWindow = createWindow(config);

    buildMenu(mainWindow, {
      navigeer: navigate,
      backupNu: () => navigate('/instellingen/backup'),
      importeren: () => navigate('/instellingen/import'),
      exporteren: () => navigate('/rapportages'),
      logboekOpenen: () => {
        void shell.openPath(join(app.getPath('userData'), 'logs'));
      },
      controleerUpdates: () => navigate('/instellingen/updates'),
      overTonen: () => {
        void dialog.showMessageBox({
          type: 'info',
          title: `Over ${APP_NAME}`,
          message: APP_NAME,
          detail: [
            `Versie ${app.getVersion()}`,
            `Schemaversie ${coreStatus.schemaVersion || 'onbekend'}`,
            `Netwerkstand: ${config.mode}`,
            `Gegevens: ${config.dataDirectory ?? app.getPath('userData')}`,
          ].join('\n'),
          buttons: ['Sluiten'],
        });
      },
      sneltoetsenTonen: () => navigate('#sneltoetsen'),
      donkereModusWisselen: () => {
        nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
      },
    });

    tray = createTray(mainWindow, join(here, '../../build/icon.ico'), {
      navigeer: navigate,
      toonVenster: showWindow,
      netwerkstandTonen: () => {
        void dialog.showMessageBox({
          type: 'info',
          title: 'Netwerkstand',
          message:
            config.mode === 'host'
              ? 'De app draait als host.'
              : 'De app draait alleenstaand op deze pc.',
          detail:
            config.mode === 'host'
              ? `Collega's en telefoons bereiken de app op ${coreStatus.address}.`
              : 'Alleen deze pc heeft toegang. Zet de hostmodus aan bij Instellingen > Netwerk.',
          buttons: ['Sluiten'],
        });
      },
      afsluiten: () => {
        quitting = true;
        app.quit();
      },
    });

    // Globale sneltoets: app naar voren plus de zoekbalk.
    if (config.globalShortcut) {
      globalShortcut.register(config.globalShortcut, () => navigate('#zoeken'));
    }

    app.setLoginItemSettings({ openAtLogin: config.autoStart });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(config);
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    core?.postMessage({ type: 'stop' });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

export { readConfig, writeConfig, handleDeepLink, openExternal, filtersFor };
export type { AppConfig, CoreStatus };
