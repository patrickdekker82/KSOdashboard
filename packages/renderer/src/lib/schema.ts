/**
 * Haalt alles op wat nodig is om een entiteit generiek te tonen: de velden, de
 * secties, de keuzes per keuzeveld en de labels achter verwijzingen.
 *
 * Alles komt uit het veldenregister, dus een veld dat een beheerder toevoegt
 * verschijnt hier zonder dat er code bij hoeft.
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { FieldDefinition } from '@showroom/shared';
import { endpoints, type Sectie } from './api.ts';
import type { Keuze } from '../components/velden/VeldInvoer.tsx';
import type { Opzoeker } from '../components/velden/VeldWaarde.tsx';

/** Kolom in een verwijsentiteit die als label dient. */
const LABELKOLOM: Record<string, string> = {
  users: 'name',
  organizations: 'name',
  contacts: 'last_name',
  projects: 'name',
  opportunities: 'name',
  'pipeline-stages': 'name',
  'absence-types': 'name',
  'allocation-types': 'name',
  disciplines: 'name',
  products: 'name',
  packages: 'name',
};

export type EntiteitSchema = {
  velden: FieldDefinition[];
  secties: Sectie[];
  /** Velden die standaard in de lijst staan. */
  lijstVelden: FieldDefinition[];
  keuzesVoor: (veld: FieldDefinition) => Keuze[];
  opzoeker: Opzoeker;
  bezig: boolean;
  fout: Error | null;
  herlaad: () => void;
};

type Rij = Record<string, unknown>;

export function useEntiteitSchema(entiteit: string): EntiteitSchema {
  const schema = useQuery({
    queryKey: ['velden', entiteit],
    queryFn: () => endpoints.velden(entiteit),
  });

  const velden = useMemo(() => schema.data?.data.velden ?? [], [schema.data]);
  const secties = useMemo(() => schema.data?.data.secties ?? [], [schema.data]);

  // Welke keuzelijsten en verwijsentiteiten hebben we nodig? Alleen die.
  const keuzelijstIds = useMemo(
    () => [...new Set(velden.filter((veld) => veld.picklistId).map((veld) => veld.picklistId!))],
    [velden],
  );
  const verwijsEntiteiten = useMemo(
    () => [
      ...new Set(
        velden
          .filter((veld) => veld.type === 'relation' || veld.type === 'user')
          .map((veld) => (veld.type === 'user' ? 'users' : (veld.relationEntity ?? 'users'))),
      ),
    ],
    [velden],
  );

  const keuzelijsten = useQueries({
    queries: keuzelijstIds.map((id) => ({
      queryKey: ['keuzelijst', id],
      queryFn: () => endpoints.keuzelijstItems(id),
      staleTime: 5 * 60_000,
    })),
  });

  const verwijzingen = useQueries({
    queries: verwijsEntiteiten.map((naam) => ({
      queryKey: ['verwijzing', naam],
      queryFn: () => endpoints.lijst<Rij>(naam, '?pageSize=500'),
      staleTime: 5 * 60_000,
    })),
  });

  const keuzelijstPerId = useMemo(() => {
    const kaart = new Map<number, Keuze[]>();
    keuzelijstIds.forEach((id, index) => {
      const rijen = keuzelijsten[index]?.data?.data ?? [];
      kaart.set(
        id,
        rijen.map((rij) => ({ value: rij.value, label: rij.label, color: rij.color })),
      );
    });
    return kaart;
  }, [keuzelijstIds, keuzelijsten]);

  const verwijzingPerEntiteit = useMemo(() => {
    const kaart = new Map<string, Map<number, string>>();
    verwijsEntiteiten.forEach((naam, index) => {
      const rijen = verwijzingen[index]?.data?.data ?? [];
      const kolom = LABELKOLOM[naam] ?? 'name';
      kaart.set(
        naam,
        new Map(
          rijen.map((rij) => [
            Number(rij.id),
            String(rij[kolom] ?? rij.name ?? rij.initials ?? `#${String(rij.id)}`),
          ]),
        ),
      );
    });
    return kaart;
  }, [verwijsEntiteiten, verwijzingen]);

  const keuzesVoor = useMemo(
    () =>
      (veld: FieldDefinition): Keuze[] => {
        if (veld.type === 'relation' || veld.type === 'user') {
          const naam = veld.type === 'user' ? 'users' : (veld.relationEntity ?? 'users');
          return [...(verwijzingPerEntiteit.get(naam)?.entries() ?? [])].map(([id, label]) => ({
            value: String(id),
            label,
          }));
        }
        if (veld.optionsSource === 'picklist' && veld.picklistId) {
          return keuzelijstPerId.get(veld.picklistId) ?? [];
        }
        return (veld.validation.options ?? []).map((optie) => ({
          value: optie.value,
          label: optie.label,
          color: optie.color,
        }));
      },
    [keuzelijstPerId, verwijzingPerEntiteit],
  );

  const opzoeker = useMemo<Opzoeker>(
    () => ({
      label: (entiteitNaam, id) =>
        verwijzingPerEntiteit.get(entiteitNaam ?? 'users')?.get(id) ?? `#${id}`,
      optie: (veld, waarde) => {
        const gevonden = keuzesVoor(veld).find((keuze) => keuze.value === waarde);
        return { label: gevonden?.label ?? waarde, color: gevonden?.color };
      },
    }),
    [keuzesVoor, verwijzingPerEntiteit],
  );

  return {
    velden,
    secties,
    lijstVelden: velden.filter((veld) => veld.visibleInList),
    keuzesVoor,
    opzoeker,
    bezig: schema.isLoading,
    fout: (schema.error as Error) ?? null,
    herlaad: () => void schema.refetch(),
  };
}

/** Leest de waarde van een veld uit een record, systeem- of maatwerkveld. */
export function waardeVan(rij: Rij, veld: FieldDefinition): unknown {
  if (veld.storage === 'column') return rij[veld.fieldKey];
  const maatwerk = (rij.custom_fields ?? {}) as Record<string, unknown>;
  return maatwerk[veld.fieldKey];
}

/** Bouwt de body voor een opslagverzoek uit gewijzigde veldwaarden. */
export function bouwPayload(
  velden: readonly FieldDefinition[],
  waarden: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const maatwerk: Record<string, unknown> = {};
  let heeftMaatwerk = false;

  for (const veld of velden) {
    if (!(veld.fieldKey in waarden)) continue;
    if (veld.type === 'formula') continue; // wordt berekend, niet opgeslagen
    if (veld.storage === 'column') body[veld.fieldKey] = waarden[veld.fieldKey];
    else {
      maatwerk[veld.fieldKey] = waarden[veld.fieldKey];
      heeftMaatwerk = true;
    }
  }

  if (heeftMaatwerk) body.custom_fields = maatwerk;
  return body;
}
