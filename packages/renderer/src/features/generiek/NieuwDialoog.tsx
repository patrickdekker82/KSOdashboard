/**
 * Een record aanmaken (hoofdstuk 3.6).
 *
 * De lijst kon tot nu toe alleen tonen wat er al was: filteren, sorteren,
 * kolommen kiezen — maar niets toevoegen. De kern kon het allang (een POST
 * zonder id), er zat alleen geen knop aan.
 *
 * De dialoog leest dezelfde velddefinities als de detailpagina, dus een veld
 * dat een beheerder toevoegt staat hier vanzelf in. Verplichte velden staan
 * bovenaan: dat is wat je moet invullen om te kunnen opslaan.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FieldDefinition } from '@showroom/shared';
import { ApiFout, endpoints, veldFouten } from '../../lib/api.ts';
import { bouwPayload, useEntiteitSchema } from '../../lib/schema.ts';
import { VeldInvoer } from '../../components/velden/VeldInvoer.tsx';
import { Dialoog, dialoogKnop } from '../kansen/Dialoog.tsx';

type Rij = Record<string, unknown>;

/** Velden die je bij het aanmaken zelf invult. */
function invulbaar(velden: readonly FieldDefinition[]): FieldDefinition[] {
  return velden
    .filter(
      (veld) =>
        veld.editable &&
        veld.type !== 'formula' &&
        veld.visibleInDetail &&
        // Deze zet de kern zelf; ze invullen zou meer verwarren dan helpen.
        !['created_at', 'updated_at', 'archived_at'].includes(veld.fieldKey),
    )
    .sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
}

export function NieuwDialoog({
  entiteit,
  titel,
  onSluit,
  onAangemaakt,
}: {
  entiteit: string;
  /** Enkelvoud, voor in de kop: "Nieuwe klant". */
  titel: string;
  onSluit: () => void;
  onAangemaakt: (id: number) => void;
}): JSX.Element {
  const schema = useEntiteitSchema(entiteit);
  const queryClient = useQueryClient();
  const [concept, setConcept] = useState<Record<string, unknown>>({});
  const [fout, setFout] = useState<string | null>(null);
  const [veldfouten, setVeldfouten] = useState<Record<string, string>>({});

  const velden = useMemo(() => invulbaar(schema.velden), [schema.velden]);

  const aanmaken = useMutation({
    mutationFn: () => endpoints.bewaar<Rij>(entiteit, null, bouwPayload(schema.velden, concept)),
    onSuccess: (antwoord) => {
      void queryClient.invalidateQueries({ queryKey: ['lijst', entiteit] });
      const nieuw = antwoord.data as Rij | undefined;
      const id = Number(nieuw?.id);
      onAangemaakt(Number.isInteger(id) && id > 0 ? id : 0);
    },
    onError: (error: unknown) => {
      // De kern meldt alle veldfouten tegelijk; die horen bij het veld te
      // staan en niet als één regel bovenaan.
      const perVeld = veldFouten(error);
      setVeldfouten(Object.fromEntries(perVeld.map((fout) => [fout.veld, fout.melding])));
      if (perVeld.length > 0) setFout('Niet alles is goed ingevuld.');
      else setFout(error instanceof ApiFout ? error.message : 'Aanmaken lukte niet.');
    },
  });

  const verplichtOntbreekt = velden.some(
    (veld) =>
      veld.required &&
      (concept[veld.fieldKey] === undefined ||
        concept[veld.fieldKey] === null ||
        concept[veld.fieldKey] === ''),
  );

  return (
    <Dialoog titel={`Nieuwe ${titel.toLowerCase()}`} onSluit={onSluit}>
      {schema.bezig ? (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)' }}>Velden ophalen…</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {velden.map((veld) => (
              <VeldInvoer
                key={veld.fieldKey}
                veld={veld}
                waarde={concept[veld.fieldKey]}
                keuzes={schema.keuzesVoor(veld)}
                fout={veldfouten[veld.fieldKey] ?? null}
                onWijzig={(waarde) =>
                  setConcept((huidig) => ({ ...huidig, [veld.fieldKey]: waarde }))
                }
              />
            ))}
          </div>

          {fout !== null && (
            <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginTop: 12 }}>
              {fout}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="focus-ring" onClick={onSluit} style={dialoogKnop}>
              Annuleren
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={aanmaken.isPending || verplichtOntbreekt}
              onClick={() => aanmaken.mutate()}
              style={{
                ...dialoogKnop,
                background: 'var(--belasting)',
                color: '#fff',
                borderColor: 'transparent',
                opacity: verplichtOntbreekt ? 0.5 : 1,
              }}
            >
              {aanmaken.isPending ? 'Bezig…' : 'Aanmaken'}
            </button>
          </div>
        </>
      )}
    </Dialoog>
  );
}
