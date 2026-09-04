/**
 * Dubbelen zoeken en samenvoegen (hoofdstuk 6.1).
 *
 * Per gevonden paar staan de twee records naast elkaar. Per veld kiest de
 * gebruiker welke waarde wint; wat er niet gekozen wordt, blijft zoals het bij
 * het blijvende record stond. Daarna verhuizen contactpersonen, projecten,
 * kansen en offertes mee en wordt het andere record gearchiveerd.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldDefinition } from '@showroom/shared';
import { ApiFout, endpoints, type DubbelPaar } from '../../lib/api.ts';
import { useEntiteitSchema } from '../../lib/schema.ts';
import { VeldWaarde } from '../../components/velden/VeldWaarde.tsx';
import { Kaart, Skelet } from '../Dashboard.tsx';

type Rij = Record<string, unknown>;

const ENTITEITEN: Array<{ sleutel: string; label: string; route: string }> = [
  { sleutel: 'organizations', label: 'Klanten', route: '/klanten' },
  { sleutel: 'contacts', label: 'Contactpersonen', route: '/contactpersonen' },
];

const REDEN_LABEL: Record<string, string> = {
  kvk: 'zelfde KvK-nummer',
  email: 'zelfde e-mailadres',
  adres: 'zelfde adres',
  naam: 'gelijkende naam',
};

export function Dubbelen({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const [entiteit, setEntiteit] = useState('organizations');
  const [melding, setMelding] = useState<string | null>(null);
  const [actief, setActief] = useState<DubbelPaar | null>(null);

  const schema = useEntiteitSchema(entiteit);
  const dubbelen = useQuery({
    queryKey: ['dubbelen', entiteit],
    queryFn: () => endpoints.dubbelen(entiteit),
  });

  const recordPerId = useMemo(() => {
    const kaart = new Map<number, Rij>();
    for (const rij of dubbelen.data?.data.records ?? []) kaart.set(Number(rij.id), rij);
    return kaart;
  }, [dubbelen.data]);

  const route = ENTITEITEN.find((entry) => entry.sleutel === entiteit)?.route ?? '/klanten';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Mogelijke dubbelen</h1>

      <Kaart>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>
            Zoeken in{' '}
            <select
              className="focus-ring"
              value={entiteit}
              onChange={(event) => {
                setEntiteit(event.target.value);
                setMelding(null);
              }}
              style={selectStijl}
            >
              {ENTITEITEN.map((entry) => (
                <option key={entry.sleutel} value={entry.sleutel}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {dubbelen.data && (
            <span style={{ color: 'var(--inkt-zacht)', fontSize: 13 }}>
              {dubbelen.data.meta.onderzocht} records onderzocht,{' '}
              {dubbelen.data.meta.gevonden} mogelijk dubbel
            </span>
          )}
        </div>

        <p style={{ color: 'var(--inkt-zacht)', fontSize: 12, margin: '10px 0 0', lineHeight: 1.6 }}>
          Een gelijk KvK-nummer of e-mailadres is zeker; een gelijkende naam is een vermoeden.
          Beoordeel elk paar zelf voordat u samenvoegt — samenvoegen kan niet ongedaan worden
          gemaakt.
        </p>

        {melding && (
          <p role="status" style={{ color: 'var(--inkt-zacht)', fontSize: 13, margin: '10px 0 0' }}>
            {melding}
          </p>
        )}
      </Kaart>

      {(dubbelen.isLoading || schema.bezig) && (
        <Kaart>
          <Skelet hoogte={160} />
        </Kaart>
      )}

      {dubbelen.data?.data.paren.length === 0 && (
        <Kaart>
          <p style={{ color: 'var(--inkt-zacht)', margin: 0 }}>
            Geen mogelijke dubbelen gevonden. Mooi.
          </p>
        </Kaart>
      )}

      {dubbelen.data?.data.paren.map((paar) => {
        const a = recordPerId.get(paar.a);
        const b = recordPerId.get(paar.b);
        if (!a || !b) return null;
        return (
          <Kaart key={`${paar.a}-${paar.b}`} accent={paar.score >= 100 ? 'var(--ziekte)' : undefined}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>{paar.score >= 100 ? 'Zeker dubbel' : 'Mogelijk dubbel'}</strong>
              <span style={{ color: 'var(--inkt-zacht)', fontSize: 12 }}>
                {paar.redenen.map((reden) => REDEN_LABEL[reden] ?? reden).join(', ')} · score{' '}
                {paar.score}
              </span>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setActief(paar)}
                style={{ ...knopStijl, marginLeft: 'auto' }}
              >
                Samenvoegen…
              </button>
            </div>

            <p style={{ color: 'var(--inkt-zacht)', fontSize: 13, margin: '0 0 10px' }}>{paar.uitleg}</p>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              {[a, b].map((rij) => (
                <div
                  key={String(rij.id)}
                  style={{ border: '1px solid var(--rand)', borderRadius: 8, padding: 10 }}
                >
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => navigeer(`${route}/${String(rij.id)}`)}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      font: 'inherit',
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--belasting)',
                      cursor: 'pointer',
                    }}
                  >
                    {String(rij.name ?? rij.last_name ?? `#${String(rij.id)}`)} →
                  </button>
                  <Samenvatting velden={schema.velden} rij={rij} />
                </div>
              ))}
            </div>
          </Kaart>
        );
      })}

      {actief && (
        <SamenvoegDialoog
          entiteit={entiteit}
          paar={actief}
          velden={schema.velden}
          a={recordPerId.get(actief.a)!}
          b={recordPerId.get(actief.b)!}
          onSluit={() => setActief(null)}
          onKlaar={(tekst) => {
            setActief(null);
            setMelding(tekst);
          }}
        />
      )}
    </div>
  );
}

function Samenvatting({ velden, rij }: { velden: FieldDefinition[]; rij: Rij }): JSX.Element {
  const tonen = velden
    .filter((veld) => veld.storage === 'column' && veld.visibleInList && !veld.isLocked)
    .slice(0, 5);

  return (
    <dl style={{ margin: '6px 0 0', display: 'grid', gap: 2, fontSize: 12 }}>
      {tonen.map((veld) => (
        <div key={veld.fieldKey} style={{ display: 'flex', gap: 8 }}>
          <dt style={{ color: 'var(--inkt-stil)', minWidth: 110 }}>{veld.label}</dt>
          <dd style={{ margin: 0 }}>
            <VeldWaarde veld={veld} waarde={rij[veld.fieldKey]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SamenvoegDialoog({
  entiteit,
  paar,
  velden,
  a,
  b,
  onSluit,
  onKlaar,
}: {
  entiteit: string;
  paar: DubbelPaar;
  velden: FieldDefinition[];
  a: Rij;
  b: Rij;
  onSluit: () => void;
  onKlaar: (melding: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [winnaarId, setWinnaarId] = useState(paar.a);
  const [keuzes, setKeuzes] = useState<Record<string, number>>({});
  const [fout, setFout] = useState<string | null>(null);

  const winnaar = winnaarId === paar.a ? a : b;
  const verliezer = winnaarId === paar.a ? b : a;
  const verliezerId = winnaarId === paar.a ? paar.b : paar.a;

  // Alleen velden waar de twee records van elkaar verschillen; de rest hoeft
  // niemand te beoordelen.
  const verschillen = useMemo(
    () =>
      velden.filter(
        (veld) =>
          veld.storage === 'column' &&
          veld.editable &&
          String(a[veld.fieldKey] ?? '') !== String(b[veld.fieldKey] ?? ''),
      ),
    [velden, a, b],
  );

  const samenvoegen = useMutation({
    mutationFn: () => {
      const waarden: Record<string, unknown> = {};
      for (const veld of verschillen) {
        const gekozenId = keuzes[veld.fieldKey] ?? winnaarId;
        if (gekozenId === winnaarId) continue; // die waarde staat er al
        waarden[veld.fieldKey] = verliezer[veld.fieldKey] ?? null;
      }
      return endpoints.samenvoegen(entiteit, winnaarId, verliezerId, waarden);
    },
    onSuccess: (antwoord) => {
      const verplaatst = antwoord.data.verplaatst.reduce((totaal, entry) => totaal + entry.rijen, 0);
      void queryClient.invalidateQueries({ queryKey: ['dubbelen'] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', entiteit] });
      onKlaar(
        verplaatst > 0
          ? `Samengevoegd. ${verplaatst} gekoppeld record(s) verhuisd naar het blijvende record.`
          : 'Samengevoegd.',
      );
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Samenvoegen lukte niet.'),
  });

  const naam = (rij: Rij): string => String(rij.name ?? rij.last_name ?? `#${String(rij.id)}`);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Records samenvoegen"
      onClick={onSluit}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / 0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          padding: 20,
          width: 'min(720px, 94vw)',
          maxHeight: '84vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Samenvoegen</h2>

        <fieldset style={{ border: '1px solid var(--rand)', borderRadius: 8, padding: 12, margin: '0 0 14px' }}>
          <legend style={{ fontSize: 12, color: 'var(--inkt-zacht)', padding: '0 6px' }}>
            Welk record blijft bestaan?
          </legend>
          {[a, b].map((rij) => (
            <label key={String(rij.id)} style={{ display: 'block', fontSize: 13, padding: '3px 0' }}>
              <input
                type="radio"
                name="winnaar"
                checked={winnaarId === Number(rij.id)}
                onChange={() => {
                  setWinnaarId(Number(rij.id));
                  setKeuzes({});
                }}
              />{' '}
              {naam(rij)}{' '}
              <span style={{ color: 'var(--inkt-stil)' }}>#{String(rij.id)}</span>
            </label>
          ))}
        </fieldset>

        {verschillen.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)' }}>
            De records verschillen niet in de bewerkbare velden. Samenvoegen verplaatst alleen
            de gekoppelde records.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 8px' }}>
              Kies per veld welke waarde wint. Het blijvende record staat links voorgeselecteerd.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                  <th scope="col" style={{ padding: '4px 6px' }}>Veld</th>
                  <th scope="col" style={{ padding: '4px 6px' }}>{naam(winnaar)} (blijft)</th>
                  <th scope="col" style={{ padding: '4px 6px' }}>{naam(verliezer)} (vervalt)</th>
                </tr>
              </thead>
              <tbody>
                {verschillen.map((veld) => {
                  const gekozenId = keuzes[veld.fieldKey] ?? winnaarId;
                  return (
                    <tr key={veld.fieldKey} style={{ borderBottom: '1px solid var(--rand)' }}>
                      <th scope="row" style={{ textAlign: 'left', padding: '5px 6px', fontWeight: 500 }}>
                        {veld.label}
                      </th>
                      {[winnaar, verliezer].map((rij) => (
                        <td key={String(rij.id)} style={{ padding: '5px 6px' }}>
                          <label style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            <input
                              type="radio"
                              name={`veld-${veld.fieldKey}`}
                              checked={gekozenId === Number(rij.id)}
                              onChange={() =>
                                setKeuzes((huidig) => ({ ...huidig, [veld.fieldKey]: Number(rij.id) }))
                              }
                            />
                            <VeldWaarde veld={veld} waarde={rij[veld.fieldKey]} />
                          </label>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 12 }}>
            {fout}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="focus-ring" onClick={onSluit} style={knopStijl}>
            Annuleren
          </button>
          <button
            type="button"
            className="focus-ring"
            disabled={samenvoegen.isPending}
            onClick={() => samenvoegen.mutate()}
            style={{ ...knopStijl, background: 'var(--belasting)', color: '#fff', border: 0 }}
          >
            {samenvoegen.isPending ? 'Bezig…' : 'Samenvoegen'}
          </button>
        </div>
      </div>
    </div>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 12px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 12,
};

const selectStijl: React.CSSProperties = {
  background: 'var(--oppervlak)',
  border: '1px solid var(--rand)',
  borderRadius: 4,
  color: 'var(--inkt)',
  fontSize: 12,
  padding: '4px 6px',
};
