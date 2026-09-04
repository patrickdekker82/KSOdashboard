/**
 * De disciplineregels van een kans, met de totalen die meelopen tijdens het
 * typen (hoofdstuk 6.2).
 *
 * Het regelbedrag dat u hier ziet is een voorproefje: de kern rekent na het
 * opslaan zelf opnieuw met dezelfde prijsmodule, en dat blijft de waarheid.
 * Het scherm gebruikt daarom precies die functie uit `@showroom/shared`, zodat
 * er geen tweede rekenregel kan ontstaan die er net naast zit.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBp, formatCurrency, lineAmountCents, roundCents } from '@showroom/shared';
import { ApiFout, endpoints, type Kansregel } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { invoerStijl, dialoogKnop } from './Dialoog.tsx';
import { basispuntenUit, centenUit, getalUit, naarBasispunten, naarCenten, naarGetal } from './bedrag.ts';

/** Wat er in de invoervelden staat: tekst, want de gebruiker typt Nederlands. */
type Concept = {
  discipline_id: number;
  description: string;
  aantal: string;
  unit: string;
  stuksprijs: string;
  korting: string;
  kostprijs: string;
};

const LEEG: Concept = {
  discipline_id: 0,
  description: '',
  aantal: '1',
  unit: 'woning',
  stuksprijs: '0,00',
  korting: '0',
  kostprijs: '0,00',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  won: 'Gewonnen',
  lost: 'Verloren',
};

