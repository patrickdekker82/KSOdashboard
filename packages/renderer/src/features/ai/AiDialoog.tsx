/**
 * De AI-assistent bij een record (hoofdstuk 6.8).
 *
 * Dit is het enige scherm in de hele applicatie waar gegevens de computer
 * verlaten. Daarom staat er hier meer uitleg dan elders, en daarom zit de knop
 * "Bekijk wat er weggaat" er vóór de knop die het echt verstuurt: wie wil
 * weten wat er precies naar buiten gaat, kan dat letterlijk lezen.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ApiFout,
  endpoints,
  type AiUitvoering,
  type AiVoorbeeld,
} from '../../lib/api.ts';
import { Dialoog, dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';

/** Entiteiten waar de assistent iets zinnigs over kan zeggen. */
export const AI_ENTITEITEN = new Set([
  'organizations',
  'contacts',
  'projects',
  'opportunities',
  'package-quotes',
]);

export function AiDialoog({
  entiteit,
  recordId,
  onSluit,
}: {
  entiteit: string;
  recordId: number;
  onSluit: () => void;
}): JSX.Element {
  const [presetId, setPresetId] = useState(0);
  const [aanvulling, setAanvulling] = useState('');
  const [voorbeeld, setVoorbeeld] = useState<AiVoorbeeld | null>(null);
  const [uitkomst, setUitkomst] = useState<AiUitvoering | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => endpoints.aiStatus() });
  const presets = useQuery({
    queryKey: ['ai-presets', 'actief'],
    queryFn: () => endpoints.aiPresets(true),
  });

  const opdracht = { presetId, entity: entiteit, recordId, aanvulling };

  const kijken = useMutation({
    mutationFn: () => endpoints.aiVoorbeeld(opdracht),
    onSuccess: (antwoord) => {
      setVoorbeeld(antwoord.data);
      setFout(null);
    },
    onError: (error: unknown) => meldFout(error, setFout),
  });

  const uitvoeren = useMutation({
    mutationFn: () => endpoints.aiUitvoeren(opdracht),
    onSuccess: (antwoord) => {
      setUitkomst(antwoord.data);
      setFout(null);
    },
    onError: (error: unknown) => meldFout(error, setFout),
  });

  const aan = status.data?.data.ingeschakeld === true;
  const lijst = presets.data?.data ?? [];
  const gekozen = lijst.find((preset) => preset.id === presetId);
  const bezig = kijken.isPending || uitvoeren.isPending;

  return (
    <Dialoog titel="Assistent" onSluit={onSluit}>
      {!aan && (
        <Waarschuwing>
          De assistent staat uit. Een beheerder kan bij <strong>Instellingen › AI</strong> een
          API-sleutel invullen. Zonder sleutel verlaat er niets deze computer.
        </Waarschuwing>
      )}

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Wat moet de assistent doen?
        <select
          className="focus-ring"
          value={presetId}
          onChange={(event) => {
            setPresetId(Number(event.target.value));
            setVoorbeeld(null);
            setUitkomst(null);
          }}
          style={{ ...dialoogSelect, marginTop: 3 }}
        >
          <option value={0}>— kies een preset —</option>
          {lijst.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.categorie === null ? preset.naam : `${preset.categorie} · ${preset.naam}`}
            </option>
          ))}
        </select>
      </label>

      {gekozen && (
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 12px' }}>
          {gekozen.omschrijving ?? gekozen.systeemPrompt.slice(0, 160)}
          <br />
          {gekozen.anonimiseren ? (
            <strong style={{ color: 'var(--belasting)' }}>
              Namen, adressen, e-mailadressen en telefoonnummers worden vervangen door
              plaatshouders voordat het verzoek weggaat.
            </strong>
          ) : (
            <strong style={{ color: 'var(--ziekte)' }}>
              Let op: bij deze preset staat het anonimiseren uit. De gegevens gaan onbewerkt mee.
            </strong>
          )}
        </p>
      )}

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Aanvulling (optioneel)
        <textarea
          className="focus-ring"
          rows={3}
          value={aanvulling}
          placeholder="Bijvoorbeeld: noem dat de levertijd is opgelopen tot acht weken."
          onChange={(event) => setAanvulling(event.target.value)}
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="focus-ring"
          disabled={presetId === 0 || bezig}
          onClick={() => kijken.mutate()}
          style={dialoogKnop}
        >
          Bekijk wat er weggaat
        </button>
        <button
          type="button"
          className="focus-ring"
          disabled={presetId === 0 || bezig || !aan}
          onClick={() => uitvoeren.mutate()}
          style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
        >
          {uitvoeren.isPending ? 'Bezig…' : 'Uitvoeren'}
        </button>
      </div>

      {fout !== null && <Waarschuwing rood>{fout}</Waarschuwing>}
      {melding !== null && (
        <p style={{ fontSize: 12, color: 'var(--belasting)', marginTop: 10 }}>{melding}</p>
      )}

      {voorbeeld !== null && uitkomst === null && (
        <section style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Dit gaat er naar de dienst</h3>
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 8px' }}>
            Model {voorbeeld.model}. {voorbeeld.vervangen.length} gegeven
            {voorbeeld.vervangen.length === 1 ? '' : 's'} vervangen door een plaatshouder.
            {voorbeeld.ontbrekend.length > 0 &&
              ` Niet ingevuld: ${voorbeeld.ontbrekend.join(', ')}.`}
          </p>
          <Blok tekst={voorbeeld.systeem} kop="Instructie" />
          <Blok tekst={voorbeeld.gebruiker} kop="Vraag" />
        </section>
      )}

      {uitkomst !== null && (
        <section style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Voorstel</h3>
          <textarea
            className="focus-ring"
            rows={12}
            value={uitkomst.tekst}
            onChange={(event) => setUitkomst({ ...uitkomst, tekst: event.target.value })}
            style={{ ...invoerStijl, width: '100%', resize: 'vertical' }}
          />
          <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '6px 0 0' }}>
            {uitkomst.invoertokens.toLocaleString('nl-NL')} in ·{' '}
            {uitkomst.uitvoertokens.toLocaleString('nl-NL')} uit ·{' '}
            {uitkomst.kostenCenten === null
              ? 'kosten onbekend'
              : `circa ${toonKosten(uitkomst.kostenCenten)}`}{' '}
            · {(uitkomst.duurMs / 1000).toFixed(1)} s · {uitkomst.vervangen} gegevens vervangen
          </p>

          {uitkomst.onbekend.length > 0 && (
            <Waarschuwing rood>
              Er staan plaatshouders in de tekst die hier niet bekend zijn (
              {uitkomst.onbekend.join(', ')}). Die zijn door het model verzonnen — lees de tekst
              goed na voordat u hem gebruikt.
            </Waarschuwing>
          )}

          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', marginTop: 10 }}>
            Dit is een voorstel, geen eindtekst. Lees het na voordat u het naar een klant stuurt.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => {
                void navigator.clipboard
                  .writeText(uitkomst.tekst)
                  .then(() => setMelding('Naar het klembord gekopieerd.'))
                  .catch(() => setFout('Kopiëren lukte niet.'));
              }}
              style={dialoogKnop}
            >
              Kopieer de tekst
            </button>
            <button
              type="button"
              className="focus-ring"
              onClick={() => {
                setUitkomst(null);
                setVoorbeeld(null);
              }}
              style={dialoogKnop}
            >
              Opnieuw
            </button>
          </div>
        </section>
      )}
    </Dialoog>
  );
}

