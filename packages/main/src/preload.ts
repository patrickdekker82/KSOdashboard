/**
 * Preload bridge (hoofdstuk 2.9).
 *
 * The renderer never gets `ipcRenderer`; it gets exactly the handful of calls
 * listed here, through `contextBridge`, with context isolation on.
 */
import { contextBridge, ipcRenderer } from 'electron';

export type HostStatus = {
  port: number;
  appToken: string;
  schemaVersion: string;
  mode: 'standalone' | 'host' | 'client';
  address: string;
  status: 'gestart' | 'starten' | 'fout';
  message?: string;
};

export type SaveResult = { opgeslagen: boolean; pad?: string };

/** Wat `config:lezen` teruggeeft: de instellingen van déze werkplek. */
export type AppInstellingen = {
  mode: 'standalone' | 'host' | 'client';
  port: number;
  hostAddress?: string;
  dataDirectory?: string;
  minimiseToTray: boolean;
  globalShortcut: string;
  autoStart: boolean;
  updateLocatie: string;
  gegevensmap: string;
  versie: string;
  /** De IPv4-adressen waarop deze pc in de hostmodus bereikbaar is. */
  adressen: string[];
};

export type Updateuitkomst = {
  ingeschakeld: boolean;
  huidigeVersie: string;
  nieuwsteVersie: string | null;
  nieuwerBeschikbaar: boolean;
  installer: string | null;
  uitgebracht: string | null;
  opmerkingen: string | null;
  fout: string | null;
  gecontroleerdOp: string;
};

const api = {
  appVersie: (): Promise<string> => ipcRenderer.invoke('app:versie'),
  hostStatus: (): Promise<HostStatus> => ipcRenderer.invoke('kern:status'),
  opslaanAls: (
    voorstel: string,
    inhoud: string,
    codering: 'utf8' | 'base64' = 'utf8',
  ): Promise<SaveResult> => ipcRenderer.invoke('bestand:opslaan-als', voorstel, inhoud, codering),
  openen: (): Promise<{ geopend: boolean; pad?: string }> =>
    ipcRenderer.invoke('bestand:openen'),
  toonInMap: (pad: string): Promise<void> => ipcRenderer.invoke('bestand:toon-in-map', pad),
  bestandOpenen: (pad: string): Promise<void> => ipcRenderer.invoke('bestand:openen-met', pad),
  printPdf: (html: string, voorstel: string, liggend = false): Promise<SaveResult> =>
    ipcRenderer.invoke('pdf:afdrukken', html, voorstel, liggend),
  meldingTonen: (titel: string, tekst: string, link?: string): Promise<void> =>
    ipcRenderer.invoke('melding:tonen', titel, tekst, link),
  externeLink: (url: string): Promise<void> => ipcRenderer.invoke('link:extern', url),
  // --- fase 12: appinstellingen, herstel en updates -------------------------
  configLezen: (): Promise<AppInstellingen> => ipcRenderer.invoke('config:lezen'),
  configSchrijven: (
    wijziging: Partial<AppInstellingen>,
  ): Promise<{ opgeslagen: boolean; herstartNodig: boolean }> =>
    ipcRenderer.invoke('config:schrijven', wijziging),
  backupHerstellen: (
    bestandsnaam: string,
  ): Promise<{ hersteld: boolean; veiligheidskopie?: string }> =>
    ipcRenderer.invoke('backup:herstellen', bestandsnaam),
  updateControleren: (): Promise<Updateuitkomst> => ipcRenderer.invoke('update:controleren'),
  installerTonen: (pad: string): Promise<void> => ipcRenderer.invoke('update:installer-tonen', pad),

  onNavigatie: (handler: (route: string) => void): (() => void) => {
    const listener = (_event: unknown, route: string): void => handler(route);
    ipcRenderer.on('navigeer', listener);
    return () => ipcRenderer.removeListener('navigeer', listener);
  },
  onKernStatus: (handler: (status: HostStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: HostStatus): void => handler(status);
    ipcRenderer.on('kern:status-gewijzigd', listener);
    return () => ipcRenderer.removeListener('kern:status-gewijzigd', listener);
  },
} as const;

export type ShowroomApi = typeof api;

contextBridge.exposeInMainWorld('showroom', api);
