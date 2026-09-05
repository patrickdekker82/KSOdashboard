/**
 * Eén offerte: regels, opties, totalen en de statusknoppen (hoofdstuk 6.5).
 *
 * De klant kiest de opties er hier bij; elke keuze rekent de offerte opnieuw
 * door in de kern. Dat gaat bewust niet in het scherm: bij een pakket met een
 * vaste prijs verschuiven alle regelbedragen mee, en die verdeling hoort op één
 * plek te gebeuren.
 *
 * "Afdrukken" maakt een PDF via het hoofdproces — een verborgen venster met
 * `printToPDF`. Geen externe bibliotheek, en geen browser die opengaat.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBp, formatCurrency, formatDate, formatDecimal } from '@showroom/shared';
import { ApiFout, endpoints, type Offerte, type Offerteregel } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';
import { offerteHtml } from './offerte-pdf.ts';

const STATUS: Record<Offerte['status'], { label: string; kleur: string }> = {
  concept: { label: 'Concept', kleur: 'var(--inkt-stil)' },
  verstuurd: { label: 'Verstuurd', kleur: 'var(--belasting)' },
  geaccepteerd: { label: 'Geaccepteerd', kleur: 'var(--capaciteit)' },
  afgewezen: { label: 'Afgewezen', kleur: 'var(--ziekte)' },
  vervallen: { label: 'Vervallen', kleur: 'var(--inkt-stil)' },
};

export function OfferteDetail({
  id,
  onTerug,
}: {
  id: number;
  onTerug: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [afwijzen, setAfwijzen] = useState(false);

  const offerte = useQuery({ queryKey: ['offerte', id], queryFn: () => endpoints.offerte(id) });

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['offerte', id] });
    void queryClient.invalidateQueries({ queryKey: ['lijst', 'package-quotes'] });
    void queryClient.invalidateQueries({ queryKey: ['meldingen'] });
  }

  const optie = useMutation({
    mutationFn: ({ lineId, gekozen }: { lineId: number; gekozen: boolean }) =>
      endpoints.offerteOptie(id, lineId, gekozen),
    onSuccess: ververs,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De optie kon niet worden gewijzigd.'),
  });

  const versturen = useMutation({
    mutationFn: () => endpoints.offerteVersturen(id),
    onSuccess: (antwoord) => {
      setFout(null);
      setMelding(`Verstuurd. Geldig tot ${formatDate(antwoord.data.validUntil)}.`);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Versturen lukte niet.'),
  });

  const accepteren = useMutation({
    mutationFn: () => endpoints.offerteAccepteren(id),
    onSuccess: () => {
      setFout(null);
      setMelding('Geaccepteerd.');
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Accepteren lukte niet.'),
  });

  const gegevens = offerte.data?.data;

  async function afdrukken(): Promise<void> {
    if (!gegevens) return;
    if (!window.showroom) {
      setFout('Afdrukken werkt alleen in de desktop-applicatie.');
      return;
    }
    const html = offerteHtml(gegevens.offerte, gegevens.regels);
    const uitkomst = (await window.showroom.printPdf(
      html,
      `Offerte ${gegevens.offerte.number ?? id}.pdf`,
    )) as { opgeslagen?: boolean; pad?: string } | undefined;

    setMelding(
      uitkomst?.opgeslagen ? `Opgeslagen als ${uitkomst.pad ?? 'PDF'}.` : 'Afdrukken afgebroken.',
    );
  }

  if (offerte.isLoading) {
    return (
      <Kaart>
        <Skelet hoogte={280} />
      </Kaart>
    );
  }

  if (offerte.error || !gegevens) {
    return (
      <Kaart>
        <p style={{ color: 'var(--ziekte)', margin: 0 }}>
          {offerte.error instanceof Error ? offerte.error.message : 'Deze offerte bestaat niet.'}
        </p>
        <button type="button" className="focus-ring" onClick={onTerug} style={{ ...dialoogKnop, marginTop: 10 }}>
          Terug
        </button>
      </Kaart>
    );
  }

  const { offerte: kop, regels } = gegevens;
  const status = STATUS[kop.status];
  const meegeteld = regels.filter((regel) => regel.is_optional === 0 || regel.is_selected === 1);
  const marge = meegeteld.reduce(
    (som, regel) => som + regel.amount_cents - Math.round(regel.cost_price_cents * regel.quantity),
    0,
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          ← Duurzaamheid
        </button>
        <h1 style={{ fontSize: 18, margin: 0 }}>Offerte {kop.number}</h1>
        <span style={{ fontSize: 12, fontWeight: 700, color: status.kleur, textTransform: 'uppercase' }}>
          {status.label}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="focus-ring" onClick={() => void afdrukken()} style={dialoogKnop}>
            Afdrukken (PDF)
          </button>
          {kop.status === 'concept' && (
            <button
              type="button"
              className="focus-ring"
              disabled={versturen.isPending}
              onClick={() => versturen.mutate()}
              style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
            >
              {versturen.isPending ? 'Bezig…' : 'Versturen'}
            </button>
          )}
          {kop.status === 'verstuurd' && (
            <>
              <button type="button" className="focus-ring" onClick={() => setAfwijzen(true)} style={dialoogKnop}>
                Afgewezen…
              </button>
              <button
                type="button"
                className="focus-ring"
                disabled={accepteren.isPending}
                onClick={() => accepteren.mutate()}
                style={{ ...dialoogKnop, background: 'var(--capaciteit)', color: '#fff', border: 0 }}
              >
                Geaccepteerd
              </button>
            </>
          )}
        </div>
      </header>

      {melding && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--inkt-zacht)' }}>
          {melding}
        </p>
      )}
      {fout && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--ziekte)' }}>
          {fout}
        </p>
      )}

      <Kaart>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Veld label="Klant" waarde={kop.klant ?? '—'} />
          <Veld
            label="Contactpersoon"
            waarde={[kop.first_name, kop.last_name].filter(Boolean).join(' ') || '—'}
          />
          <Veld label="Project" waarde={kop.project ?? '—'} />
          <Veld label="Pakket" waarde={kop.pakket ?? 'Zelf samengesteld'} />
          <Veld label="Eigenaar" waarde={kop.eigenaar ?? '—'} />
          <Veld
            label="Geldig tot"
            waarde={kop.valid_until ? formatDate(kop.valid_until) : '—'}
          />
          {kop.sent_at && (
            <Veld label="Verstuurd op" waarde={formatDate(kop.sent_at.slice(0, 10))} />
          )}
          {kop.decided_at && <Veld label="Beslist op" waarde={formatDate(kop.decided_at)} />}
        </div>
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Regels</h2>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rand)' }}>
                <th scope="col" style={kopStijl}>Onderdeel</th>
                <th scope="col" style={{ ...kopStijl, textAlign: 'right' }}>Aantal</th>
                <th scope="col" style={kopStijl}>Eenheid</th>
                <th scope="col" style={{ ...kopStijl, textAlign: 'right' }}>Stuksprijs</th>
                <th scope="col" style={{ ...kopStijl, textAlign: 'right' }}>Korting</th>
                <th scope="col" style={{ ...kopStijl, textAlign: 'right' }}>Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {regels.map((regel) => (
                <Regel
                  key={regel.id}
                  regel={regel}
                  bewerkbaar={kop.status === 'concept' || kop.status === 'verstuurd'}
                  bezig={optie.isPending}
                  onKies={(gekozen) => optie.mutate({ lineId: regel.id, gekozen })}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginLeft: 'auto',
            marginTop: 14,
            width: 'min(280px, 100%)',
            display: 'grid',
            gap: 4,
            fontSize: 13,
          }}
        >
          <Totaal label="Subtotaal (excl. btw)" waarde={formatCurrency(kop.subtotal_cents)} />
          {kop.discount_cents > 0 && (
            <Totaal label="Waarvan korting" waarde={formatCurrency(kop.discount_cents)} stil />
          )}
          <Totaal label="Btw" waarde={formatCurrency(kop.vat_cents)} />
          <Totaal label="Totaal" waarde={formatCurrency(kop.total_cents)} nadruk />
          {/* Intern: hoort op het scherm, niet op de offerte. */}
          <Totaal
            label="Marge (intern)"
            waarde={`${formatCurrency(marge)} · ${formatBp(
              kop.subtotal_cents === 0 ? 0 : Math.round((marge / kop.subtotal_cents) * 10000),
            )}`}
            stil
          />
        </div>
      </Kaart>

      {kop.notes && (
        <Kaart>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Voorwaarden</h2>
          <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--inkt-zacht)' }}>
            {kop.notes}
          </p>
        </Kaart>
      )}

      {afwijzen && (
        <AfwijsDialoog
          quoteId={id}
          onSluit={() => setAfwijzen(false)}
          onKlaar={() => {
            setAfwijzen(false);
            setMelding('De offerte staat op afgewezen.');
            ververs();
          }}
        />
      )}
    </div>
  );
}

