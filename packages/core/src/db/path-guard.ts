/**
 * Guards the database location (hoofdstuk 2.3).
 *
 * SQLite over SMB or a syncing folder corrupts the database: the file locking
 * those protocols emulate is not the locking SQLite needs, and a sync client
 * happily uploads a half-written WAL. The app therefore refuses such a location
 * outright instead of warning once and letting it happen anyway. Backup copies
 * may go there — only the live database may not.
 */
import { BLOCKED_DB_PATH_PATTERNS } from '@showroom/shared';

export type PathVerdict =
  | { ok: true }
  | { ok: false; reason: 'unc' | 'netwerkschijf' | 'synchronisatiemap'; message: string };

/** True for a UNC path such as \\server\share\map. */
function isUncPath(input: string): boolean {
  return /^\\\\[^\\]+\\/.test(input) || /^\/\/[^/]+\//.test(input);
}

/**
 * Checks a proposed database location.
 *
 * `mappedDrives` lets the caller pass drive letters that Windows reports as
 * network drives (DRIVE_REMOTE); without it only UNC paths and known sync
 * folders can be recognised.
 */
export function checkDatabasePath(
  databasePath: string,
  mappedDrives: readonly string[] = [],
): PathVerdict {
  const normalised = databasePath.replace(/\//g, '\\');
  const lower = normalised.toLowerCase();

  if (isUncPath(databasePath)) {
    return {
      ok: false,
      reason: 'unc',
      message:
        'Deze locatie ligt op een netwerkshare (UNC-pad). Een actieve SQLite-database ' +
        'op een netwerkschijf raakt beschadigd. Kies een map op deze pc en zet de ' +
        'hostmodus aan als collega\u2019s moeten meekijken.',
    };
  }

  const driveLetter = /^([a-z]):\\/i.exec(normalised)?.[1]?.toUpperCase();
  if (driveLetter && mappedDrives.some((drive) => drive.toUpperCase() === driveLetter)) {
    return {
      ok: false,
      reason: 'netwerkschijf',
      message:
        `Schijf ${driveLetter}: is een toegewezen netwerkschijf. Een actieve ` +
        'SQLite-database hoort op de lokale schijf te staan. Gebruik deze locatie ' +
        'alleen als tweede back-uppad.',
    };
  }

  const segments = lower.split('\\').filter(Boolean);
  const hit = BLOCKED_DB_PATH_PATTERNS.find((pattern) =>
    segments.some((segment) => segment === pattern || segment.startsWith(`${pattern} `)),
  );
  if (hit) {
    return {
      ok: false,
      reason: 'synchronisatiemap',
      message:
        `Deze map wordt gesynchroniseerd (${hit}). Synchronisatie kopieert de ` +
        'database terwijl er nog naar geschreven wordt, wat tot beschadiging leidt. ' +
        'Kies een map buiten de synchronisatie; back-upkopie\u00ebn mogen er wel heen.',
    };
  }

  return { ok: true };
}
