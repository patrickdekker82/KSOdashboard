/**
 * Client for the core.
 *
 * The renderer never talks to the database; it talks HTTP to the utility
 * process over loopback, with the session token preload handed it.
 */
import type {
  CapacityGap,
  CapacityWeek,
  FieldDefinition,
  FieldType,
  UserWeekAvailability,
} from '@showroom/shared';

export type HostStatus = {
  port: number;
  appToken: string;
  schemaVersion: string;
  mode: 'standalone' | 'host' | 'client';
  address: string;
  status: 'gestart' | 'starten' | 'fout';
  message?: string;
};

/** De instellingen van déze werkplek, uit config.json van de schil. */
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

export type Gebruiker = {
  id: number;
  name: string;
  initials: string;
  email: string;
  role: 'admin' | 'manager' | 'user' | 'readonly';
  mustChangePassword: boolean;
  isKopersbegeleider: boolean;
};

declare global {
  interface Window {
    showroom?: {
      appVersie: () => Promise<string>;
      hostStatus: () => Promise<HostStatus>;
      opslaanAls: (voorstel: string, inhoud: string, codering?: string) => Promise<unknown>;
      toonInMap: (pad: string) => Promise<void>;
      printPdf: (html: string, voorstel: string, liggend?: boolean) => Promise<unknown>;
      meldingTonen: (titel: string, tekst: string, link?: string) => Promise<void>;
      externeLink: (url: string) => Promise<void>;
      onNavigatie: (handler: (route: string) => void) => () => void;
      onKernStatus: (handler: (status: HostStatus) => void) => () => void;
      // fase 12
      configLezen: () => Promise<AppInstellingen>;
      configSchrijven: (
        wijziging: Partial<AppInstellingen>,
      ) => Promise<{ opgeslagen: boolean; herstartNodig: boolean }>;
      backupHerstellen: (
        bestandsnaam: string,
      ) => Promise<{ hersteld: boolean; veiligheidskopie?: string }>;
      updateControleren: () => Promise<Updateuitkomst>;
      installerTonen: (pad: string) => Promise<void>;
    };
  }
}

export class ApiFout extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiFout';
    this.status = status;
    this.code = code;
  }
}

let host: HostStatus | null = null;

/** Resolves the core's address once, then caches it. */
export async function kernStatus(): Promise<HostStatus> {
  if (host && host.status === 'gestart') return host;
  if (window.showroom) {
    host = await window.showroom.hostStatus();
    return host;
  }
  // Zonder Electron (browser via de hostmodus) praat de pagina met dezelfde
  // oorsprong en verloopt de authenticatie via de sessiecookie.
  host = {
    port: Number(location.port || 80),
    appToken: '',
    schemaVersion: '',
    mode: 'host',
    address: location.origin,
    status: 'gestart',
  };
  return host;
}

