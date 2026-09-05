/**
 * De signaleringen op het dashboard (hoofdstuk 8.2).
 *
 * Op ernst gesorteerd, en de ernst blijkt uit een woord en een streep aan de
 * linkerkant — niet uit kleur alleen. Bij elke melding staat hoe lang hij al
 * speelt, want een overbezette week die er vanochtend bij kwam is iets anders
 * dan een die al drie weken staat.
 *
 * Er zijn drie knoppen en het verschil ertussen doet ertoe:
 *
 *   Gezien       de melding blijft, maar valt op de achtergrond
 *   Later        tot een datum uit beeld; komt terug als het dan nog speelt
 *   Afhandelen   sluiten; komt terug als de situatie er bij de volgende
 *                controle nog is, want wegklikken lost niets op
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type Ernst, type Melding } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { dialoogKnop } from '../kansen/Dialoog.tsx';

const ERNST: Record<Ernst, { label: string; kleur: string; volgorde: number }> = {
  urgent: { label: 'Urgent', kleur: 'var(--ziekte)', volgorde: 0 },
  let_op: { label: 'Let op', kleur: 'var(--belasting)', volgorde: 1 },
  info: { label: 'Ter info', kleur: 'var(--inkt-stil)', volgorde: 2 },
};

/** Waar een melding heen wijst, per entiteit uit de kern. */
const ROUTE: Record<string, string> = {
  projects: '/projecten',
  opportunities: '/kansen',
  organizations: '/klanten',
  contacts: '/contactpersonen',
  absences: '/verlof',
  'capacity-allocations': '/verlof',
};

export function Signaleringen({ navigeer }: { navigeer: (pad: string) => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [alles, setAlles] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  const meldingen = useQuery({
    queryKey: ['meldingen', alles],
    queryFn: () => endpoints.meldingen(alles ? '?includeSnoozed=true' : ''),
  });

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['meldingen'] });
    void queryClient.invalidateQueries({ queryKey: ['meldingtelling'] });
  }

  const doorrekenen = useMutation({
    mutationFn: () => endpoints.meldingenDoorrekenen(),
    onSuccess: (antwoord) => {
      const { nieuw, opgelost } = antwoord.data;
      setMelding(
        nieuw === 0 && opgelost === 0
          ? 'Doorgerekend; er is niets veranderd.'
          : `Doorgerekend: ${nieuw} nieuw, ${opgelost} opgelost.`,
      );
      ververs();
    },
    onError: (error: unknown) =>
      setMelding(error instanceof ApiFout ? error.message : 'Doorrekenen lukte niet.'),
  });

  const afhandelen = useMutation({
    mutationFn: ({ id, actie }: { id: number; actie: 'gezien' | 'later' | 'sluiten' }) => {
      if (actie === 'gezien') return endpoints.meldingBevestigen(id);
      if (actie === 'later') return endpoints.meldingUitstellen(id, 7);
      return endpoints.meldingSluiten(id);
    },
    onSuccess: () => {
      setMelding(null);
      ververs();
    },
    onError: (error: unknown) =>
      setMelding(error instanceof ApiFout ? error.message : 'Dat lukte niet.'),
  });

  const rijen = meldingen.data?.data ?? [];
  const telling = meldingen.data?.meta.telling;

  return (
    <Kaart>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Signaleringen</h2>

        {telling && (
          <span style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
            {(['urgent', 'let_op', 'info'] as const)
              .filter((ernst) => telling[ernst] > 0)
              .map((ernst) => `${telling[ernst]} ${ERNST[ernst].label.toLowerCase()}`)
              .join(' · ') || 'niets openstaand'}
          </span>
        )}

        <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--inkt-zacht)' }}>
          <input type="checkbox" checked={alles} onChange={(event) => setAlles(event.target.checked)} />{' '}
          Ook uitgestelde
        </label>

        <button
          type="button"
          className="focus-ring"
          disabled={doorrekenen.isPending}
          onClick={() => doorrekenen.mutate()}
          style={dialoogKnop}
        >
          {doorrekenen.isPending ? 'Bezig…' : 'Nu doorrekenen'}
        </button>
      </div>

      {melding && (
        <p role="status" style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
          {melding}
        </p>
      )}

      {meldingen.isLoading && <Skelet hoogte={120} />}

      {!meldingen.isLoading && rijen.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: '10px 0 0' }}>
          Er staat niets open. De controle draait elk uur; met "Nu doorrekenen" gaat hij meteen.
        </p>
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: rijen.length > 0 ? 12 : 0 }}>
        {[...rijen]
          .sort((a, b) => ERNST[a.severity].volgorde - ERNST[b.severity].volgorde)
          .map((rij) => (
            <Regel
              key={rij.id}
              melding={rij}
              bezig={afhandelen.isPending}
              onActie={(actie) => afhandelen.mutate({ id: rij.id, actie })}
              onOpen={() => {
                const basis = rij.entity_key ? ROUTE[rij.entity_key] : undefined;
                if (basis) navigeer(rij.record_id ? `${basis}/${rij.record_id}` : basis);
              }}
            />
          ))}
      </div>
    </Kaart>
  );
}

