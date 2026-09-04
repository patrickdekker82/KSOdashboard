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

  keuzelijsten: () => api.get<Lijst<{ id: number; key: string; name: string }>>('/picklists'),
  keuzelijstItems: (picklistId: number) =>
    api.get<Lijst<{ id: number; value: string; label: string; color: string | null }>>(
      `/picklist-items?filter=${btoa(JSON.stringify({ field: 'picklist_id', operator: 'eq', value: picklistId }))}`,
    ),
  gebruikers: () =>
    api.get<Lijst<{ id: number; name: string; initials: string }>>('/users?pageSize=200'),
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
