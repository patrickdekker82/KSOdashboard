/**
 * De foutklasse die de API teruggeeft.
 *
 * Staat bewust in een eigen bestand en niet in `server.ts`. Modules die een
 * nette fout willen gooien — een guard, een validator — hoeven zo niet de hele
 * server te importeren. Dat scheelde een invoerkring (`registry` → `guards` →
 * `server` → `fields/routes` → `registry`) die pas omviel zodra iets anders
 * dan de server als eerste geladen werd; een test van de query-bouwer liep er
 * tegenaan.
 */
export class ApiError extends Error {
  // Geen parameter properties: Node kan TypeScript alleen strippen, niet
  // omzetten, en struikelt daarover bij het draaien van de kern zonder build.
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