function Regel({
  melding,
  bezig,
  onActie,
  onOpen,
}: {
  melding: Melding;
  bezig: boolean;
  onActie: (actie: 'gezien' | 'later' | 'sluiten') => void;
  onOpen: () => void;
}): JSX.Element {
  const ernst = ERNST[melding.severity];
  const dagen = dagenSinds(melding.first_seen_at);
  const kanOpenen = melding.entity_key !== null && ROUTE[melding.entity_key] !== undefined;

  return (
    <article
      style={{
        border: '1px solid var(--rand)',
        borderLeft: `3px solid ${ernst.kleur}`,
        borderRadius: 6,
        padding: '8px 10px',
        opacity: melding.status === 'bevestigd' ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        {/* Nooit alleen kleur: de ernst staat er als woord bij. */}
        <span style={{ fontSize: 11, fontWeight: 700, color: ernst.kleur, textTransform: 'uppercase' }}>
          {ernst.label}
        </span>
        <strong style={{ fontSize: 13 }}>{melding.title}</strong>
        <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
          {dagen === 0 ? 'vandaag opgemerkt' : `speelt al ${dagen} dag${dagen === 1 ? '' : 'en'}`}
          {melding.status === 'bevestigd' && melding.bevestigd_door
            ? ` · gezien door ${melding.bevestigd_door}`
            : ''}
          {melding.status === 'uitgesteld' && melding.snoozed_until
            ? ` · uitgesteld tot ${formatDate(melding.snoozed_until.slice(0, 10))}`
            : ''}
        </span>
      </div>

      {melding.body && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--inkt-zacht)', lineHeight: 1.5 }}>
          {melding.body}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {kanOpenen && (
          <button type="button" className="focus-ring" onClick={onOpen} style={dialoogKnop}>
            Bekijken →
          </button>
        )}
        {melding.status !== 'bevestigd' && (
          <button
            type="button"
            className="focus-ring"
            disabled={bezig}
            onClick={() => onActie('gezien')}
            style={dialoogKnop}
            title="Blijft staan zolang de situatie er is, maar valt op de achtergrond"
          >
            Gezien
          </button>
        )}
        <button
          type="button"
          className="focus-ring"
          disabled={bezig}
          onClick={() => onActie('later')}
          style={dialoogKnop}
          title="Een week uit beeld; komt terug als het dan nog speelt"
        >
          Later
        </button>
        <button
          type="button"
          className="focus-ring"
          disabled={bezig}
          onClick={() => onActie('sluiten')}
          style={dialoogKnop}
          title="Sluiten. Bestaat de situatie nog, dan komt de melding vanzelf terug"
        >
          Afhandelen
        </button>
      </div>
    </article>
  );
}

/** Hele dagen sinds een tijdstempel uit de database. */
function dagenSinds(tijdstempel: string): number {
  const moment = Date.parse(tijdstempel.includes('T') ? tijdstempel : `${tijdstempel.replace(' ', 'T')}Z`);
  if (Number.isNaN(moment)) return 0;
  return Math.max(0, Math.floor((Date.now() - moment) / 86_400_000));
}
