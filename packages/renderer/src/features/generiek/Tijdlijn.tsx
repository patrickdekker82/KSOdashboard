/**
 * Tijdlijnpaneel op de detailpagina (hoofdstuk 6.1 en 9).
 *
 * Activiteiten, wijzigingen, e-mail en offertes in één chronologische lijst,
 * met bovenaan een veld om meteen iets vast te leggen. Daaronder de bijlagen
 * en de labels van dit record.
 */
import { useRef, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@showroom/shared';
import {
  ApiFout,
  bijlageUrl,
  endpoints,
  uploadBijlage,
  type Bijlage,
  type TijdlijnItem,
} from '../../lib/api.ts';

const SOORT_LABEL: Record<TijdlijnItem['soort'], string> = {
  activiteit: 'Activiteit',
  wijziging: 'Wijziging',
  email: 'E-mail',
  offerte: 'Offerte',
  fase: 'Fase',
};

const SOORT_KLEUR: Record<TijdlijnItem['soort'], string> = {
  activiteit: 'var(--belasting)',
  wijziging: 'var(--inkt-stil)',
  email: 'var(--inzet)',
  offerte: 'var(--capaciteit)',
  fase: 'var(--inzet)',
};

export function Tijdlijn({ entiteit, id }: { entiteit: string; id: number }): JSX.Element {
  const queryClient = useQueryClient();
  const [onderwerp, setOnderwerp] = useState('');
  const [soort, setSoort] = useState('notitie');
  const [fout, setFout] = useState<string | null>(null);

  const tijdlijn = useQuery({
    queryKey: ['tijdlijn', entiteit, id],
    queryFn: () => endpoints.tijdlijn(entiteit, id),
  });

  const vastleggen = useMutation({
    mutationFn: () =>
      endpoints.activiteitToevoegen(entiteit, id, {
        type: soort,
        subject: onderwerp,
        // Een notitie is meteen af; een taak of belafspraak blijft openstaan.
        status: soort === 'notitie' ? 'afgerond' : 'open',
        completed_at: soort === 'notitie' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      }),
    onSuccess: () => {
      setOnderwerp('');
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['tijdlijn', entiteit, id] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Vastleggen lukte niet.'),
  });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section>
        <h2 style={{ fontSize: 14, margin: '0 0 10px' }}>Tijdlijn</h2>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <select
            aria-label="Soort"
            className="focus-ring"
            value={soort}
            onChange={(event) => setSoort(event.target.value)}
            style={{ ...invoerStijl, flex: '0 0 auto' }}
          >
            <option value="notitie">Notitie</option>
            <option value="bellen">Gebeld</option>
            <option value="e-mail">E-mail</option>
            <option value="afspraak">Afspraak</option>
            <option value="taak">Taak</option>
          </select>
          <input
            className="focus-ring"
            value={onderwerp}
            onChange={(event) => setOnderwerp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onderwerp.trim()) vastleggen.mutate();
            }}
            placeholder="Wat is er gebeurd?"
            aria-label="Onderwerp"
            style={{ ...invoerStijl, flex: 1 }}
          />
          <button
            type="button"
            className="focus-ring"
            disabled={!onderwerp.trim() || vastleggen.isPending}
            onClick={() => vastleggen.mutate()}
            style={{
              ...knopStijl,
              background: onderwerp.trim() ? 'var(--belasting)' : 'var(--rand)',
              color: onderwerp.trim() ? '#fff' : 'var(--inkt-stil)',
              border: 0,
            }}
          >
            Vastleggen
          </button>
        </div>

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, margin: '0 0 8px' }}>
            {fout}
          </p>
        )}

        {tijdlijn.isLoading && (
          <p style={{ color: 'var(--inkt-stil)', fontSize: 13 }}>Bezig met laden…</p>
        )}

        {tijdlijn.data?.data.length === 0 && (
          <p style={{ color: 'var(--inkt-zacht)', fontSize: 13, lineHeight: 1.6 }}>
            Er is nog niets vastgelegd. Wat u hierboven invoert, verschijnt hier.
          </p>
        )}

        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {tijdlijn.data?.data.map((item) => (
            <li
              key={`${item.soort}-${item.id}`}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  background: SOORT_KLEUR[item.soort],
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div>
                  {/* Nooit alleen kleur: het soort staat er ook als woord. */}
                  <span style={{ color: 'var(--inkt-stil)', fontSize: 11, marginRight: 6 }}>
                    {SOORT_LABEL[item.soort]}
                  </span>
                  {item.titel}
                </div>
                {item.tekst && (
                  <div style={{ color: 'var(--inkt-zacht)', marginTop: 2, wordBreak: 'break-word' }}>
                    {item.tekst}
                  </div>
                )}
                <div style={{ color: 'var(--inkt-stil)', fontSize: 11, marginTop: 2 }}>
                  {formatDate(item.op.slice(0, 10))}
                  {item.op.length > 10 ? ` ${item.op.slice(11, 16)}` : ''}
                  {item.door ? ` · ${item.door}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Bijlagen entiteit={entiteit} id={id} />
      <Labels entiteit={entiteit} id={id} />
    </div>
  );
}

function Bijlagen({ entiteit, id }: { entiteit: string; id: number }): JSX.Element {
  const queryClient = useQueryClient();
  const invoer = useRef<HTMLInputElement>(null);
  const [fout, setFout] = useState<string | null>(null);

  const bijlagen = useQuery({
    queryKey: ['bijlagen', entiteit, id],
    queryFn: () => endpoints.bijlagen(entiteit, id),
  });

  const uploaden = useMutation({
    mutationFn: (bestand: File) => uploadBijlage(entiteit, id, bestand),
    onSuccess: () => {
      setFout(null);
      if (invoer.current) invoer.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['bijlagen', entiteit, id] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Het bestand kon niet worden opgeslagen.'),
  });

  const verwijderen = useMutation({
    mutationFn: (bijlageId: number) => endpoints.bijlageVerwijderen(bijlageId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bijlagen', entiteit, id] }),
  });

  async function open(bijlage: Bijlage): Promise<void> {
    // De download loopt via het geautoriseerde endpoint; het hoofdproces opent
    // hem niet zelf, dus we halen hem op en bieden hem aan als bestand.
    const url = await bijlageUrl(bijlage.id);
    window.open(url, '_blank', 'noopener');
  }

  return (
    <section>
      <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Bijlagen</h2>

      <input
        ref={invoer}
        type="file"
        aria-label="Bijlage toevoegen"
        className="focus-ring"
        onChange={(event) => {
          const bestand = event.target.files?.[0];
          if (bestand) uploaden.mutate(bestand);
        }}
        style={{ fontSize: 12, marginBottom: 8 }}
      />

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, margin: '0 0 8px' }}>
          {fout}
        </p>
      )}

      {bijlagen.data?.data.length === 0 && (
        <p style={{ color: 'var(--inkt-zacht)', fontSize: 12, margin: 0 }}>Nog geen bijlagen.</p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
        {bijlagen.data?.data.map((bijlage) => (
          <li key={bijlage.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => void open(bijlage)}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                font: 'inherit',
                color: 'var(--belasting)',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {bijlage.filename}
            </button>
            <span style={{ color: 'var(--inkt-stil)', whiteSpace: 'nowrap' }}>
              {Math.max(1, Math.round(bijlage.size_bytes / 1024))} kB
            </span>
            <button
              type="button"
              className="focus-ring"
              aria-label={`${bijlage.filename} verwijderen`}
              onClick={() => verwijderen.mutate(bijlage.id)}
              style={{ ...knopStijl, marginLeft: 'auto', padding: '1px 7px' }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Labels({ entiteit, id }: { entiteit: string; id: number }): JSX.Element {
  const queryClient = useQueryClient();
  const [nieuw, setNieuw] = useState('');

  const tags = useQuery({
    queryKey: ['tags', entiteit, id],
    queryFn: () => endpoints.tags(entiteit, id),
  });

  const ververs = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['tags', entiteit, id] });
  };

  const toevoegen = useMutation({
    mutationFn: () => endpoints.tagToevoegen(entiteit, id, nieuw.trim()),
    onSuccess: () => {
      setNieuw('');
      ververs();
    },
  });

  const verwijderen = useMutation({
    mutationFn: (tagId: number) => endpoints.tagVerwijderen(entiteit, id, tagId),
    onSuccess: ververs,
  });

  return (
    <section>
      <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Labels</h2>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {tags.data?.data.map((tag) => (
          <span
            key={tag.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 4px 2px 9px',
              borderRadius: 11,
              background: 'var(--rand)',
              fontSize: 12,
            }}
          >
            {tag.name}
            <button
              type="button"
              className="focus-ring"
              aria-label={`Label ${tag.name} verwijderen`}
              onClick={() => verwijderen.mutate(tag.id)}
              style={{
                background: 'none',
                border: 0,
                color: 'var(--inkt-stil)',
                cursor: 'pointer',
                padding: '0 3px',
                font: 'inherit',
              }}
            >
              ×
            </button>
          </span>
        ))}
        {tags.data?.data.length === 0 && (
          <span style={{ color: 'var(--inkt-zacht)', fontSize: 12 }}>Nog geen labels.</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="focus-ring"
          value={nieuw}
          onChange={(event) => setNieuw(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && nieuw.trim()) toevoegen.mutate();
          }}
          placeholder="Nieuw label"
          aria-label="Nieuw label"
          style={{ ...invoerStijl, flex: 1 }}
        />
        <button
          type="button"
          className="focus-ring"
          disabled={!nieuw.trim()}
          onClick={() => toevoegen.mutate()}
          style={knopStijl}
        >
          Toevoegen
        </button>
      </div>
    </section>
  );
}

const invoerStijl: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--rand)',
  background: 'var(--oppervlak)',
  color: 'var(--inkt)',
  fontSize: 12,
  boxSizing: 'border-box',
};

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 10px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 12,
};