export function Kansregels({ kansId, bewerkbaar }: { kansId: number; bewerkbaar: boolean }): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerktId, setBewerktId] = useState<number | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept>(LEEG);
  const [fout, setFout] = useState<string | null>(null);

  const regels = useQuery({
    queryKey: ['kansregels', kansId],
    queryFn: () =>
      endpoints.lijst<Kansregel>(
        'opportunity-lines',
        `?filter=${btoa(JSON.stringify({ field: 'opportunity_id', operator: 'eq', value: kansId }))}&pageSize=200`,
      ),
  });
  const disciplines = useQuery({
    queryKey: ['disciplines'],
    queryFn: () =>
      endpoints.lijst<{ id: number; name: string; default_margin_bp: number }>(
        'disciplines',
        '?pageSize=200',
      ),
  });

  const naamPerDiscipline = useMemo(() => {
    const kaart = new Map<number, string>();
    for (const rij of disciplines.data?.data ?? []) kaart.set(rij.id, rij.name);
    return kaart;
  }, [disciplines.data]);

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['kansregels', kansId] });
    void queryClient.invalidateQueries({ queryKey: ['record', 'opportunities', kansId] });
    void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
  }

  const opslaan = useMutation({
    mutationFn: (id: number | null) => {
      const aantal = naarGetal(concept.aantal);
      const stuksprijs = naarCenten(concept.stuksprijs);
      const korting = naarBasispunten(concept.korting);
      const kostprijs = naarCenten(concept.kostprijs);

      if (concept.discipline_id <= 0) throw new ApiFout(400, 'onvolledig', 'Kies een discipline.');
      if (aantal === null || aantal < 0) throw new ApiFout(400, 'ongeldig', 'Het aantal klopt niet.');
      if (stuksprijs === null) throw new ApiFout(400, 'ongeldig', 'De stuksprijs klopt niet.');
      if (korting === null) throw new ApiFout(400, 'ongeldig', 'De korting moet tussen 0 en 100% liggen.');
      if (kostprijs === null) throw new ApiFout(400, 'ongeldig', 'De kostprijs klopt niet.');

      return endpoints.bewaar<Kansregel>('opportunity-lines', id, {
        opportunity_id: kansId,
        discipline_id: concept.discipline_id,
        description: concept.description.trim() === '' ? null : concept.description.trim(),
        quantity: aantal,
        unit: concept.unit.trim() === '' ? null : concept.unit.trim(),
        unit_price_cents: stuksprijs,
        discount_bp: korting,
        cost_price_cents: kostprijs,
      });
    },
    onSuccess: () => {
      setBewerktId(null);
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De regel kon niet worden opgeslagen.'),
  });

  const verwijderen = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('opportunity-lines', id),
    onSuccess: ververs,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De regel kon niet worden verwijderd.'),
  });

  const rijen = regels.data?.data ?? [];
  const totaal = rijen.reduce((som, regel) => som + regel.amount_cents, 0);
  const marge = rijen.reduce((som, regel) => som + regel.margin_cents, 0);

  // Wat de regel op dit moment zou worden, met dezelfde functie als de kern.
  const voorproefje = (): number => {
    const aantal = naarGetal(concept.aantal) ?? 0;
    const stuksprijs = naarCenten(concept.stuksprijs) ?? 0;
    const korting = naarBasispunten(concept.korting) ?? 0;
    return lineAmountCents(aantal, stuksprijs, korting);
  };

  function begin(regel: Kansregel | null): void {
    setFout(null);
    if (regel === null) {
      setConcept({ ...LEEG, discipline_id: disciplines.data?.data[0]?.id ?? 0 });
      setBewerktId('nieuw');
      return;
    }
    setConcept({
      discipline_id: regel.discipline_id,
      description: regel.description ?? '',
      aantal: getalUit(regel.quantity),
      unit: regel.unit ?? '',
      stuksprijs: centenUit(regel.unit_price_cents),
      korting: basispuntenUit(regel.discount_bp),
      kostprijs: centenUit(regel.cost_price_cents),
    });
    setBewerktId(regel.id);
  }

  return (
    <Kaart>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>Disciplines</h2>
        <span style={{ fontSize: 12, color: 'var(--inkt-stil)' }}>
          {rijen.length} regel{rijen.length === 1 ? '' : 's'}
        </span>
        {bewerkbaar && bewerktId === null && (
          <button
            type="button"
            className="focus-ring"
            onClick={() => begin(null)}
            style={{ ...dialoogKnop, marginLeft: 'auto' }}
          >
            + Regel toevoegen
          </button>
        )}
      </div>

      {regels.isLoading && <Skelet hoogte={120} />}

      {!regels.isLoading && rijen.length === 0 && bewerktId !== 'nieuw' && (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
          Nog geen disciplineregels. Het kansbedrag blijft € 0,00 tot er een regel bij staat.
        </p>
      )}

      {(rijen.length > 0 || bewerktId === 'nieuw') && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                <th scope="col" style={kop}>Discipline</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Aantal</th>
                <th scope="col" style={kop}>Eenheid</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Stuksprijs</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Korting</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Bedrag</th>
                <th scope="col" style={{ ...kop, textAlign: 'right' }}>Marge</th>
                <th scope="col" style={kop}>Status</th>
                {bewerkbaar && <th scope="col" style={kop}><span className="alleen-voorlezen">Acties</span></th>}
              </tr>
            </thead>
            <tbody>
              {rijen.map((regel) =>
                bewerktId === regel.id ? (
                  <RegelInvoer
                    key={regel.id}
                    concept={concept}
                    disciplines={disciplines.data?.data ?? []}
                    bedrag={voorproefje()}
                    bezig={opslaan.isPending}
                    onWijzig={(velden) => setConcept((huidig) => ({ ...huidig, ...velden }))}
                    onOpslaan={() => opslaan.mutate(regel.id)}
                    onAnnuleer={() => setBewerktId(null)}
                  />
                ) : (
                  <tr key={regel.id} style={{ borderBottom: '1px solid var(--rand)' }}>
                    <th scope="row" style={{ ...cel, textAlign: 'left', fontWeight: 500 }}>
                      {naamPerDiscipline.get(regel.discipline_id) ?? `Discipline ${regel.discipline_id}`}
                      {regel.description && (
                        <span style={{ display: 'block', color: 'var(--inkt-stil)', fontWeight: 400 }}>
                          {regel.description}
                        </span>
                      )}
                    </th>
                    <td style={{ ...cel, textAlign: 'right' }}>{getalUit(regel.quantity)}</td>
                    <td style={cel}>{regel.unit ?? '—'}</td>
                    <td style={{ ...cel, textAlign: 'right' }}>{formatCurrency(regel.unit_price_cents)}</td>
                    <td style={{ ...cel, textAlign: 'right' }}>
                      {regel.discount_bp === 0 ? '—' : formatBp(regel.discount_bp)}
                    </td>
                    <td style={{ ...cel, textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(regel.amount_cents)}
                    </td>
                    <td style={{ ...cel, textAlign: 'right', color: regel.margin_cents < 0 ? 'var(--ziekte)' : undefined }}>
                      {formatCurrency(regel.margin_cents)}
                    </td>
                    <td style={cel}>{STATUS_LABEL[regel.status] ?? regel.status}</td>
                    {bewerkbaar && (
                      <td style={{ ...cel, whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => begin(regel)}
                          style={dialoogKnop}
                        >
                          Bewerken
                        </button>{' '}
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => verwijderen.mutate(regel.id)}
                          style={dialoogKnop}
                        >
                          Verwijderen
                        </button>
                      </td>
                    )}
                  </tr>
                ),
              )}

              {bewerktId === 'nieuw' && (
                <RegelInvoer
                  concept={concept}
                  disciplines={disciplines.data?.data ?? []}
                  bedrag={voorproefje()}
                  bezig={opslaan.isPending}
                  onWijzig={(velden) => setConcept((huidig) => ({ ...huidig, ...velden }))}
                  onOpslaan={() => opslaan.mutate(null)}
                  onAnnuleer={() => setBewerktId(null)}
                />
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5} style={{ ...cel, textAlign: 'right' }}>
                  Totaal
                </th>
                <td style={{ ...cel, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(totaal)}</td>
                <td style={{ ...cel, textAlign: 'right' }}>{formatCurrency(marge)}</td>
                <td style={cel} colSpan={bewerkbaar ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
          {fout}
        </p>
      )}
    </Kaart>
  );
}

function RegelInvoer({
  concept,
  disciplines,
  bedrag,
  bezig,
  onWijzig,
  onOpslaan,
  onAnnuleer,
}: {
  concept: Concept;
  disciplines: Array<{ id: number; name: string }>;
  bedrag: number;
  bezig: boolean;
  onWijzig: (velden: Partial<Concept>) => void;
  onOpslaan: () => void;
  onAnnuleer: () => void;
}): JSX.Element {
  const kostprijs = naarCenten(concept.kostprijs) ?? 0;
  const aantal = naarGetal(concept.aantal) ?? 0;

  return (
    <tr style={{ borderBottom: '1px solid var(--rand)', background: 'var(--oppervlak)' }}>
      <td style={cel}>
        <select
          className="focus-ring"
          aria-label="Discipline"
          value={concept.discipline_id}
          onChange={(event) => onWijzig({ discipline_id: Number(event.target.value) })}
          style={{ ...invoerStijl, width: '100%' }}
        >
          <option value={0}>— kies —</option>
          {disciplines.map((discipline) => (
            <option key={discipline.id} value={discipline.id}>
              {discipline.name}
            </option>
          ))}
        </select>
        <input
          className="focus-ring"
          aria-label="Omschrijving"
          placeholder="Omschrijving"
          value={concept.description}
          onChange={(event) => onWijzig({ description: event.target.value })}
          style={{ ...invoerStijl, width: '100%', marginTop: 4 }}
        />
      </td>
      <td style={{ ...cel, textAlign: 'right' }}>
        <input
          className="focus-ring"
          aria-label="Aantal"
          inputMode="decimal"
          value={concept.aantal}
          onChange={(event) => onWijzig({ aantal: event.target.value })}
          style={{ ...invoerStijl, width: 64, textAlign: 'right' }}
        />
      </td>
      <td style={cel}>
        <input
          className="focus-ring"
          aria-label="Eenheid"
          value={concept.unit}
          onChange={(event) => onWijzig({ unit: event.target.value })}
          style={{ ...invoerStijl, width: 80 }}
        />
      </td>
      <td style={{ ...cel, textAlign: 'right' }}>
        <input
          className="focus-ring"
          aria-label="Stuksprijs in euro"
          inputMode="decimal"
          value={concept.stuksprijs}
          onChange={(event) => onWijzig({ stuksprijs: event.target.value })}
          style={{ ...invoerStijl, width: 90, textAlign: 'right' }}
        />
      </td>
      <td style={{ ...cel, textAlign: 'right' }}>
        <input
          className="focus-ring"
          aria-label="Korting in procenten"
          inputMode="decimal"
          value={concept.korting}
          onChange={(event) => onWijzig({ korting: event.target.value })}
          style={{ ...invoerStijl, width: 58, textAlign: 'right' }}
        />
      </td>
      <td style={{ ...cel, textAlign: 'right', fontWeight: 600 }} aria-live="polite">
        {formatCurrency(bedrag)}
      </td>
      <td style={{ ...cel, textAlign: 'right' }}>
        <input
          className="focus-ring"
          aria-label="Kostprijs per eenheid in euro"
          inputMode="decimal"
          value={concept.kostprijs}
          onChange={(event) => onWijzig({ kostprijs: event.target.value })}
          style={{ ...invoerStijl, width: 90, textAlign: 'right' }}
        />
        <span style={{ display: 'block', fontSize: 10, color: 'var(--inkt-stil)' }}>
          marge {formatCurrency(bedrag - roundCents(kostprijs * aantal))}
        </span>
      </td>
      <td style={cel} colSpan={2}>
        <button
          type="button"
          className="focus-ring"
          disabled={bezig}
          onClick={onOpslaan}
          style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
        >
          {bezig ? 'Bezig…' : 'Opslaan'}
        </button>{' '}
        <button type="button" className="focus-ring" onClick={onAnnuleer} style={dialoogKnop}>
          Annuleren
        </button>
      </td>
    </tr>
  );
}

const kop: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const cel: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