function meldFout(error: unknown, zet: (melding: string) => void): void {
  zet(error instanceof ApiFout ? error.message : 'De assistent kon dit niet uitvoeren.');
}

function Waarschuwing({
  children,
  rood = false,
}: {
  children: React.ReactNode;
  rood?: boolean;
}): JSX.Element {
  return (
    <p
      style={{
        fontSize: 12,
        margin: '0 0 12px',
        padding: '8px 10px',
        borderRadius: 6,
        border: `1px solid ${rood ? 'var(--ziekte)' : 'var(--rand)'}`,
        color: rood ? 'var(--ziekte)' : 'var(--inkt-zacht)',
        background: 'var(--vlak)',
      }}
    >
      {children}
    </p>
  );
}

function Blok({ kop, tekst }: { kop: string; tekst: string }): JSX.Element {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--inkt-zacht)', marginBottom: 3 }}>{kop}</div>
      <pre
        style={{
          margin: 0,
          padding: 8,
          background: 'var(--vlak)',
          border: '1px solid var(--rand)',
          borderRadius: 6,
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 220,
          overflow: 'auto',
        }}
      >
        {tekst === '' ? '(leeg)' : tekst}
      </pre>
    </div>
  );
}

/** `1234` → `US$ 12,34`. De prijzen zijn in dollar; er wordt geen koers verzonnen. */
export function toonKosten(centen: number): string {
  const heel = Math.trunc(centen / 100);
  const rest = String(Math.abs(centen) % 100).padStart(2, '0');
  return `US$ ${heel.toLocaleString('nl-NL')},${rest}`;
}
