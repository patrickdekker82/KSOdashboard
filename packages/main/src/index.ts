/**
 * Electron main process (hoofdstuk 2.2 en 2.8).
 *
 * Main owns the window, the Dutch menu, the tray, notifications, dialogs and
 * PDF. The business logic lives in a utility process ("de kern"); if that
 * crashes, main restarts it and says so instead of taking the window down.
 */
import { join, dirname, basename } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
import { controleerUpdate } from './updates.ts';

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
  /**
   * Map waar de systeembeheerder de installer neerzet, meestal op de
   * netwerkschijf. Leeg = geen updatecontrole, en dat is de standaard.
   */
  updateLocatie: string;
};

const DEFAULT_CONFIG: AppConfig = {
  mode: 'standalone',
  port: 4317,
  minimiseToTray: false,
  globalShortcut: 'CommandOrControl+Alt+S',
  autoStart: false,
  updateLocatie: '',
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
  const entry = join(here, '../core/host.cjs');
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

/**
 * De IPv4-adressen waarop deze pc in de hostmodus te bereiken is.
 *
 * Nodig omdat "zet de hostmodus aan" een halve instructie is: de collega aan de
 * andere kant van de gang moet weten wát hij in zijn browser moet typen. Dit
 * levert de adressen op die het scherm kan tonen.
 *
 * Loopback en interne adressen vallen af; die helpen niemand.
 */
function lanAdressen(): string[] {
  const gevonden: string[] = [];

  for (const kaarten of Object.values(networkInterfaces())) {
    for (const kaart of kaarten ?? []) {
      if (kaart.family !== 'IPv4' || kaart.internal) continue;
      gevonden.push(kaart.address);
    }
  }

  return gevonden;
}

// ---------------------------------------------------------------------------
// IPC — precies wat preload aanbiedt, niet meer
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('app:versie', () => app.getVersion());
  ipcMain.handle('kern:status', () => coreStatus);

  // --- appinstellingen: netwerkstand, systeemvak, autostart, updates -------
  //
  // Deze staan bewust in config.json van de schil en niet in de database. Ze
  // gaan over déze werkplek: welke pc de host is, of hij naar het systeemvak
  // minimaliseert, waar de installer staat. Een collega die de database deelt
  // hoort daar niets van te merken.
  ipcMain.handle('config:lezen', () => ({
    ...readConfig(),
    gegevensmap: readConfig().dataDirectory ?? app.getPath('userData'),
    versie: app.getVersion(),
    adressen: lanAdressen(),
  }));

  ipcMain.handle('config:schrijven', (_event, wijziging: Partial<AppConfig>) => {
    const huidig = readConfig();
    const nieuw: AppConfig = { ...huidig, ...wijziging };

    if (nieuw.port < 1024 || nieuw.port > 65535) {
      throw new Error('Kies een poort tussen 1024 en 65535.');
    }

    writeConfig(nieuw);

    // De autostart zet Windows zelf; dat kan meteen.
    if (nieuw.autoStart !== huidig.autoStart) {
      app.setLoginItemSettings({ openAtLogin: nieuw.autoStart });
    }

    // De netwerkstand en de poort raken de kern, en die start alleen bij het
    // opstarten. Dat eerlijk melden is beter dan de kern eronder vandaan
    // herstarten terwijl iemand aan het typen is.
    const herstartNodig = nieuw.mode !== huidig.mode || nieuw.port !== huidig.port;

    return { opgeslagen: true, herstartNodig };
  });

  // --- back-up terugzetten -------------------------------------------------
  //
  // Dit kan niet via de API van de kern: die schrijft op precies de database
  // die vervangen moet worden. Alleen de schil kan de kern stoppen, het bestand
  // omwisselen en hem weer starten.
  ipcMain.handle('backup:herstellen', async (_event, bestandsnaam: string) => {
    const config = readConfig();
    const gegevensmap = config.dataDirectory ?? app.getPath('userData');
    const database = join(gegevensmap, 'showroom.db');
    const backupmap = join(gegevensmap, 'backups');
    const bron = join(backupmap, basename(bestandsnaam));

    if (basename(bestandsnaam) !== bestandsnaam || !existsSync(bron)) {
      throw new Error(`De back-up ${bestandsnaam} staat niet in de back-upmap.`);
    }

    const bevestiging = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Terugzetten', 'Annuleren'],
      defaultId: 1,
      cancelId: 1,
      title: 'Back-up terugzetten',
      message: `Weet u zeker dat u ${bestandsnaam} wilt terugzetten?`,
      detail:
        'Alles wat na die back-up is ingevoerd verdwijnt. Van de huidige database wordt ' +
        'eerst een kopie gemaakt, zodat dit terug te draaien is. De applicatie start hierna opnieuw.',
    });
    if (bevestiging.response !== 0) return { hersteld: false };

    // De kern stoppen en wachten tot hij de database echt heeft losgelaten.
    quitting = true;
    core?.kill();
    await new Promise((klaar) => setTimeout(klaar, 1500));
    quitting = false;

    const stempel = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
    const veiligheidskopie = join(backupmap, `showroom-voor-herstel-${stempel}.db`);

    try {
      if (existsSync(database)) copyFileSync(database, veiligheidskopie);

      const tijdelijk = `${database}.nieuw`;
      copyFileSync(bron, tijdelijk);
      for (const achtervoegsel of ['-wal', '-shm']) {
        const zijbestand = `${database}${achtervoegsel}`;
        if (existsSync(zijbestand)) unlinkSync(zijbestand);
      }
      renameSync(tijdelijk, database);
    } catch (fout) {
      startCoreProcess(readConfig());
      throw new Error(
        `Terugzetten is niet gelukt: ${fout instanceof Error ? fout.message : String(fout)}`,
      );
    }

    notify('Back-up teruggezet', `${bestandsnaam} staat terug. De applicatie start opnieuw.`);
    app.relaunch();
    app.exit(0);

    return { hersteld: true, veiligheidskopie: basename(veiligheidskopie) };
  });

  // --- updates -------------------------------------------------------------
  ipcMain.handle('update:controleren', () =>
    controleerUpdate(readConfig().updateLocatie, app.getVersion()),
  );

  ipcMain.handle('update:installer-tonen', (_event, pad: string) => {
    if (existsSync(pad)) shell.showItemInFolder(pad);
  });

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
