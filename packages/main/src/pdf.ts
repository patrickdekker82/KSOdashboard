/**
 * PDF via `webContents.printToPDF` in a hidden window (hoofdstuk 6.10).
 *
 * Electron carries its own Chromium, so the same HTML the app renders becomes
 * the PDF — no external browser, no Edge detection, identical on every PC.
 */
import { writeFile } from 'node:fs/promises';
import { BrowserWindow } from 'electron';

export type PdfOptions = {
  /** A4 landscape for wide tables. */
  landscape?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
};

export async function renderHtmlToPdf(
  html: string,
  targetPath: string,
  options: PdfOptions = {},
): Promise<string> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      // The hidden renderer only ever sees HTML we produced ourselves, and it
      // still runs sandboxed with no Node access.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const buffer = await window.webContents.printToPDF({
      pageSize: 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      displayHeaderFooter: Boolean(options.headerTemplate || options.footerTemplate),
      headerTemplate: options.headerTemplate ?? '<span></span>',
      footerTemplate:
        options.footerTemplate ??
        '<div style="font-size:9px;width:100%;padding:0 12mm;display:flex;' +
          'justify-content:space-between;color:#666">' +
          '<span class="date"></span>' +
          '<span>Pagina <span class="pageNumber"></span> van <span class="totalPages"></span></span>' +
          '</div>',
    });
    await writeFile(targetPath, buffer);
    return targetPath;
  } finally {
    window.destroy();
  }
}
