/**
 * Detailpagina voor elke entiteit, ingedeeld volgens de layout-secties
 * (hoofdstuk 3.5 en 9).
 *
 * Links de velden in hun secties, rechts ruimte voor de tijdlijn. De velden en
 * hun volgorde komen uit het register, dus wat een beheerder hier sleept,
 * staat er de volgende keer zo.
 */
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldDefinition } from '@showroom/shared';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { bouwPayload, useEntiteitSchema, waardeVan } from '../../lib/schema.ts';
import { VeldInvoer } from '../../components/velden/VeldInvoer.tsx';
import { VeldWaarde } from '../../components/velden/VeldWaarde.tsx';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Tijdlijn } from './Tijdlijn.tsx';
import { AvgPaneel } from './AvgPaneel.tsx';

type Rij = Record<string, unknown>;
type VeldFout = { veld: string; label: string; melding: string };

export function GeneriekDetail({
  entiteit,
  id,
  titel,
  onTerug,
  acties,
  extra,
}: {
  entiteit: string;
  id: number;
  titel: string;
  onTerug: () => void;
  /** Knoppen die bij deze entiteit horen, naast Bewerken in de kopbalk. */
  acties?: ReactNode;
  /** Panelen onder de veldsecties, bijvoorbeeld de regels van een kans. */
  extra?: ReactNode;
}): JSX.Element {
  const schema = useEntiteitSchema(entiteit);
  const queryClient = useQueryClient();
  const [bewerken, setBewerken] = useState(false);
  const [concept, setConcept] = useState<Record<string, unknown>>({});
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<string | null>(null);

  const record = useQuery({
    queryKey: ['record', entiteit, id],
    queryFn: () => endpoints.record<Rij>(entiteit, id),
  });

  const rij = record.data?.data;

  // Bij het openen van de bewerkmodus vullen we het concept met wat er staat.
  useEffect(() => {
    if (!bewerken || !rij) return;
    const start: Record<string, unknown> = {};
    for (const veld of schema.velden) start[veld.fieldKey] = waardeVan(rij, veld);
    setConcept(start);
    setFouten({});
  }, [bewerken, rij, schema.velden]);

  const opslaan = useMutation({
    mutationFn: () => endpoints.bewaar<Rij>(entiteit, id, bouwPayload(schema.velden, concept)),
    onSuccess: () => {
      setBewerken(false);
      setMelding('Opgeslagen.');
      void queryClient.invalidateQueries({ queryKey: ['record', entiteit, id] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', entiteit] });
    },
    onError: (error: unknown) => {
      // De kern meldt alle veldfouten tegelijk; die zetten we bij het veld zelf.
      if (error instanceof ApiFout) {
        const details = (error as ApiFout & { details?: VeldFout[] }).details;
        if (Array.isArray(details)) {
          setFouten(Object.fromEntries(details.map((fout) => [fout.veld, fout.melding])));
          return;
        }
        setMelding(error.message);
      }
    },
  });

  const perSectie = useMemo(() => {
    const kaart = new Map<number | 'geen', FieldDefinition[]>();
    for (const veld of schema.velden) {
      if (!veld.visibleInDetail) continue;
      const sleutel = veld.sectionId ?? ('geen' as const);
      kaart.set(sleutel, [...(kaart.get(sleutel) ?? []), veld]);
    }
    return kaart;
  }, [schema.velden]);

  if (schema.bezig || record.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={280} />
      </Kaart>
    );
  }

  if (record.error || !rij) {
    return (
      <Kaart>
        <p style={{ color: 'var(--ziekte)' }}>
          {record.error instanceof Error ? record.error.message : 'Dit record bestaat niet.'}
        </p>
        <button type="button" onClick={onTerug} style={knopStijl}>
          Terug naar de lijst
        </button>
      </Kaart>
    );
  }

  const kopveld = schema.velden.find((veld) => veld.isLocked) ?? schema.velden[0];
  const kop = kopveld ? String(waardeVan(rij, kopveld) ?? titel) : titel;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="focus-ring" onClick={onTerug} style={knopStijl}>
          ← {titel}
        </button>
        <h1 style={{ fontSize: 18, margin: 0 }}>{kop}</h1>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!bewerken && acties}
          {bewerken ? (
            <>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setBewerken(false)}
                style={knopStijl}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="focus-ring"
                onClick={() => opslaan.mutate()}
                disabled={opslaan.isPending}
                style={{ ...knopStijl, background: 'var(--belasting)', color: '#fff', border: 0 }}
              >
                {opslaan.isPending ? 'Bezig...' : 'Opslaan'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="focus-ring"
              onClick={() => setBewerken(true)}
              style={knopStijl}
            >
              Bewerken
            </button>
          )}
        </div>
      </header>

      {melding && (
        <p role="status" style={{ margin: 0, color: 'var(--inkt-zacht)', fontSize: 13 }}>
          {melding}
        </p>
      )}

      {Object.keys(fouten).length > 0 && (
        <p role="alert" style={{ margin: 0, color: 'var(--ziekte)', fontSize: 13 }}>
          Er zijn {Object.keys(fouten).length} veld(en) die nog niet kloppen. Kijk hieronder.
        </p>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {schema.secties.map((sectie) => {
            const velden = perSectie.get(sectie.id) ?? [];
            if (velden.length === 0) return null;
            return (
              <Kaart key={sectie.id}>
                <h2 style={{ fontSize: 14, margin: '0 0 12px' }}>{sectie.name}</h2>
                <Velden
                  velden={velden}
                  kolommen={sectie.columns}
                  rij={rij}
                  bewerken={bewerken}
                  concept={concept}
                  fouten={fouten}
                  schema={schema}
                  onWijzig={(sleutel, waarde) =>
                    setConcept((huidig) => ({ ...huidig, [sleutel]: waarde }))
                  }
                />
              </Kaart>
            );
          })}

          {(perSectie.get('geen') ?? []).length > 0 && (
            <Kaart>
              <h2 style={{ fontSize: 14, margin: '0 0 12px' }}>Overig</h2>
              <Velden
                velden={perSectie.get('geen') ?? []}
                kolommen={2}
                rij={rij}
                bewerken={bewerken}
                concept={concept}
                fouten={fouten}
                schema={schema}
                onWijzig={(sleutel, waarde) =>
                  setConcept((huidig) => ({ ...huidig, [sleutel]: waarde }))
                }
              />
            </Kaart>
          )}

          {extra}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Kaart>
            <Tijdlijn entiteit={entiteit} id={id} />
          </Kaart>
          {entiteit === 'contacts' && <AvgPaneel contactId={id} />}
        </div>
      </div>
    </div>
  );
}

function Velden({
  velden,
  kolommen,
  rij,
  bewerken,
  concept,
  fouten,
  schema,
  onWijzig,
}: {
  velden: FieldDefinition[];
  kolommen: number;
  rij: Rij;
  bewerken: boolean;
  concept: Record<string, unknown>;
  fouten: Record<string, string>;
  schema: ReturnType<typeof useEntiteitSchema>;
  onWijzig: (sleutel: string, waarde: unknown) => void;
}): JSX.Element {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(1, kolommen)}, minmax(0, 1fr))`,
        gap: 12,
        margin: 0,
      }}
    >
      {velden.map((veld) =>
        bewerken && veld.editable && veld.type !== 'formula' ? (
          <div key={veld.fieldKey}>
            <VeldInvoer
              veld={veld}
              waarde={concept[veld.fieldKey]}
              keuzes={schema.keuzesVoor(veld)}
              fout={fouten[veld.fieldKey] ?? null}
              onWijzig={(waarde) => onWijzig(veld.fieldKey, waarde)}
            />
          </div>
        ) : (
          <div key={veld.fieldKey}>
            <dt style={{ fontSize: 12, color: 'var(--inkt-zacht)', marginBottom: 3 }}>
              {veld.label}
            </dt>
            <dd style={{ margin: 0, fontSize: 13 }}>
              <VeldWaarde veld={veld} waarde={waardeVan(rij, veld)} opzoeker={schema.opzoeker} />
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 12px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 13,
};