function Regel({
  regel,
  bewerkbaar,
  bezig,
  onKies,
}: {
  regel: Offerteregel;
  bewerkbaar: boolean;
  bezig: boolean;
  onKies: (gekozen: boolean) => void;
}): JSX.Element {
  const optioneel = regel.is_optional === 1;
  const gekozen = regel.is_selected === 1;

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--rand)',
        opacity: optioneel && !gekozen ? 0.55 : 1,
      }}
    >
      <th scope="row" style={{ ...celStijl, textAlign: 'left', fontWeight: 500 }}>
        {optioneel && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
            <input
              type="checkbox"
              checked={gekozen}
              disabled={!bewerkbaar || bezig}
              onChange={(event) => onKies(event.target.checked)}
              aria-label={`${regel.description} meenemen`}
            />
            <span>{regel.description}</span>
          </label>
        )}
        {!optioneel && regel.description}
        {regel.sku && (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--inkt-stil)', fontWeight: 400 }}>
            {regel.sku}
            {optioneel ? ' · optioneel' : ''}
          </span>
        )}
      </th>
      <td style={{ ...celStijl, textAlign: 'right' }}>{formatDecimal(regel.quantity)}</td>
      <td style={celStijl}>{regel.unit ?? '—'}</td>
      <td style={{ ...celStijl, textAlign: 'right' }}>{formatCurrency(regel.unit_price_cents)}</td>
      <td style={{ ...celStijl, textAlign: 'right' }}>
        {regel.discount_bp > 0 ? formatBp(regel.discount_bp) : '—'}
      </td>
      <td style={{ ...celStijl, textAlign: 'right', fontWeight: 600 }}>
        {formatCurrency(regel.amount_cents)}
      </td>
    </tr>
  );
}