async function verzoek<T>(pad: string, init: RequestInit = {}): Promise<T> {
  const status = await kernStatus();
  const basis = window.showroom ? `http://127.0.0.1:${status.port}` : '';

  const response = await fetch(`${basis}/api/v1${pad}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(status.appToken ? { 'x-showroom-token': status.appToken } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiFout(
      response.status,
      body?.error?.code ?? 'onbekend',
      body?.error?.message ?? 'Er ging iets mis bij het ophalen van de gegevens.',
    );
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(pad: string) => verzoek<T>(pad),
  post: <T>(pad: string, body?: unknown) =>
    verzoek<T>(pad, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(pad: string, body: unknown) =>
    verzoek<T>(pad, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(pad: string, body: unknown) =>
    verzoek<T>(pad, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(pad: string) => verzoek<T>(pad, { method: 'DELETE' }),
};

// --- typed endpoints --------------------------------------------------------

export type Lijst<T> = { data: T[]; meta?: Record<string, unknown> };

/** Uploadt een bijlage. Multipart, dus buiten de JSON-helper om. */
export async function uploadBijlage(
  entiteit: string,
  id: number,
  bestand: File,
): Promise<{ id: number; filename: string }> {
  const status = await kernStatus();
  const basis = window.showroom ? `http://127.0.0.1:${status.port}` : '';
  const body = new FormData();
  body.append('file', bestand);

  const response = await fetch(`${basis}/api/v1/${entiteit}/${id}/attachments`, {
    method: 'POST',
    credentials: 'include',
    // Geen content-type meezetten: de browser bepaalt de multipart-grens zelf.
    headers: status.appToken ? { 'x-showroom-token': status.appToken } : {},
    body,
  });

  if (!response.ok) {
    const fout = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiFout(
      response.status,
      fout?.error?.code ?? 'onbekend',
      fout?.error?.message ?? 'Het bestand kon niet worden opgeslagen.',
    );
  }
  return (await response.json()).data as { id: number; filename: string };
}

/**
 * Stuurt een planningsbestand naar de kern voor een droogloop.
 *
 * Multipart, dus buiten de JSON-helper om. De koppeling gaat als tekstveld mee
 * zodat de gebruiker hem kan aanpassen en het voorbeeld opnieuw kan opvragen
 * zonder het bestand nog een keer te kiezen — al kost dat wel een nieuwe upload,
 * en dat is de prijs voor niets op de server bewaren wat niet nodig is.
 */
export async function importVoorbeeld(
  bestand: File,
  opties: { kopregel?: number; koppeling?: Koppeling; bestaandeBijwerken?: boolean } = {},
): Promise<ImportVoorbeeld> {
  const status = await kernStatus();
  const basis = window.showroom ? `http://127.0.0.1:${status.port}` : '';
  const body = new FormData();
  body.append('file', bestand);
  body.append('kopregel', String(opties.kopregel ?? 1));
  if (opties.koppeling) body.append('koppeling', JSON.stringify(opties.koppeling));
  if (opties.bestaandeBijwerken === false) body.append('bestaandeBijwerken', 'false');

  const response = await fetch(`${basis}/api/v1/imports/preview`, {
    method: 'POST',
    credentials: 'include',
    headers: status.appToken ? { 'x-showroom-token': status.appToken } : {},
    body,
  });

  if (!response.ok) {
    const fout = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiFout(
      response.status,
      fout?.error?.code ?? 'onbekend',
      fout?.error?.message ?? 'Het bestand kon niet worden ingelezen.',
    );
  }

  return (await response.json()).data as ImportVoorbeeld;
}

/** Bouwt de download-URL van een bijlage, inclusief het sessietoken. */
export async function bijlageUrl(bijlageId: number): Promise<string> {
  const status = await kernStatus();
  const basis = window.showroom ? `http://127.0.0.1:${status.port}` : '';
  return `${basis}/api/v1/attachments/${bijlageId}/download`;
}

export const endpoints = {
  ik: () => api.get<{ gebruiker: Gebruiker }>('/auth/me'),
  inloggen: (email: string, password: string) =>
    api.post<{ gebruiker: Gebruiker }>('/auth/login', { email, password }),
  uitloggen: () => api.post<{ afgemeld: boolean }>('/auth/logout'),
  wachtwoordWijzigen: (huidig: string, nieuw: string) =>
    api.post<{ gewijzigd: boolean }>('/auth/change-password', { huidig, nieuw }),
  gezondheid: () => api.get<{ status: string; schemaVersion: string; mode: string }>('/health'),

  weekbezetting: (from?: string, to?: string) =>
    api.get<Lijst<CapacityWeek>>(
      `/capacity/weekly${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`,
    ),
  gaten: (from?: string, to?: string) =>
    api.get<Lijst<CapacityGap>>(`/capacity/gaps${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`),
  simuleer: (scenario: Record<string, unknown>) =>
    api.post<Lijst<CapacityWeek>>('/capacity/simulate', scenario),
  perBegeleider: (from?: string, to?: string) =>
    api.get<Lijst<{ userId: number; initials: string; weken: unknown[] }>>(
      `/capacity/by-user${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`,
    ),

  beschikbaarheid: (from?: string, to?: string) =>
    api.get<Lijst<{ isoWeek: { year: number; week: number }; gebruikers: UserWeekAvailability[] }>>(
      `/availability/weekly${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`,
    ),
  kalender: (from?: string, to?: string) =>
    api.get<{
      data: {
        afwezigheid: Record<string, unknown>[];
        inzet: Record<string, unknown>[];
        weken: CapacityWeek[];
      };
    }>(`/availability/calendar${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`),

  lijst: <T>(entiteit: string, query = '') => api.get<Lijst<T>>(`/${entiteit}${query}`),
  record: <T>(entiteit: string, id: number) => api.get<{ data: T }>(`/${entiteit}/${id}`),
  bewaar: <T>(entiteit: string, id: number | null, body: unknown) =>
    id === null
      ? api.post<{ data: T }>(`/${entiteit}`, body)
      : api.patch<{ data: T }>(`/${entiteit}/${id}`, body),
  verwijder: (entiteit: string, id: number) =>
    api.del<{ verwijderd: boolean; herstelbaar: boolean }>(`/${entiteit}/${id}`),
  herstel: (entiteit: string, id: number) =>
    api.post<{ data: unknown }>(`/${entiteit}/${id}/restore`),

  // --- veldenregister ------------------------------------------------------
  velden: (entiteit: string, includeArchived = false) =>
    api.get<{ data: { velden: FieldDefinition[]; secties: Sectie[] } }>(
      `/fields?entity=${entiteit}${includeArchived ? '&includeArchived=true' : ''}`,
    ),
  veldtypes: () =>
    api.get<{
      data: {
        types: Array<{ type: FieldType; label: string; align: string; defaultWidth: number; operators: string[] }>;
        functies: string[];
        entiteiten: string[];
      };
    }>('/field-types'),
  veldToevoegen: (body: unknown) => api.post<{ data: FieldDefinition }>('/fields', body),
  veldWijzigen: (id: number, body: unknown) =>
    api.patch<{ data: FieldDefinition }>(`/fields/${id}`, body),
  veldVerbergen: (id: number) =>
    api.del<{ gearchiveerd?: boolean; verborgen?: boolean; melding: string }>(`/fields/${id}`),
  veldHerstellen: (id: number) => api.post<{ data: FieldDefinition }>(`/fields/${id}/restore`),
  veldDefinitiefVerwijderen: (id: number, bevestiging: string) =>
    api.post<{ verwijderd: boolean; rijen: number; melding: string }>(`/fields/${id}/purge`, {
      bevestiging,
    }),
  veldenHerordenen: (entiteit: string, volgorde: Array<{ id: number; section_id: number | null; sort_order: number }>) =>
    api.post<{ data: FieldDefinition[] }>('/fields/reorder', { entity_key: entiteit, volgorde }),
  formuleControleren: (expression: string) =>
    api.post<{ data: { ok: boolean; velden?: string[]; fout?: string } }>('/fields/check-formula', {
      expression,
    }),
  sleutelVoorstellen: (label: string) =>
    api.post<{ data: { field_key: string } }>('/fields/suggest-key', { label }),

  // --- CRM (fase 3) --------------------------------------------------------
  zoek: (term: string) =>
    api.get<{ data: { treffers: ZoekTreffer[]; term: string } }>(
      `/search?q=${encodeURIComponent(term)}`,
    ),
  tijdlijn: (entiteit: string, id: number) =>
    api.get<{ data: TijdlijnItem[] }>(`/${entiteit}/${id}/timeline`),
  activiteitToevoegen: (entiteit: string, id: number, body: unknown) =>
    api.post<{ data: unknown }>(`/${entiteit}/${id}/activities`, body),
  tags: (entiteit: string, id: number) =>
    api.get<{ data: Array<{ id: number; name: string; color: string | null }> }>(
      `/${entiteit}/${id}/tags`,
    ),
  tagToevoegen: (entiteit: string, id: number, name: string) =>
    api.post<{ data: { id: number; name: string } }>(`/${entiteit}/${id}/tags`, { name }),
  tagVerwijderen: (entiteit: string, id: number, tagId: number) =>
    api.del<{ verwijderd: boolean }>(`/${entiteit}/${id}/tags/${tagId}`),

  dubbelen: (entiteit: string) =>
    api.get<{
      data: { paren: DubbelPaar[]; records: Array<Record<string, unknown>> };
      meta: { entiteit: string; onderzocht: number; gevonden: number };
    }>(`/duplicates?entity=${entiteit}`),
  samenvoegen: (entiteit: string, winnaarId: number, verliezerId: number, waarden: Record<string, unknown>) =>
    api.post<{ data: { verplaatst: Array<{ tabel: string; kolom: string; rijen: number }> } }>(
      `/${entiteit}/${winnaarId}/merge`,
      { verliezerId, waarden },
    ),

  bijlagen: (entiteit: string, id: number) =>
    api.get<{ data: Bijlage[] }>(`/${entiteit}/${id}/attachments`),
  bijlageVerwijderen: (id: number) =>
    api.del<{ verwijderd: boolean }>(`/attachments/${id}`),

  avgDossier: (contactId: number) =>
    api.get<{ data: Record<string, unknown> }>(`/contacts/${contactId}/gdpr-export`),
  avgAnonimiseren: (contactId: number) =>
    api.post<{ data: { overschreven: string[]; behouden: Array<{ wat: string; aantal: number }> } }>(
      `/contacts/${contactId}/anonymise`,
      { bevestiging: 'ANONIMISEREN' },
    ),

  // --- kansen (fase 4) ------------------------------------------------------
  kansfasen: () => api.get<{ data: Fase[] }>('/opportunities/stages'),
  kansenbord: (eigenaarId?: number) =>
    api.get<{ data: { fasen: Fase[]; kansen: BordKans[] } }>(
      `/opportunities/board${eigenaarId ? `?ownerId=${eigenaarId}` : ''}`,
    ),
  kansNaarFase: (id: number, stageId: number) =>
    api.post<{ data: FaseWissel }>(`/opportunities/${id}/stage`, { stageId }),
  kansWinnen: (id: number, regels: Array<{ lineId: number; wonAmountCents: number }>, maakProject: boolean) =>
    api.post<{ data: { opportunityId: number; wonAmountCents: number; regels: number; projectId: number | null } }>(
      `/opportunities/${id}/win`,
      { regels, maakProject },
    ),
  kansVerliezen: (id: number, redenId: number | null, notitie: string | null) =>
    api.post<{ data: { opportunityId: number; reden: number | null } }>(
      `/opportunities/${id}/lose`,
      { redenId, notitie },
    ),
  kansNaarProject: (id: number) =>
    api.post<{ data: { projectId: number } }>(`/opportunities/${id}/create-project`),
  kansHistorie: (id: number) => api.get<{ data: FaseHistorie[] }>(`/opportunities/${id}/history`),
  verouderdeKansen: () => api.get<{ data: VerouderdeKans[] }>('/opportunities/stale'),
  pijplijnrapport: (van?: string, tot?: string) =>
    api.get<{ data: Pijplijnrapport; meta: { van?: string; tot?: string } }>(
      `/reports/pipeline${van && tot ? `?from=${van}&to=${tot}` : ''}`,
    ),

  // --- verlof en inzet (fase 5) --------------------------------------------
  verlofsaldi: (jaar: number) =>
    api.get<{ data: Verlofsaldo[]; meta: { jaar: number } }>(
      `/leave-balances/overview?year=${jaar}`,
    ),
  verlofConflicten: (userId: number, start: string, eind: string, dayPart = 'hele_dag') =>
    api.get<{ data: VerlofConflict }>(
      `/absences/conflicts?userId=${userId}&start=${start}&end=${eind}&dayPart=${dayPart}`,
    ),
  verlofGoedkeuren: (id: number, note: string) =>
    api.post<{ id: number; status: string }>(`/absences/${id}/approve`, { note }),
  verlofAfwijzen: (id: number, note: string) =>
    api.post<{ id: number; status: string }>(`/absences/${id}/reject`, { note }),
  verlofAnnuleren: (id: number) =>
    api.post<{ id: number; status: string }>(`/absences/${id}/cancel`),
  afwezigheidstypes: () =>
    api.get<Lijst<Afwezigheidstype>>('/absence-types?pageSize=100'),
  inzettypes: () =>
    api.get<Lijst<{ id: number; name: string; code: string; color: string | null }>>(
      '/allocation-types?pageSize=100',
    ),

  // --- planningimport (fase 6) ---------------------------------------------
  importVelden: () => api.get<{ data: ImportVeld[] }>('/imports/fields'),
  importDoorvoeren: (batchId: number, koppeling: Koppeling, bestaandeBijwerken: boolean, kopregel: number) =>
    api.post<{ data: ImportUitkomst }>(`/imports/${batchId}/commit`, {
      koppeling,
      bestaandeBijwerken,
      kopregel,
    }),
  imports: () => api.get<{ data: ImportBatch[] }>('/imports'),
  importDetail: (id: number) =>
    api.get<{ data: { batch: ImportBatch; rijen: ImportBatchRij[] } }>(`/imports/${id}`),

  // --- signaleringen (fase 7) ----------------------------------------------
  meldingen: (query = '') =>
    api.get<{ data: Melding[]; meta: { telling: MeldingTelling } }>(`/alerts${query}`),
  meldingTelling: () => api.get<{ data: MeldingTelling }>('/alerts/count'),
  meldingRegels: () => api.get<{ data: Meldingregel[] }>('/alerts/rules'),
  meldingenDoorrekenen: (regelId?: number) =>
    api.post<{ data: ControleUitkomst }>('/alerts/run', regelId ? { regelId } : {}),
  meldingBevestigen: (id: number) =>
    api.post<{ data: { id: number; status: string } }>(`/alerts/${id}/acknowledge`),
  meldingUitstellen: (id: number, dagen: number) =>
    api.post<{ data: { id: number; status: string; tot: string } }>(`/alerts/${id}/snooze`, {
      dagen,
    }),
  meldingSluiten: (id: number) =>
    api.post<{ data: { id: number; status: string } }>(`/alerts/${id}/resolve`),

  // --- pakketten en offertes (fase 8) --------------------------------------
  pakketten: () => api.get<{ data: PakketMetPrijs[] }>('/packages/overview'),
  volgendOffertenummer: () => api.get<{ data: { nummer: string | null } }>('/quotes/next-number'),
  offerteVanPakket: (body: {
    packageId: number;
    organizationId?: number | null;
    contactId?: number | null;
    projectId?: number | null;
    opportunityId?: number | null;
    aantal?: number;
  }) => api.post<{ data: { quoteId: number } }>('/quotes/from-package', body),
  offerte: (id: number) =>
    api.get<{ data: { offerte: Offerte; regels: Offerteregel[] } }>(`/quotes/${id}`),
  offerteOptie: (id: number, lineId: number, gekozen: boolean) =>
    api.post<{ data: OfferteTotalen }>(`/quotes/${id}/lines/${lineId}/select`, { gekozen }),
  offerteHerberekenen: (id: number) =>
    api.post<{ data: OfferteTotalen }>(`/quotes/${id}/recalculate`),
  offerteVersturen: (id: number, geldigTot?: string) =>
    api.post<{ data: { quoteId: number; status: string; validUntil: string } }>(
      `/quotes/${id}/send`,
      geldigTot ? { geldigTot } : {},
    ),
  offerteAccepteren: (id: number) =>
    api.post<{ data: { quoteId: number; status: string } }>(`/quotes/${id}/accept`),
  offerteAfwijzen: (id: number, redenId: number | null, notitie: string | null) =>
    api.post<{ data: { quoteId: number; status: string } }>(`/quotes/${id}/decline`, {
      redenId,
      notitie,
    }),

  // --- e-mail en opvolging (fase 9) ----------------------------------------
  mailsjablonen: (entiteit?: string) =>
    api.get<{ data: Mailsjabloon[] }>(
      `/email/templates${entiteit ? `?entity=${encodeURIComponent(entiteit)}` : ''}`,
    ),
  mailContext: (entiteit: string, recordId: number) =>
    api.get<{ data: { waarden: Record<string, string>; ontvangers: OntvangerUitkomst } }>(
      `/email/context?entity=${encodeURIComponent(entiteit)}&recordId=${recordId}`,
    ),
  mailOpstellen: (body: {
    entity: string;
    recordId: number;
    templateId?: number | null;
    onderwerp?: string;
    bodyHtml?: string;
    aan?: Array<{ adres: string; naam?: string | null }>;
  }) => api.post<{ data: OpgesteldBericht }>('/email/compose', body),
  mailVerstuurd: (id: number) =>
    api.post<{ data: { id: number; status: string } }>(`/email/${id}/sent`),
  mailBerichten: (entiteit: string, recordId: number) =>
    api.get<{ data: Mailbericht[] }>(
      `/email/messages?entity=${encodeURIComponent(entiteit)}&recordId=${recordId}`,
    ),

  werklijst: (userId?: number) =>
    api.get<{ data: Werklijst; meta: { userId: number } }>(
      `/followup/mine${userId ? `?userId=${userId}` : ''}`,
    ),
  activiteitAfronden: (
    id: number,
    body: {
      uitkomst?: string | null;
      vervolg?: { type: string; subject: string; dueAt: string } | null;
    },
  ) => api.post<{ data: { activiteitId: number; vervolgId: number | null } }>(
    `/activities/${id}/complete`,
    body,
  ),
  bellijst: (id: number) => api.get<{ data: Bellijstregel[] }>(`/call-lists/${id}/members`),
  belregelMarkeren: (id: number, entiteit: string, recordId: number, gedaan: boolean, notitie: string | null) =>
    api.post<{ data: { lijstId: number; recordId: number } }>(`/call-lists/${id}/members/mark`, {
      entity: entiteit,
      recordId,
      gedaan,
      notitie,
    }),

  // --- instellingen (fase 12) ------------------------------------------------
  instellingenLezen: () => api.get<{ data: Record<string, unknown> }>('/settings'),
  instellingenOpslaan: (wijziging: Record<string, unknown>) =>
    api.patch<{ opgeslagen: number }>('/settings', wijziging),

  // --- back-up (fase 12) -----------------------------------------------------
  backups: () => api.get<{ data: Backupoverzicht }>('/backups'),
  backupMaken: (naarDoelmap = false) =>
    api.post<{ data: { bestandsnaam: string; bytes: number; duurMs: number; opgeruimd: number } }>(
      '/backups',
      { naarDoelmap },
    ),
  backupControleren: (naam: string) =>
    api.post<{ data: { bestandsnaam: string; bruikbaar: boolean; bytes: number } }>(
      `/backups/${encodeURIComponent(naam)}/check`,
    ),
  backupLocatie: () => api.get<{ data: Databaselocatie }>('/backups/locatie'),

  // --- rapportages en export (fase 11) ---------------------------------------
  rapportEntiteiten: () => api.get<{ data: RapportEntiteit[] }>('/reports/entities'),
  rapportSchema: () => api.get<{ data: SchemaTabel[] }>('/reports/schema'),
  rapportDraaien: (body: Rapportverzoek) =>
    api.post<{ data: Rapportuitkomst; meta: Rapportmeta }>('/reports/run', body),
  rapportExporteren: (body: Rapportverzoek & { formaat: string; titel: string }) =>
    api.post<{ data: Exportbestand }>('/reports/export', body),
  rapportenOpgeslagen: () => api.get<{ data: OpgeslagenRapport[] }>('/reports/saved'),
  rapportBewaren: (body: {
    naam: string;
    omschrijving?: string;
    definitie?: Bouwdefinitie;
    sql?: string;
    gedeeld: boolean;
  }) => api.post<{ data: OpgeslagenRapport }>('/reports/saved', body),
  rapportVerwijderen: (id: number) =>
    api.del<{ data: { id: number } }>(`/reports/saved/${id}`),

  // --- AI-assistent (fase 10) -----------------------------------------------
  aiStatus: () => api.get<{ data: AiStatus }>('/ai/status'),
  aiSleutel: (sleutel: string) =>
    api.put<{ data: { ingeschakeld: boolean } }>('/ai/key', { key: sleutel }),
  aiPresets: (alleenActieve = false) =>
    api.get<{ data: AiPreset[] }>(`/ai/presets${alleenActieve ? '?active=true' : ''}`),
  aiPresetOpslaan: (id: number, body: Partial<AiPresetInvoer>) =>
    api.patch<{ data: AiPreset }>(`/ai/presets/${id}`, body),
  aiVoorbeeld: (body: AiOpdracht) => api.post<{ data: AiVoorbeeld }>('/ai/preview', body),
  aiUitvoeren: (body: AiOpdracht) => api.post<{ data: AiUitvoering }>('/ai/run', body),
  aiLogboek: (limiet = 100) =>
    api.get<{ data: AiRun[]; meta: { perMaand: AiMaand[] } }>(`/ai/runs?limit=${limiet}`),

  keuzelijsten: () => api.get<Lijst<{ id: number; key: string; name: string }>>('/picklists'),
  keuzelijstItems: (picklistId: number) =>
    api.get<Lijst<{ id: number; value: string; label: string; color: string | null }>>(
      `/picklist-items?filter=${btoa(JSON.stringify({ field: 'picklist_id', operator: 'eq', value: picklistId }))}`,
    ),
  gebruikers: () =>
    api.get<Lijst<{ id: number; name: string; initials: string }>>('/users?pageSize=200'),
};

export type ZoekTreffer = {
  entiteit: string;
  id: number;
  titel: string;
  ondertitel: string | null;
  soort: string;
};

export type TijdlijnItem = {
  soort: 'activiteit' | 'wijziging' | 'email' | 'offerte' | 'fase';
  id: number;
  op: string;
  titel: string;
  tekst: string | null;
  door: string | null;
};

export type DubbelPaar = {
  a: number;
  b: number;
  score: number;
  redenen: string[];
  uitleg: string;
};

export type Bijlage = {
  id: number;
  filename: string;
  mime: string | null;
  size_bytes: number;
  description: string | null;
  uploaded_at: string;
  door: string | null;
};

export type Sectie = {
  id: number;
  entityKey: string;
  name: string;
  sortOrder: number;
  columns: number;
  collapsible: boolean;
  defaultOpen: boolean;
};

// --- kansen -----------------------------------------------------------------

export type Fase = {
  id: number;
  name: string;
  sortOrder: number;
  defaultProbabilityBp: number;
  isWon: boolean;
  isLost: boolean;
  rottingDays: number | null;
  color: string | null;
};

export type BordKans = {
  id: number;
  number: string | null;
  name: string;
  stage_id: number | null;
  status: string;
  amount_cents: number;
  weighted_amount_cents: number;
  probability_bp: number | null;
  expected_close_date: string | null;
  expected_units: number | null;
  organisatie: string | null;
  eigenaar: string | null;
  dagen_stil: number | null;
};

export type FaseWissel = {
  opportunityId: number;
  vanFase: number | null;
  naarFase: number;
  dagenInVorigeFase: number | null;
  status: string;
};

export type FaseHistorie = {
  id: number;
  at: string;
  days_in_stage: number | null;
  van_fase: string | null;
  naar_fase: string | null;
  door: string | null;
};

export type VerouderdeKans = {
  id: number;
  name: string;
  stage: string;
  dagenStil: number;
  rottingDays: number;
  amountCents: number;
  eigenaar: string | null;
};

export type Pijplijnrapport = {
  samenvatting: {
    openAantal: number;
    openCents: number;
    gewogenCents: number;
    gescoordDitJaarCents: number;
    winRatePct: number;
    gemiddeldeDealCents: number;
  };
  trechter: Array<{
    stageId: number;
    fase: string;
    volgorde: number;
    kleur: string | null;
    aantal: number;
    bedragCents: number;
    gewogenCents: number;
  }>;
  winRatePerDiscipline: WinRate[];
  winRatePerEigenaar: WinRate[];
  winRatePerBron: WinRate[];
  doorlooptijd: Array<{
    stageId: number;
    fase: string;
    volgorde: number;
    gemiddeldeDagen: number;
    medianeDagen: number;
    metingen: number;
  }>;
  omzetPerDiscipline: Array<{
    discipline: string;
    maand: string;
    aantalRegels: number;
    gescoordCents: number;
  }>;
  verliesredenen: Array<{ reden: string; aantal: number; gemistCents: number }>;
};

export type WinRate = {
  sleutel: string;
  label: string;
  gewonnen: number;
  verloren: number;
  winRatePct: number;
  gescoordCents: number;
};

export type Kansregel = {
  id: number;
  opportunity_id: number;
  discipline_id: number;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price_cents: number;
  discount_bp: number;
  amount_cents: number;
  cost_price_cents: number;
  margin_cents: number;
  probability_bp: number | null;
  status: 'open' | 'won' | 'lost';
  won_amount_cents: number | null;
  sort_order: number;
};

// --- verlof en inzet --------------------------------------------------------

export type Verlofsaldo = {
  userId: number;
  initials: string;
  name: string;
  jaar: number;
  rechtUren: number;
  overgeheveldUren: number;
  opgenomenUren: number;
  aangevraagdUren: number;
  resterendUren: number;
  vrijTeBestedenUren: number;
  rechtVastgelegd: boolean;
};

export type VerlofConflictWeek = {
  isoYear: number;
  isoWeek: number;
  bezettingVoor: number;
  bezettingNa: number;
  capaciteitVoor: number;
  capaciteitNa: number;
  begeleidersBeschikbaar: number;
  overbezetting: boolean;
  teWeinigBegeleiders: boolean;
  alAfwezig: string[];
};

export type VerlofConflict = {
  overlap: Array<{ id: number; start_date: string; end_date: string | null }>;
  weken: VerlofConflictWeek[];
  blokkeert: boolean;
};

export type Afwezigheidstype = {
  id: number;
  name: string;
  code: string;
  color: string | null;
  counts_as_leave: number;
  requires_approval: number;
  allow_half_days: number;
  visibility: 'iedereen' | 'management';
};

export type Afwezigheid = {
  id: number;
  user_id: number;
  absence_type_id: number;
  start_date: string;
  end_date: string | null;
  day_part: 'hele_dag' | 'ochtend' | 'middag';
  hours_override: number | null;
  status: 'aangevraagd' | 'goedgekeurd' | 'afgewezen' | 'geannuleerd';
  note: string | null;
  decision_note: string | null;
  requested_at: string;
};

export type Inzet = {
  id: number;
  user_id: number;
  allocation_type_id: number;
  title: string;
  project_id: number | null;
  external_project_name: string | null;
  start_date: string;
  end_date: string;
  allocation_mode: 'percentage' | 'dagen_per_week' | 'uren_per_week';
  allocation_value: number;
  status: 'gepland' | 'actief' | 'afgerond' | 'geannuleerd';
  note: string | null;
};

// --- planningimport ---------------------------------------------------------

export type ImportVeldSleutel =
  | 'nummer'
  | 'naam'
  | 'plaats'
  | 'plan'
  | 'opdrachtgever'
  | 'aantal'
  | 'showroom_start'
  | 'showroom_eind'
  | 'begeleider'
  | 'afspraken_per_woning'
  | 'doorlooptijd_weken'
  | 'opmerking';

export type Koppeling = Partial<Record<ImportVeldSleutel, number>>;

export type ImportVeld = {
  veld: ImportVeldSleutel;
  label: string;
  soort: 'tekst' | 'getal' | 'datum';
  verplicht: boolean;
  aliassen: string[];
  uitleg?: string;
};

export type ImportMelding = {
  veld: ImportVeldSleutel | null;
  tekst: string;
  ernst: 'fout' | 'let_op';
};

export type ImportRij = {
  bronregel: number;
  oordeel: 'nieuw' | 'bijwerken' | 'ongewijzigd' | 'fout';
  projectId: number | null;
  waarden: Partial<Record<ImportVeldSleutel, string | number>>;
  ruw: Record<string, string | number | boolean | null>;
  meldingen: ImportMelding[];
  wijzigingen: Array<{ kolom: string; van: unknown; naar: unknown }>;
};

export type ImportTelling = {
  totaal: number;
  nieuw: number;
  bijwerken: number;
  ongewijzigd: number;
  fout: number;
};

export type ImportVoorbeeld = ImportTelling & {
  batchId: number;
  tabblad: string | null;
  kopregel: number;
  koppen: Array<string | number | boolean | null>;
  koppeling: Koppeling;
  bestaandeBijwerken: boolean;
  rijen: ImportRij[];
};

export type ImportUitkomst = ImportTelling & { batchId: number; rijen: ImportRij[] };

export type ImportBatch = {
  id: number;
  bestandsnaam: string;
  bestandsgrootte: number;
  tabblad: string | null;
  status: 'voorbeeld' | 'doorgevoerd' | 'afgebroken';
  rijen_totaal: number;
  rijen_nieuw: number;
  rijen_bijgewerkt: number;
  rijen_overgeslagen: number;
  rijen_fout: number;
  created_at: string;
  committed_at: string | null;
  door: string | null;
  koppeling: string;
};

export type ImportBatchRij = {
  id: number;
  bronregel: number;
  oordeel: ImportRij['oordeel'];
  project: string | null;
  meldingen: string;
  doorgevoerd: number;
};

export type Projectfase = {
  id: number;
  project_id: number;
  phase_type_id: number;
  start_date: string;
  end_date: string;
  unit_count_override: number | null;
  note: string | null;
  is_capacity_load: number;
};

// --- signaleringen ----------------------------------------------------------

export type Ernst = 'info' | 'let_op' | 'urgent';

export type Melding = {
  id: number;
  rule_id: number | null;
  title: string;
  body: string | null;
  severity: Ernst;
  entity_key: string | null;
  record_id: number | null;
  status: 'open' | 'bevestigd' | 'uitgesteld' | 'opgelost';
  first_seen_at: string;
  last_seen_at: string;
  snoozed_until: string | null;
  regel: string | null;
  regeltype: string | null;
  bevestigd_door: string | null;
  payload: string;
};

export type MeldingTelling = { urgent: number; let_op: number; info: number };

export type Meldingregel = {
  id: number;
  name: string;
  type: string;
  params: string;
  severity: Ernst;
  active: number;
  last_checked_at: string | null;
  openstaand: number;
  gebouwd: boolean;
};

export type ControleUitkomst = {
  gedraaid: number;
  nieuw: number;
  bijgewerkt: number;
  opgelost: number;
  onbekendeTypes: string[];
  regels: Array<{
    regelId: number;
    naam: string;
    type: string;
    nieuw: number;
    bijgewerkt: number;
    opgelost: number;
    fout?: string;
  }>;
};

// --- pakketten en offertes --------------------------------------------------

export type Pakketregel = {
  id: number;
  package_id: number;
  product_id: number | null;
  naam: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price_cents: number;
  sales_price_cents: number | null;
  discount_bp: number;
  is_optional: number;
  category_label: string | null;
};

export type PakketMetPrijs = {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  categorie: string | null;
  pricing_mode: 'sum' | 'fixed' | 'sum_with_margin';
  fixed_price_cents: number | null;
  margin_bp: number;
  vat_mode: 'incl' | 'excl';
  active: number;
  estimated_install_hours: number | null;
  regels: Pakketregel[];
  prijs: {
    subtotaalCents: number;
    btwCents: number;
    totaalCents: number;
    kostprijsCents: number;
    margeCents: number;
    margeBp: number;
  };
};

export type Offerte = {
  id: number;
  number: string | null;
  status: 'concept' | 'verstuurd' | 'geaccepteerd' | 'afgewezen' | 'vervallen';
  organization_id: number | null;
  contact_id: number | null;
  project_id: number | null;
  opportunity_id: number | null;
  package_id: number | null;
  sent_at: string | null;
  valid_until: string | null;
  decided_at: string | null;
  subtotal_cents: number;
  discount_cents: number;
  vat_cents: number;
  total_cents: number;
  notes: string | null;
  internal_notes: string | null;
  klant: string | null;
  first_name: string | null;
  last_name: string | null;
  project: string | null;
  pakket: string | null;
  eigenaar: string | null;
};

export type Offerteregel = {
  id: number;
  quote_id: number;
  product_id: number | null;
  sku: string | null;
  categorie: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price_cents: number;
  discount_bp: number;
  vat_rate_bp: number;
  amount_cents: number;
  cost_price_cents: number;
  is_optional: number;
  is_selected: number;
  sort_order: number;
};

export type OfferteTotalen = {
  quoteId: number;
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  costCents: number;
  marginCents: number;
  marginBp: number;
  regels: number;
};

// --- e-mail en opvolging ----------------------------------------------------

export type Mailsjabloon = {
  id: number;
  name: string;
  code: string | null;
  subject: string;
  body_html: string;
  entity_scope: string | null;
  plaatshouders: string[];
};

export type OntvangerUitkomst = {
  ontvangers: Array<{ adres: string; naam?: string | null }>;
  geweigerd: string[];
};

export type OpgesteldBericht = {
  messageId: number;
  onderwerp: string;
  bodyHtml: string;
  bodyText: string;
  aan: Array<{ adres: string; naam?: string | null }>;
  cc: Array<{ adres: string; naam?: string | null }>;
  ontbrekend: string[];
  eml: string;
  bestandsnaam: string;
};

export type Mailbericht = {
  id: number;
  subject: string;
  status: string;
  direction: string;
  sent_at: string | null;
  created_at: string;
  door: string | null;
  to_json: string;
};

export type Activiteit = {
  id: number;
  type: string;
  subject: string;
  body: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_user_id: number | null;
  eigenaar: string | null;
  entiteit: string | null;
  record_id: number | null;
};

export type Werklijst = {
  teLaat: Activiteit[];
  vandaag: Activiteit[];
  komend: Activiteit[];
  zonderDatum: Activiteit[];
};

export type Bellijstregel = {
  call_list_id: number;
  entity_key: string;
  record_id: number;
  sort_order: number;
  done_at: string | null;
  note: string | null;
  titel: string;
  afgehandeld: boolean;
};


// --- AI-assistent -----------------------------------------------------------

export type AiStatus = {
  /** Zonder API-sleutel staat de hele assistent uit; dat is de standaard. */
  ingeschakeld: boolean;
  modellen: Array<{ id: string; prijsBekend: boolean }>;
  onderwerpen: string[];
  contextblokken: string[];
};

export type AiPreset = {
  id: number;
  naam: string;
  omschrijving: string | null;
  categorie: string | null;
  systeemPrompt: string;
  gebruikersSjabloon: string;
  model: string;
  maxTokens: number;
  context: string[];
  anonimiseren: boolean;
  uitvoerdoel: string | null;
  actief: boolean;
};

export type AiPresetInvoer = {
  naam: string;
  omschrijving: string;
  systeemPrompt: string;
  gebruikersSjabloon: string;
  model: string;
  maxTokens: number;
  context: string[];
  anonimiseren: boolean;
  actief: boolean;
};

export type AiOpdracht = {
  presetId: number;
  entity: string;
  recordId: number;
  aanvulling?: string;
};

export type AiVoorbeeld = {
  systeem: string;
  gebruiker: string;
  model: string;
  anonimiseren: boolean;
  vervangen: Array<{ soort: string; plaatshouder: string }>;
  ontbrekend: string[];
};

export type AiUitvoering = {
  runId: number;
  tekst: string;
  model: string;
  invoertokens: number;
  uitvoertokens: number;
  kostenCenten: number | null;
  duurMs: number;
  vervangen: number;
  onbekend: string[];
  ontbrekend: string[];
};

export type AiRun = {
  id: number;
  preset_naam: string | null;
  gebruiker_naam: string | null;
  model: string;
  prompt_summary: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_estimate_cents: number;
  duration_ms: number | null;
  status: string;
  error: string | null;
  entity_key: string | null;
  record_id: number | null;
  created_at: string;
};

export type AiMaand = {
  maand: string;
  aanroepen: number;
  invoer: number;
  uitvoer: number;
  centen: number;
  fouten: number;
};


// --- rapportages ------------------------------------------------------------

export type Rapportkolom = {
  sleutel: string;
  kop: string;
  type?: 'tekst' | 'getal' | 'bedrag' | 'datum' | 'procent';
};

export type RapportEntiteit = {
  sleutel: string;
  tabel: string;
  kolommen: Rapportkolom[];
};

export type SchemaTabel = {
  tabel: string;
  kolommen: Array<{ naam: string; type: string }>;
};

export type Bouwkolom = {
  veld: string;
  kop?: string;
  aggregatie?: 'count' | 'sum' | 'avg' | 'min' | 'max';
};

export type Bouwdefinitie = {
  entiteit: string;
  kolommen: Bouwkolom[];
  filter?: unknown;
  sortering?: Array<{ veld: string; richting?: 'asc' | 'desc' }>;
  groepering?: string[];
  limiet?: number;
  metGearchiveerde?: boolean;
};

/** Een verzoek is óf een bouwdefinitie, óf een stuk SQL. */
export type Rapportverzoek = (Bouwdefinitie | { sql: string }) & { limiet?: number };

export type Rapportuitkomst = {
  kolommen: Rapportkolom[];
  rijen: Array<Record<string, unknown>>;
};

export type Rapportmeta = {
  aantal: number;
  afgekapt: boolean;
  duurMs: number;
  maxRijen: number;
};

export type Exportbestand = {
  bestandsnaam: string;
  codering: 'base64' | 'tekst';
  inhoud: string;
};

export type OpgeslagenRapport = {
  id: number;
  naam: string;
  omschrijving: string | null;
  modus: 'builder' | 'sql';
  definitie: Bouwdefinitie | null;
  sql: string | null;
  gedeeld: boolean;
  eigenaar: string | null;
  eigenaarId: number | null;
};


// --- back-up ----------------------------------------------------------------

export type Backupbestand = {
  bestandsnaam: string;
  pad: string;
  bytes: number;
  gemaaktOp: string;
  soort: string;
};

export type Backuploop = {
  id: number;
  soort: string;
  bestandsnaam: string | null;
  pad: string | null;
  bytes: number;
  duur_ms: number | null;
  status: string;
  fout: string | null;
  opgeruimd: number;
  gebruiker: string | null;
  created_at: string;
};

export type Backupoverzicht = {
  backups: Backupbestand[];
  opDoelmap: Backupbestand[];
  stand: {
    laatsteGelukt: string | null;
    laatstePoging: string | null;
    laatsteMislukt: boolean;
    fout: string | null;
  };
  instellingen: {
    tijd: string;
    bewaarDagelijks: number;
    bewaarMaandelijks: number;
    doelmap: string | null;
  };
  map: string;
  logboek: Backuploop[];
};

export type Databaselocatie = {
  database: string;
  map: string;
  /** Uit `checkDatabasePath`: `ok`, of de reden waarom deze plek niet deugt. */
  oordeel: { ok: true } | { ok: false; reason: string; message: string };
};
