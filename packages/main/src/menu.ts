/** Nederlandstalig applicatiemenu (hoofdstuk 2.8). */
import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export type MenuActions = {
  navigeer: (route: string) => void;
  backupNu: () => void;
  importeren: () => void;
  exporteren: () => void;
  logboekOpenen: () => void;
  controleerUpdates: () => void;
  overTonen: () => void;
  sneltoetsenTonen: () => void;
  donkereModusWisselen: () => void;
};

export function buildMenu(window: BrowserWindow, actions: MenuActions): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Bestand',
      submenu: [
        {
          label: 'Nieuwe klant',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => actions.navigeer('/klanten/nieuw'),
        },
        {
          label: 'Nieuwe kans',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => actions.navigeer('/kansen/nieuw'),
        },
        {
          label: 'Nieuw project',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => actions.navigeer('/projecten/nieuw'),
        },
        { type: 'separator' },
        { label: 'Importeren...', click: actions.importeren },
        { label: 'Exporteren...', click: actions.exporteren },
        { type: 'separator' },
        { label: 'Back-up nu', click: actions.backupNu },
        { type: 'separator' },
        { label: 'Afsluiten', role: 'quit' },
      ],
    },
    {
      label: 'Bewerken',
      submenu: [
        { label: 'Ongedaan maken', role: 'undo' },
        { label: 'Opnieuw', role: 'redo' },
        { type: 'separator' },
        { label: 'Knippen', role: 'cut' },
        { label: 'Kopiëren', role: 'copy' },
        { label: 'Plakken', role: 'paste' },
        { label: 'Alles selecteren', role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Zoeken',
          accelerator: 'CmdOrCtrl+K',
          click: () => actions.navigeer('#zoeken'),
        },
      ],
    },
    {
      label: 'Weergave',
      submenu: [
        { label: 'Vernieuwen', role: 'reload' },
        { type: 'separator' },
        { label: 'Inzoomen', role: 'zoomIn' },
        { label: 'Uitzoomen', role: 'zoomOut' },
        { label: 'Werkelijke grootte', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Volledig scherm', role: 'togglefullscreen' },
        { label: 'Donkere modus', click: actions.donkereModusWisselen },
        { type: 'separator' },
        { label: 'Ontwikkelaarsgereedschap', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Extra',
      submenu: [
        { label: 'Instellingen', click: () => actions.navigeer('/instellingen') },
        { label: 'Verlofkalender', click: () => actions.navigeer('/verlof') },
        { label: 'Planning', click: () => actions.navigeer('/planning') },
        { label: 'Query-tool', click: () => actions.navigeer('/rapportages/query') },
        { type: 'separator' },
        { label: 'Logboek openen', click: actions.logboekOpenen },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Handleiding',
          click: () => {
            void shell.openExternal('https://github.com/patrickdekker82/KSOdashboard#readme');
          },
        },
        { label: 'Sneltoetsen', accelerator: 'CmdOrCtrl+/', click: actions.sneltoetsenTonen },
        { type: 'separator' },
        { label: 'Controleren op updates', click: actions.controleerUpdates },
        { label: `Over ${'Showroom Suite'}`, click: actions.overTonen },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  window.setMenu(menu);
  return menu;
}
