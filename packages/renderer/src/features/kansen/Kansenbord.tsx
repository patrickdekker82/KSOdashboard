/**
 * Het kanbanbord van de verkooptrechter (hoofdstuk 6.2).
 *
 * Eén kolom per fase, één kaart per open kans. Slepen verplaatst een kans naar
 * een andere fase; winnen en verliezen gaan bewust niet via slepen, want daar
 * hoort een bedrag per discipline of een verliesreden bij. De kern weigert die
 * fasewissel dan ook, en dit scherm opent in plaats daarvan de juiste dialoog.
 *
 * Naast slepen zit op elke kaart een keuzelijst "Verplaats naar". Slepen is
 * met het toetsenbord niet te bedienen, en dit scherm moet dat wel zijn.
 */
import { useMemo, useState, type DragEvent, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@showroom/shared';
import { ApiFout, endpoints, type BordKans, type Fase } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { WinDialoog } from './WinDialoog.tsx';
import { VerliesDialoog } from './VerliesDialoog.tsx';

type Dialoog = { soort: 'winnen' | 'verliezen'; kans: BordKans } | null;

export function Kansenbord({
  onOpen,
  onLijst,
}: {
  onOpen: (id: number) => void;
  onLijst: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [eigenaarId, setEigenaarId] = useState(0);
  const [sleepId, setSleepId] = useState<number | null>(null);
  const [doelFase, setDoelFase] = useState<number | null>(null);
  const [dialoog, setDialoog] = useState<Dialoog>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const bord = useQuery({
    queryKey: ['kansenbord', eigenaarId],
    queryFn: () => endpoints.kansenbord(eigenaarId > 0 ? eigenaarId : undefined),
  });
  const gebruikers = useQuery({
    queryKey: ['gebruikers'],
    queryFn: () => endpoints.gebruikers(),
  });

  const verplaats = useMutation({
    mutationFn: ({ id, stageId }: { id: number; stageId: number }) =>
      endpoints.kansNaarFase(id, stageId),
    onSuccess: () => {
      setMelding(null);
      void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
    },
    onError: (error: unknown, variabelen) => {
      // De kern stuurt "gebruik_winnen" of "gebruik_verliezen" terug als iemand
      // een kans naar een afsluitende fase sleept. Dat is geen fout om te tonen,
      // dat is het sein om de dialoog te openen die er wél bij hoort.
      const kans = kansen.find((entry) => entry.id === variabelen.id);
      if (error instanceof ApiFout && kans && error.code === 'gebruik_winnen') {
        setDialoog({ soort: 'winnen', kans });
        return;
      }
      if (error instanceof ApiFout && kans && error.code === 'gebruik_verliezen') {
        setDialoog({ soort: 'verliezen', kans });
        return;
      }
      setMelding(error instanceof ApiFout ? error.message : 'Verplaatsen lukte niet.');
    },
  });

  const fasen = bord.data?.data.fasen ?? [];
  const kansen = useMemo(() => bord.data?.data.kansen ?? [], [bord.data]);

  const perFase = useMemo(() => {
    const kaart = new Map<number, BordKans[]>();
    for (const kans of kansen) {
      const sleutel = Number(kans.stage_id ?? 0);
      kaart.set(sleutel, [...(kaart.get(sleutel) ?? []), kans]);
    }
    return kaart;
  }, [kansen]);

  function naarFase(kans: BordKans, stageId: number): void {
    const fase = fasen.find((entry) => entry.id === stageId);
    if (fase?.isWon) {
      setDialoog({ soort: 'winnen', kans });
      return;
    }
    if (fase?.isLost) {
      setDialoog({ soort: 'verliezen', kans });
      return;
    }
    if (kans.stage_id === stageId) return;
    verplaats.mutate({ id: kans.id, stageId });
  }

  function onDrop(event: DragEvent<HTMLElement>, fase: Fase): void {
    event.preventDefault();
    setDoelFase(null);
    const id = Number(event.dataTransfer.getData('text/plain') || sleepId);
    const kans = kansen.find((entry) => entry.id === id);
    setSleepId(null);
    if (kans) naarFase(kans, fase.id);
  }

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Kansen</h1>

        <label style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>
          Eigenaar{' '}
          <select
            className="focus-ring"
            value={eigenaarId}
            onChange={(event) => setEigenaarId(Number(event.target.value))}
            style={selectStijl}
          >
            <option value={0}>Iedereen</option>
            {(gebruikers.data?.data ?? []).map((gebruiker) => (
              <option key={gebruiker.id} value={gebruiker.id}>
                {gebruiker.name}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="focus-ring" onClick={onLijst} style={knopStijl}>
          Lijstweergave
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--inkt-stil)' }}>
          {kansen.length} open kans{kansen.length === 1 ? '' : 'en'} ·{' '}
          {formatCurrency(kansen.reduce((som, kans) => som + kans.amount_cents, 0))}
        </span>
      </header>

      {melding && (
        <p role="alert" style={{ margin: 0, color: 'var(--ziekte)', fontSize: 13 }}>
          {melding}
        </p>
      )}

      {bord.isLoading && (
        <Kaart>
          <Skelet hoogte={240} />
        </Kaart>
      )}

      {bord.error && (
        <Kaart>
          <p style={{ color: 'var(--ziekte)', margin: 0 }}>
            {bord.error instanceof Error ? bord.error.message : 'Het bord kon niet worden geladen.'}
          </p>
        </Kaart>
      )}

      {bord.data && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
          {fasen.map((fase) => {
            const inFase = perFase.get(fase.id) ?? [];
            const totaal = inFase.reduce((som, kans) => som + kans.amount_cents, 0);
            const afsluitend = fase.isWon || fase.isLost;

            return (
              <section
                key={fase.id}
                aria-label={`Fase ${fase.name}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDoelFase(fase.id);
                }}
                onDragLeave={() => setDoelFase((huidig) => (huidig === fase.id ? null : huidig))}
                onDrop={(event) => onDrop(event, fase)}
                style={{
                  flex: '0 0 250px',
                  background: 'var(--oppervlak-2)',
                  border: `1px solid ${doelFase === fase.id ? 'var(--belasting)' : 'var(--rand)'}`,
                  borderTop: `3px solid ${fase.color ?? 'var(--rand)'}`,
                  borderRadius: 8,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minHeight: 200,
                }}
              >
                <header>
                  <h2 style={{ fontSize: 13, margin: 0 }}>{fase.name}</h2>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--inkt-stil)' }}>
                    {afsluitend
                      ? 'Sleep hierheen om af te sluiten'
                      : `${inFase.length} · ${formatCurrency(totaal)}`}
                  </p>
                </header>

                {inFase.map((kans) => (
                  <Kanskaart
                    key={kans.id}
                    kans={kans}
                    fasen={fasen}
                    sleept={sleepId === kans.id}
                    onOpen={() => onOpen(kans.id)}
                    onSleepStart={(event) => {
                      setSleepId(kans.id);
                      event.dataTransfer.setData('text/plain', String(kans.id));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onSleepEinde={() => {
                      setSleepId(null);
                      setDoelFase(null);
                    }}
                    onVerplaats={(stageId) => naarFase(kans, stageId)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {dialoog?.soort === 'winnen' && (
        <WinDialoog
          kansId={dialoog.kans.id}
          kansnaam={dialoog.kans.name}
          onSluit={() => setDialoog(null)}
          onKlaar={(tekst) => {
            setDialoog(null);
            setMelding(tekst);
            void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
          }}
        />
      )}

      {dialoog?.soort === 'verliezen' && (
        <VerliesDialoog
          kansId={dialoog.kans.id}
          kansnaam={dialoog.kans.name}
          onSluit={() => setDialoog(null)}
          onKlaar={(tekst) => {
            setDialoog(null);
            setMelding(tekst);
            void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
          }}
        />
      )}
    </div>
  );
}

function Kanskaart({
  kans,
  fasen,
  sleept,
  onOpen,
  onSleepStart,
  onSleepEinde,
  onVerplaats,
}: {
  kans: BordKans;
  fasen: Fase[];
  sleept: boolean;
  onOpen: () => void;
  onSleepStart: (event: DragEvent<HTMLElement>) => void;
  onSleepEinde: () => void;
  onVerplaats: (stageId: number) => void;
}): JSX.Element {
  const stil = kans.dagen_stil;

  return (
    <article
      draggable
      onDragStart={onSleepStart}
      onDragEnd={onSleepEinde}
      style={{
        background: 'var(--oppervlak)',
        border: '1px solid var(--rand)',
        borderLeft: stil === null ? '1px solid var(--rand)' : '3px solid var(--ziekte)',
        borderRadius: 6,
        padding: 8,
        cursor: 'grab',
        opacity: sleept ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        className="focus-ring"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--belasting)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {kans.name}
      </button>

      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--inkt-zacht)' }}>
        {kans.organisatie ?? 'Geen klant gekoppeld'}
      </p>

      <p style={{ margin: '6px 0 0', fontSize: 12 }}>
        <strong>{formatCurrency(kans.amount_cents)}</strong>{' '}
        <span style={{ color: 'var(--inkt-stil)' }}>
          gewogen {formatCurrency(kans.weighted_amount_cents)}
        </span>
      </p>

      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--inkt-stil)' }}>
        {kans.eigenaar ?? '—'}
        {kans.expected_close_date ? ` · sluit ${formatDate(kans.expected_close_date)}` : ''}
        {kans.expected_units ? ` · ${kans.expected_units} won.` : ''}
      </p>

      {stil !== null && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ziekte)' }}>
          ⚠ {stil} dagen geen beweging
        </p>
      )}

      {/* Slepen kan niet met het toetsenbord; deze keuzelijst wel. */}
      <label style={{ display: 'block', marginTop: 6, fontSize: 11, color: 'var(--inkt-stil)' }}>
        <span className="alleen-voorlezen">Verplaats {kans.name} naar</span>
        <select
          className="focus-ring"
          value=""
          onChange={(event) => {
            const stageId = Number(event.target.value);
            event.currentTarget.value = '';
            if (stageId > 0) onVerplaats(stageId);
          }}
          style={{ ...selectStijl, width: '100%' }}
        >
          <option value="">Verplaats naar…</option>
          {fasen
            .filter((fase) => fase.id !== kans.stage_id)
            .map((fase) => (
              <option key={fase.id} value={fase.id}>
                {fase.name}
              </option>
            ))}
        </select>
      </label>
    </article>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '4px 10px',
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
  padding: '3px 6px',
};
