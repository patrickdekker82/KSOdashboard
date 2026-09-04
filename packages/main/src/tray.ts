/** Systeemvak-icoon met snelmenu (hoofdstuk 2.8). */
import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';

export type TrayActions = {
  navigeer: (route: string) => void;
  toonVenster: () => void;
  netwerkstandTonen: () => void;
  afsluiten: () => void;
};

export type TrayHandle = {
  tray: Tray;
  /** Updates the badge count of open alerts in the menu label. */
  setAandachtspunten: (aantal: number) => void;
  destroy: () => void;
};

export function createTray(
  window: BrowserWindow,
  iconPath: string,
  actions: TrayActions,
): TrayHandle {
  const image = nativeImage.createFromPath(iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  let aandachtspunten = 0;

  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Showroom Suite openen', click: actions.toonVenster },
        { type: 'separator' },
        { label: 'Vandaag bellen', click: () => actions.navigeer('/opvolging') },
        { label: 'Nieuwe klant', click: () => actions.navigeer('/klanten/nieuw') },
        { label: 'Nieuwe activiteit', click: () => actions.navigeer('/opvolging/nieuw') },
        {
          label:
            aandachtspunten > 0 ? `Aandachtspunten (${aandachtspunten})` : 'Aandachtspunten',
          click: () => actions.navigeer('/dashboard#aandachtspunten'),
        },
        { type: 'separator' },
        { label: 'Netwerkstand tonen', click: actions.netwerkstandTonen },
        { type: 'separator' },
        { label: 'Afsluiten', click: actions.afsluiten },
      ]),
    );
    tray.setToolTip(
      aandachtspunten > 0
        ? `Showroom Suite — ${aandachtspunten} aandachtspunt${aandachtspunten === 1 ? '' : 'en'}`
        : 'Showroom Suite',
    );
  };

  rebuild();
  tray.on('double-click', actions.toonVenster);
  window.on('show', rebuild);

  return {
    tray,
    setAandachtspunten: (aantal) => {
      aandachtspunten = aantal;
      rebuild();
    },
    destroy: () => tray.destroy(),
  };
}