function AfwijsDialoog({
  quoteId,
  onSluit,
  onKlaar,
}: {
  quoteId: number;
  onSluit: () => void;
  onKlaar: () => void;
}): JSX.Element {
  const [redenId, setRedenId] = useState(0);
  const [notitie, setNotitie] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const keuzelijsten = useQuery({ queryKey: ['keuzelijsten'], queryFn: () => endpoints.keuzelijsten() });
  const lijst = (keuzelijsten.data?.data ?? []).find((entry) => entry.key === 'verliesreden');
  const redenen = useQuery({
    queryKey: ['keuzelijstItems', lijst?.id],
    queryFn: () => endpoints.keuzelijstItems(lijst!.id),
    enabled: lijst !== undefined,
  });

  const afwijzen = useMutation({
    mutationFn: () =>
      endpoints.offerteAfwijzen(
        quoteId,
        redenId > 0 ? redenId : null,
        notitie.trim() === '' ? null : notitie.trim(),
      ),
    onSuccess: onKlaar,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Afwijzen lukte niet.'),
  });

  const kan = redenId > 0 || notitie.trim() !== '';

  return (
    <Dialoog titel="Offerte afwijzen" onSluit={onSluit}>
      <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 12px', lineHeight: 1.6 }}>
        Kies een reden of licht kort toe wat er speelde. Zonder een van beide zegt het
        verliesrapport later niets.
      </p>

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Reden
        <select
          className="focus-ring"
          value={redenId}
          onChange={(event) => setRedenId(Number(event.target.value))}
          style={{ ...dialoogSelect, marginTop: 3 }}
        >
          <option value={0}>— geen keuze —</option>
          {(redenen.data?.data ?? []).map((reden) => (
            <option key={reden.id} value={reden.id}>
              {reden.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 12 }}>
        Toelichting
        <textarea
          className="focus-ring"
          rows={3}
          value={notitie}
          onChange={(event) => setNotitie(event.target.value)}
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
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
          disabled={!kan || afwijzen.isPending}
          onClick={() => afwijzen.mutate()}
          style={{ ...dialoogKnop, background: 'var(--ziekte)', color: '#fff', border: 0 }}
        >
          {afwijzen.isPending ? 'Bezig…' : 'Afwijzen'}
        </button>
      </div>
    </Dialoog>
  );
}

function Veld({ label, waarde }: { label: string; waarde: string }): JSX.Element {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--inkt-stil)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 13 }}>{waarde}</p>
    </div>
  );
}

function Totaal({
  label,
  waarde,
  nadruk,
  stil,
}: {
  label: string;
  waarde: string;
  nadruk?: boolean;
  stil?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        paddingTop: nadruk ? 6 : 0,
        borderTop: nadruk ? '1px solid var(--rand)' : undefined,
        fontWeight: nadruk ? 700 : 400,
        fontSize: nadruk ? 15 : 13,
        color: stil ? 'var(--inkt-stil)' : undefined,
      }}
    >
      <span>{label}</span>
      <span>{waarde}</span>
    </div>
  );
}

const kopStijl: React.CSSProperties = { padding: '4px 6px', fontWeight: 600 };
const celStijl: React.CSSProperties = { padding: '5px 6px', verticalAlign: 'top' };
