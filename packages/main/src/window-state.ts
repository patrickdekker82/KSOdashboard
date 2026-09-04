/** Remembers window position, size and monitor (hoofdstuk 2.8). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

export type WindowState = Rectangle & { maximised: boolean };

const DEFAULT_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  maximised: true,
};

function stateFile(userData: string): string {
  return join(userData, 'venster.json');
}

/**
 * Reads the saved state, but only accepts a position that still lands on a
 * screen that exists — otherwise the window opens off-screen after someone
 * unplugs a monitor.
 */
export function loadWindowState(userData: string): WindowState {
  let state: WindowState;
  try {
    state = { ...DEFAULT_STATE, ...JSON.parse(readFileSync(stateFile(userData), 'utf8')) };
  } catch {
    return centreOnPrimary();
  }

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      state.x + state.width > area.x &&
      state.x < area.x + area.width &&
      state.y + state.height > area.y &&
      state.y < area.y + area.height
    );
  });

  return visible ? state : centreOnPrimary(state);
}

function centreOnPrimary(base: Partial<WindowState> = {}): WindowState {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(base.width ?? DEFAULT_STATE.width, area.width);
  const height = Math.min(base.height ?? DEFAULT_STATE.height, area.height);
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    maximised: base.maximised ?? DEFAULT_STATE.maximised,
  };
}

export function saveWindowState(userData: string, window: BrowserWindow): void {
  // A maximised window reports the maximised bounds; keep the restore bounds.
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  const state: WindowState = { ...bounds, maximised: window.isMaximized() };
  try {
    writeFileSync(stateFile(userData), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Niet kunnen onthouden waar het venster stond mag de app nooit blokkeren.
  }
}

/** Saves on every move/resize, debounced so we do not write on each pixel. */
export function trackWindowState(userData: string, window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveWindowState(userData, window), 400);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('close', () => {
    if (timer) clearTimeout(timer);
    saveWindowState(userData, window);
  });
}
