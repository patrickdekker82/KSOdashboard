/**
 * Rapportages (hoofdstuk 11).
 *
 * Drie tabbladen: de bouwer waar iedereen mee uit de voeten kan, de opgeslagen
 * rapportages, en de SQL-modus voor beheerders die precies weten wat ze willen
 * vragen. Alle drie eindigen op hetzelfde resultaat en dezelfde exportknoppen —
 * daar hoort de gebruiker niet te merken hoe de vraag gesteld is.
 *
 * Het trechterrapport uit fase 4 blijft bestaan als eigen scherm; dat is een
 * vaste rapportage met een grafiek en geen bouwer.
 */
import { useMemo, useState, type JSX } from 'react';
import { formatDate } from '@showroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiFout,
  endpoints,
  type Bouwdefinitie,
  type Bouwkolom,
  type Exportbestand,
  type OpgeslagenRapport,
  type RapportEntiteit,
  type Rapportmeta,
  type Rapportuitkomst,
  type Rapportverzoek,
} from '../../lib/api.ts';
import type { Gebruiker } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';
import { dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';
import { Pijplijnrapport } from '../kansen/Pijplijnrapport.tsx';

type Tab = 'bouwer' | 'opgeslagen' | 'sql' | 'trechter';

const AGGREGATIES: Array<{ waarde: Bouwkolom['aggregatie']; label: string }> = [
  { waarde: undefined, label: 'geen' },
  { waarde: 'count', label: 'aantal' },
  { waarde: 'sum', label: 'som' },
  { waarde: 'avg', label: 'gemiddelde' },
  { waarde: 'min', label: 'laagste' },
  { waarde: 'max', label: 'hoogste' },
];

export function Rapportages({ ik }: { ik: Gebruiker }): JSX.Element {
  const [tab, setTab] = useState<Tab>('bouwer');
  const beheerder = ik.role === 'admin';

  const tabs: Array<[Tab, string]> = [
    ['bouwer', 'Bouwer'],
    ['opgeslagen', 'Opgeslagen'],
    ...(beheerder ? ([['sql', 'SQL']] as Array<[Tab, string]>) : []),
    ['trechter', 'Trechter'],
  ];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Rapportages</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map(([sleutel, label]) => (
          <button
            key={sleutel}
            type="button"
            className="focus-ring"
            aria-current={tab === sleutel ? 'page' : undefined}
            onClick={() => setTab(sleutel)}
            style={{
              ...dialoogKnop,
              fontWeight: tab === sleutel ? 700 : 400,
              borderColor: tab === sleutel ? 'var(--belasting)' : 'var(--rand)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bouwer' && <Bouwer />}
      {tab === 'opgeslagen' && <Opgeslagen ik={ik} onOpenen={() => setTab('bouwer')} />}
      {tab === 'sql' && <SqlModus />}
      {tab === 'trechter' && <Pijplijnrapport />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// De bouwer
// ---------------------------------------------------------------------------

function Bouwer(): JSX.Element {
  const [entiteit, setEntiteit] = useState('organizations');
  const [gekozen, setGekozen] = useState<Bouwkolom[]>([]);
  const [groepering, setGroepering] = useState<string[]>([]);
  const [sorteerVeld, setSorteerVeld] = useState('');
  const [sorteerRichting, setSorteerRichting] = useState<'asc' | 'desc'>('asc');
  const [metGearchiveerde, setMetGearchiveerde] = useState(false);
  const [titel, setTitel] = useState('Rapportage');

  const entiteiten = useQuery({
    queryKey: ['rapport-entiteiten'],
    queryFn: () => endpoints.rapportEntiteiten(),
  });

  const huidige: RapportEntiteit | undefined = (entiteiten.data?.data ?? []).find(
    (kandidaat) => kandidaat.sleutel === entiteit,
  );

  const definitie = useMemo<Bouwdefinitie>(
    () => ({
      entiteit,
      kolommen: gekozen,
      groepering: groepering.length > 0 ? groepering : undefined,
      sortering: sorteerVeld === '' ? undefined : [{ veld: sorteerVeld, richting: sorteerRichting }],
      metGearchiveerde,
    }),
    [entiteit, gekozen, groepering, sorteerVeld, sorteerRichting, metGearchiveerde],
  );

  const wisselKolom = (veld: string): void => {
    setGekozen((huidig) =>
      huidig.some((kolom) => kolom.veld === veld)
        ? huidig.filter((kolom) => kolom.veld !== veld)
        : [...huidig, { veld }],
    );
  };

  const zetAggregatie = (veld: string, aggregatie: Bouwkolom['aggregatie']): void => {
    setGekozen((huidig) =>
      huidig.map((kolom) => (kolom.veld === veld ? { ...kolom, aggregatie } : kolom)),
    );
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Kaart>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <label style={{ fontSize: 12 }}>
            Waarover gaat de rapportage?
            <select
              className="focus-ring"
              value={entiteit}
              onChange={(event) => {
                setEntiteit(event.target.value);
                setGekozen([]);
                setGroepering([]);
                setSorteerVeld('');
              }}
              style={{ ...dialoogSelect, marginTop: 3 }}
            >
              {(entiteiten.data?.data ?? []).map((kandidaat) => (
                <option key={kandidaat.sleutel} value={kandidaat.sleutel}>
                  {kandidaat.sleutel}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12 }}>
            Titel boven de export
            <input
              className="focus-ring"
              value={titel}
              onChange={(event) => setTitel(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend style={{ fontSize: 12, padding: 0 }}>Kolommen</legend>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 6,
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {(huidige?.kolommen ?? []).map((kolom) => {
              const aan = gekozen.some((entry) => entry.veld === kolom.sleutel);
              return (
                <label
                  key={kolom.sleutel}
                  style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <input
                    type="checkbox"
                    className="focus-ring"
                    checked={aan}
                    onChange={() => wisselKolom(kolom.sleutel)}
                  />
                  {kolom.kop}
                </label>
              );
            })}
          </div>
        </fieldset>

        {gekozen.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Gekozen kolommen</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {gekozen.map((kolom) => (
                <div
                  key={kolom.veld}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}
                >
                  <span style={{ minWidth: 160 }}>{kolom.veld}</span>
                  <select
                    className="focus-ring"
                    value={kolom.aggregatie ?? ''}
                    onChange={(event) =>
                      zetAggregatie(
                        kolom.veld,
                        (event.target.value === ''
                          ? undefined
                          : event.target.value) as Bouwkolom['aggregatie'],
                      )
                    }
                    style={{ ...invoerStijl, width: 140 }}
                  >
                    {AGGREGATIES.map((optie) => (
                      <option key={optie.label} value={optie.waarde ?? ''}>
                        {optie.label}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      className="focus-ring"
                      checked={groepering.includes(kolom.veld)}
                      onChange={(event) =>
                        setGroepering((huidig) =>
                          event.target.checked
                            ? [...huidig, kolom.veld]
                            : huidig.filter((veld) => veld !== kolom.veld),
                        )
                      }
                    />
                    groeperen
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            Sorteren op
            <select
              className="focus-ring"
              value={sorteerVeld}
              onChange={(event) => setSorteerVeld(event.target.value)}
              style={{ ...invoerStijl, width: 180 }}
            >
              <option value="">— niet —</option>
              {(huidige?.kolommen ?? []).map((kolom) => (
                <option key={kolom.sleutel} value={kolom.sleutel}>
                  {kolom.kop}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              className="focus-ring"
              value={sorteerRichting}
              onChange={(event) => setSorteerRichting(event.target.value as 'asc' | 'desc')}
              style={{ ...invoerStijl, width: 120 }}
            >
              <option value="asc">oplopend</option>
              <option value="desc">aflopend</option>
            </select>
          </label>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <input
              type="checkbox"
              className="focus-ring"
              checked={metGearchiveerde}
              onChange={(event) => setMetGearchiveerde(event.target.checked)}
            />
            gearchiveerde records meenemen
          </label>
        </div>
      </Kaart>

      <Resultaat verzoek={definitie} titel={titel} bewaarbaar={{ definitie }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// De SQL-modus
// ---------------------------------------------------------------------------

function SqlModus(): JSX.Element {
  const [sql, setSql] = useState('SELECT name, city FROM organizations ORDER BY name');
  const [titel, setTitel] = useState('SQL-rapportage');

  const schema = useQuery({ queryKey: ['rapport-schema'], queryFn: () => endpoints.rapportSchema() });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Kaart accent="var(--ziekte)">
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Alleen lezen</h2>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.5 }}>
          Deze modus draait op een verbinding die alleen kan lezen. Alles wat gegevens zou wijzigen
          wordt geweigerd — door SQLite zelf, niet alleen door een controle op de tekst. Eén query
          tegelijk, en maximaal een paar duizend rijen.
        </p>
      </Kaart>

      <Kaart>
        <label style={{ display: 'block', fontSize: 12 }}>
          Query
          <textarea
            className="focus-ring"
            rows={8}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            style={{
              ...invoerStijl,
              width: '100%',
              marginTop: 3,
              resize: 'vertical',
              fontFamily: 'monospace',
            }}
          />
        </label>

        <label style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
          Titel boven de export
          <input
            className="focus-ring"
            value={titel}
            onChange={(event) => setTitel(event.target.value)}
            style={{ ...invoerStijl, width: 280, marginTop: 3 }}
          />
        </label>

        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, color: 'var(--inkt-zacht)', cursor: 'pointer' }}>
            Welke tabellen en kolommen er zijn
          </summary>
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
            {(schema.data?.data ?? []).map((tabel) => (
              <div key={tabel.tabel} style={{ fontSize: 11, marginBottom: 6 }}>
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => setSql((huidig) => `${huidig} ${tabel.tabel}`)}
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    font: 'inherit',
                    fontWeight: 700,
                    color: 'var(--belasting)',
                    cursor: 'pointer',
                  }}
                >
                  {tabel.tabel}
                </button>
                <span style={{ color: 'var(--inkt-zacht)' }}>
                  {' '}
                  — {tabel.kolommen.map((kolom) => kolom.naam).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </details>
      </Kaart>

      <Resultaat verzoek={{ sql }} titel={titel} bewaarbaar={{ sql }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Het resultaat, met de exportknoppen
// ---------------------------------------------------------------------------

function Resultaat({
  verzoek,
  titel,
  bewaarbaar,
}: {
  verzoek: Rapportverzoek;
  titel: string;
  bewaarbaar: { definitie?: Bouwdefinitie; sql?: string };
}): JSX.Element {
  const queryClient = useQueryClient();
  const [uitkomst, setUitkomst] = useState<Rapportuitkomst | null>(null);
  const [meta, setMeta] = useState<Rapportmeta | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [bewaarNaam, setBewaarNaam] = useState('');
  const [gedeeld, setGedeeld] = useState(true);

  const draaien = useMutation({
    mutationFn: () => endpoints.rapportDraaien(verzoek),
    onSuccess: (antwoord) => {
      setUitkomst(antwoord.data);
      setMeta(antwoord.meta);
      setFout(null);
    },
    onError: (error: unknown) => {
      setUitkomst(null);
      setFout(error instanceof ApiFout ? error.message : 'De rapportage kon niet worden gedraaid.');
    },
  });

  const exporteren = useMutation({
    mutationFn: (formaat: string) =>
      endpoints.rapportExporteren({ ...verzoek, formaat, titel }),
    onSuccess: (antwoord) => void bewaarBestand(antwoord.data),
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Exporteren lukte niet.'),
  });

  const bewaren = useMutation({
    mutationFn: () =>
      endpoints.rapportBewaren({ naam: bewaarNaam.trim(), ...bewaarbaar, gedeeld }),
    onSuccess: () => {
      setMelding(`"${bewaarNaam.trim()}" is bewaard.`);
      setBewaarNaam('');
      void queryClient.invalidateQueries({ queryKey: ['rapporten-opgeslagen'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Bewaren lukte niet.'),
  });

  async function bewaarBestand(bestand: Exportbestand): Promise<void> {
    if (!window.showroom) {
      setFout('Een bestand opslaan werkt alleen in de desktop-applicatie.');
      return;
    }
    const resultaat = (await window.showroom.opslaanAls(
      bestand.bestandsnaam,
      bestand.inhoud,
      bestand.codering === 'base64' ? 'base64' : 'utf8',
    )) as { opgeslagen?: boolean; pad?: string } | undefined;

    setMelding(
      resultaat?.opgeslagen === true
        ? `Opgeslagen als ${resultaat.pad ?? bestand.bestandsnaam}.`
        : 'Opslaan afgebroken.',
    );
  }

  /**
   * PDF gaat niet via de kern maar via de schil: die kan afdrukken naar PDF,
   * en dan hoeft er geen PDF-bibliotheek in de applicatie te zitten. Dezelfde
   * route als de offerte-PDF van fase 8.
   */
  async function naarPdf(): Promise<void> {
    if (uitkomst === null) return;
    if (!window.showroom) {
      setFout('Afdrukken werkt alleen in de desktop-applicatie.');
      return;
    }

    const resultaat = (await window.showroom.printPdf(
      rapportHtml(titel, uitkomst),
      `${titel}.pdf`,
      uitkomst.kolommen.length > 6,
    )) as { opgeslagen?: boolean; pad?: string } | undefined;

    setMelding(
      resultaat?.opgeslagen === true
        ? `Opgeslagen als ${resultaat.pad ?? `${titel}.pdf`}.`
        : 'Afdrukken afgebroken.',
    );
  }

  const bezig = draaien.isPending || exporteren.isPending;

  return (
    <Kaart>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="focus-ring"
          disabled={bezig}
          onClick={() => draaien.mutate()}
          style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
        >
          {draaien.isPending ? 'Bezig…' : 'Draaien'}
        </button>

        {uitkomst !== null && (
          <>
            <button
              type="button"
              className="focus-ring"
              disabled={bezig}
              onClick={() => exporteren.mutate('xlsx')}
              style={dialoogKnop}
            >
              Naar Excel
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={bezig}
              onClick={() => exporteren.mutate('csv')}
              style={dialoogKnop}
            >
              Naar CSV
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={bezig}
              onClick={() => exporteren.mutate('docx')}
              style={dialoogKnop}
            >
              Naar Word
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={bezig}
              onClick={() => void naarPdf()}
              style={dialoogKnop}
            >
              Naar PDF
            </button>
          </>
        )}
      </div>

      {meta !== null && (
        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
          {meta.aantal.toLocaleString('nl-NL')} {meta.aantal === 1 ? 'regel' : 'regels'} in{' '}
          {meta.duurMs} ms
          {meta.afgekapt && (
            <strong style={{ color: 'var(--ziekte)' }}>
              {' '}
              — afgekapt op {meta.maxRijen.toLocaleString('nl-NL')} rijen. Voeg een filter toe.
            </strong>
          )}
        </p>
      )}

      {fout !== null && (
        <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: '10px 0 0' }}>{fout}</p>
      )}
      {melding !== null && (
        <p style={{ fontSize: 12, color: 'var(--belasting)', margin: '10px 0 0' }}>{melding}</p>
      )}

      {uitkomst !== null && (
        <>
          <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  {uitkomst.kolommen.map((kolom) => (
                    <th
                      key={kolom.sleutel}
                      scope="col"
                      style={{
                        textAlign: 'left',
                        position: 'sticky',
                        top: 0,
                        background: 'var(--vlak)',
                        borderBottom: '1px solid var(--rand)',
                        padding: '4px 8px 4px 0',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {kolom.kop}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uitkomst.rijen.map((rij, index) => (
                  <tr key={index}>
                    {uitkomst.kolommen.map((kolom) => (
                      <td
                        key={kolom.sleutel}
                        style={{
                          borderBottom: '1px solid var(--rand)',
                          padding: '4px 8px 4px 0',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {toon(rij[kolom.sleutel], kolom.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {uitkomst.rijen.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', marginTop: 8 }}>
              Deze vraag levert geen regels op.
            </p>
          )}

          <div
            style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <input
              className="focus-ring"
              value={bewaarNaam}
              placeholder="Bewaren onder de naam…"
              onChange={(event) => setBewaarNaam(event.target.value)}
              style={{ ...invoerStijl, width: 240 }}
            />
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="checkbox"
                className="focus-ring"
                checked={gedeeld}
                onChange={(event) => setGedeeld(event.target.checked)}
              />
              met collega&apos;s delen
            </label>
            <button
              type="button"
              className="focus-ring"
              disabled={bewaarNaam.trim() === '' || bewaren.isPending}
              onClick={() => bewaren.mutate()}
              style={dialoogKnop}
            >
              Bewaren
            </button>
          </div>
        </>
      )}
    </Kaart>
  );
}

// ---------------------------------------------------------------------------
// Opgeslagen rapportages
// ---------------------------------------------------------------------------

function Opgeslagen({ ik, onOpenen }: { ik: Gebruiker; onOpenen: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [geopend, setGeopend] = useState<OpgeslagenRapport | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const lijst = useQuery({
    queryKey: ['rapporten-opgeslagen'],
    queryFn: () => endpoints.rapportenOpgeslagen(),
  });

  const verwijderen = useMutation({
    mutationFn: (id: number) => endpoints.rapportVerwijderen(id),
    onSuccess: () => {
      setGeopend(null);
      void queryClient.invalidateQueries({ queryKey: ['rapporten-opgeslagen'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Verwijderen lukte niet.'),
  });

  const rapporten = lijst.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {fout !== null && <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: 0 }}>{fout}</p>}

      {rapporten.length === 0 && lijst.isSuccess && (
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Er zijn nog geen bewaarde rapportages. Bouw er een en klik op Bewaren.
        </p>
      )}

      {rapporten.map((rapport) => (
        <Kaart key={rapport.id}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
          >
            <div>
              <h2 style={{ fontSize: 14, margin: 0 }}>{rapport.naam}</h2>
              <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '3px 0 0' }}>
                {rapport.modus === 'sql' ? 'SQL' : 'Bouwer'}
                {rapport.eigenaar !== null && ` · van ${rapport.eigenaar}`}
                {rapport.gedeeld ? ' · gedeeld' : ' · alleen voor jou'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setGeopend(geopend?.id === rapport.id ? null : rapport)}
                style={dialoogKnop}
              >
                {geopend?.id === rapport.id ? 'Sluiten' : 'Draaien'}
              </button>
              {(rapport.eigenaarId === ik.id || ik.role === 'admin') && (
                <button
                  type="button"
                  className="focus-ring"
                  onClick={() => verwijderen.mutate(rapport.id)}
                  style={dialoogKnop}
                >
                  Verwijderen
                </button>
              )}
            </div>
          </div>

          {geopend?.id === rapport.id && (
            <div style={{ marginTop: 12 }}>
              <Resultaat
                verzoek={
                  rapport.modus === 'sql'
                    ? { sql: rapport.sql ?? '' }
                    : (rapport.definitie ?? { entiteit: 'organizations', kolommen: [] })
                }
                titel={rapport.naam}
                bewaarbaar={
                  rapport.modus === 'sql'
                    ? { sql: rapport.sql ?? '' }
                    : { definitie: rapport.definitie ?? undefined }
                }
              />
            </div>
          )}
        </Kaart>
      ))}

      <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: 0 }}>
        Een gedeelde rapportage is voor iedereen zichtbaar; verwijderen kan alleen wie hem gemaakt
        heeft, of een beheerder.{' '}
        <button
          type="button"
          className="focus-ring"
          onClick={onOpenen}
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            font: 'inherit',
            color: 'var(--belasting)',
            cursor: 'pointer',
          }}
        >
          Nieuwe rapportage bouwen
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Toont een waarde zoals een Nederlandse gebruiker hem verwacht. */
function toon(waarde: unknown, type: string | undefined): string {
  if (waarde === null || waarde === undefined) return '';

  if (type === 'bedrag' && Number.isFinite(Number(waarde))) {
    return (Number(waarde) / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
  }
  if (type === 'procent' && Number.isFinite(Number(waarde))) {
    return `${(Number(waarde) / 100).toLocaleString('nl-NL')}%`;
  }
  if (type === 'datum') {
    const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(waarde));
    if (treffer !== null) return `${treffer[3]}-${treffer[2]}-${treffer[1]}`;
  }
  if (type === 'getal' && Number.isFinite(Number(waarde))) {
    return Number(waarde).toLocaleString('nl-NL');
  }

  return String(waarde);
}

function escape(waarde: string): string {
  return waarde
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * De HTML die de schil naar PDF afdrukt.
 *
 * Geen themavariabelen: een PDF wordt afgedrukt buiten het venster om, en dan
 * is er niets om die variabelen uit te lezen. Dezelfde afweging als bij de
 * offerte-PDF van fase 8.
 */
export function rapportHtml(titel: string, uitkomst: Rapportuitkomst): string {
  const koppen = uitkomst.kolommen.map((kolom) => `<th>${escape(kolom.kop)}</th>`).join('');
  const rijen = uitkomst.rijen
    .map(
      (rij) =>
        `<tr>${uitkomst.kolommen
          .map((kolom) => `<td>${escape(toon(rij[kolom.sleutel], kolom.type))}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>${escape(titel)}</title>
<style>
  body { font: 11px/1.45 "Segoe UI", Calibri, sans-serif; color: #1a1a1a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #666; margin: 0 0 16px; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bfbfbf; padding: 4px 6px; text-align: left; }
  th { background: #efefef; font-weight: 600; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
</style></head><body>
<h1>${escape(titel)}</h1>
<p class="sub">Gemaakt op ${formatDate(new Date())} · ${uitkomst.rijen.length} ${
    uitkomst.rijen.length === 1 ? 'regel' : 'regels'
  }</p>
<table><thead><tr>${koppen}</tr></thead><tbody>${rijen}</tbody></table>
</body></html>`;
}
