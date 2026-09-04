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
