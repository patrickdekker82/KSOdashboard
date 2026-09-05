/**
 * Instellingen › AI (hoofdstuk 6.8).
 *
 * Drie tabbladen: de sleutel (aan/uit), de presets (wat de assistent mag doen
 * en wat er meegaat) en het logboek (wat er gedraaid heeft en wat het kostte).
 *
 * De toon is met opzet nuchter. Dit is de enige externe koppeling van de
 * applicatie, dus de beheerder moet in één scherm kunnen zien wat er aan staat
 * en wat dat betekent.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints, type AiPreset } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';
import { dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';
import { toonKosten } from './AiDialoog.tsx';

type Tab = 'sleutel' | 'presets' | 'logboek';

export function AiInstellingen({ onTerug }: { onTerug: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('sleutel');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>AI-assistent</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {(
          [
            ['sleutel', 'Koppeling'],
            ['presets', 'Presets'],
            ['logboek', 'Logboek'],
          ] as Array<[Tab, string]>
        ).map(([sleutel, label]) => (
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

      {tab === 'sleutel' && <Koppeling />}
      {tab === 'presets' && <Presets />}
      {tab === 'logboek' && <Logboek />}
    </div>
  );
}

function Koppeling(): JSX.Element {
  const queryClient = useQueryClient();
  const [sleutel, setSleutel] = useState('');
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => endpoints.aiStatus() });

  const opslaan = useMutation({
    mutationFn: (waarde: string) => endpoints.aiSleutel(waarde),
    onSuccess: (antwoord) => {
      setSleutel('');
      setFout(null);
      setMelding(
        antwoord.data.ingeschakeld
          ? 'De sleutel is versleuteld opgeslagen. De assistent staat aan.'
          : 'De sleutel is gewist. De assistent staat uit en er gaat niets meer naar buiten.',
      );
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  const aan = status.data?.data.ingeschakeld === true;

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
      <Kaart accent={aan ? 'var(--belasting)' : undefined}>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>
          De assistent staat {aan ? 'aan' : 'uit'}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.5 }}>
          Deze applicatie werkt verder volledig op deze computer. De AI-assistent is de enige
          uitzondering: die stuurt tekst naar een dienst van Anthropic. Zonder API-sleutel gebeurt
          dat niet, en dat is de stand waarin de applicatie geleverd wordt.
        </p>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.5 }}>
          Wat er meegaat is bij elke preset in te stellen. Bij presets met anonimiseren aan worden
          namen, adressen, e-mailadressen, telefoonnummers en rekeningnummers vervangen door
          plaatshouders vóórdat het verzoek weggaat; het antwoord wordt hier weer ingevuld.
          Vindt de controle achteraf tóch nog een persoonsgegeven, dan gaat het verzoek niet weg.
        </p>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.5 }}>
          De sleutel wordt versleuteld opgeslagen (AES-256-GCM), met de sleutel in een apart
          bestand naast de database. Een back-up van de database alléén levert hem dus niet op.
        </p>
      </Kaart>

      <Kaart>
        <label style={{ display: 'block', fontSize: 12 }}>
          API-sleutel
          <input
            className="focus-ring"
            type="password"
            autoComplete="off"
            value={sleutel}
            placeholder={aan ? 'Er staat een sleutel — typ hier een nieuwe' : 'sk-ant-…'}
            onChange={(event) => setSleutel(event.target.value)}
            style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="focus-ring"
            disabled={sleutel.trim() === '' || opslaan.isPending}
            onClick={() => opslaan.mutate(sleutel.trim())}
            style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
          >
            Sleutel opslaan
          </button>
          {aan && (
            <button
              type="button"
              className="focus-ring"
              disabled={opslaan.isPending}
              onClick={() => opslaan.mutate('')}
              style={dialoogKnop}
            >
              Sleutel wissen en de assistent uitzetten
            </button>
          )}
        </div>

        {melding !== null && (
          <p style={{ fontSize: 12, color: 'var(--belasting)', margin: '10px 0 0' }}>{melding}</p>
        )}
        {fout !== null && (
          <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: '10px 0 0' }}>{fout}</p>
        )}

        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '12px 0 0' }}>
          Beschikbare modellen:{' '}
          {(status.data?.data.modellen ?? [])
            .map((model) => `${model.id}${model.prijsBekend ? '' : ' (prijs onbekend)'}`)
            .join(', ') || '—'}
        </p>
      </Kaart>
    </div>
  );
}

function Presets(): JSX.Element {
  const queryClient = useQueryClient();
  const [fout, setFout] = useState<string | null>(null);

  const presets = useQuery({ queryKey: ['ai-presets'], queryFn: () => endpoints.aiPresets() });
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => endpoints.aiStatus() });

  const opslaan = useMutation({
    mutationFn: ({ id, wijziging }: { id: number; wijziging: Record<string, unknown> }) =>
      endpoints.aiPresetOpslaan(id, wijziging),
    onSuccess: () => {
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-presets'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  const blokken = status.data?.data.contextblokken ?? [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {fout !== null && <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: 0 }}>{fout}</p>}

      {(presets.data?.data ?? []).map((preset) => (
        <Presetkaart
          key={preset.id}
          preset={preset}
          blokken={blokken}
          bezig={opslaan.isPending}
          onOpslaan={(wijziging) => opslaan.mutate({ id: preset.id, wijziging })}
        />
      ))}

      {presets.isSuccess && presets.data.data.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>Er zijn nog geen presets.</p>
      )}
    </div>
  );
}

function Presetkaart({
  preset,
  blokken,
  bezig,
  onOpslaan,
}: {
  preset: AiPreset;
  blokken: string[];
  bezig: boolean;
  onOpslaan: (wijziging: Record<string, unknown>) => void;
}): JSX.Element {
  const [systeem, setSysteem] = useState(preset.systeemPrompt);
  const [sjabloon, setSjabloon] = useState(preset.gebruikersSjabloon);

  const gewijzigd = systeem !== preset.systeemPrompt || sjabloon !== preset.gebruikersSjabloon;

  return (
    <Kaart accent={preset.actief ? 'var(--belasting)' : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>
          {preset.naam}
          {preset.categorie !== null && (
            <span style={{ fontSize: 11, color: 'var(--inkt-zacht)', fontWeight: 400 }}>
              {' '}
              · {preset.categorie}
            </span>
          )}
        </h2>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            className="focus-ring"
            checked={preset.actief}
            disabled={bezig}
            onChange={(event) => onOpslaan({ actief: event.target.checked })}
          />
          Beschikbaar in de assistent
        </label>
      </div>

      <label style={{ display: 'block', fontSize: 12, marginTop: 10 }}>
        Instructie aan het model
        <textarea
          className="focus-ring"
          rows={3}
          value={systeem}
          onChange={(event) => setSysteem(event.target.value)}
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      <label style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
        Vraag (plaatshouders zoals <code>{'{{gebruiker.naam}}'}</code> worden ingevuld)
        <textarea
          className="focus-ring"
          rows={2}
          value={sjabloon}
          onChange={(event) => setSjabloon(event.target.value)}
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
        <legend style={{ fontSize: 12, padding: 0 }}>Wat er meegaat uit het dossier</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          {blokken.map((blok) => (
            <label key={blok} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="checkbox"
                className="focus-ring"
                checked={preset.context.includes(blok)}
                disabled={bezig}
                onChange={(event) =>
                  onOpslaan({
                    context: event.target.checked
                      ? [...preset.context, blok]
                      : preset.context.filter((entry) => entry !== blok),
                  })
                }
              />
              {blok}
            </label>
          ))}
        </div>
      </fieldset>

      <label
        style={{
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          color: preset.anonimiseren ? undefined : 'var(--ziekte)',
        }}
      >
        <input
          type="checkbox"
          className="focus-ring"
          checked={preset.anonimiseren}
          disabled={bezig}
          onChange={(event) => onOpslaan({ anonimiseren: event.target.checked })}
        />
        Persoonsgegevens vervangen door plaatshouders voordat het verzoek weggaat
        {!preset.anonimiseren && ' — staat uit, de gegevens gaan onbewerkt mee'}
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="focus-ring"
          disabled={!gewijzigd || bezig}
          onClick={() => onOpslaan({ systeemPrompt: systeem, gebruikersSjabloon: sjabloon })}
          style={dialoogKnop}
        >
          Tekst opslaan
        </button>
        <span style={{ fontSize: 11, color: 'var(--inkt-zacht)' }}>
          {preset.model} · maximaal {preset.maxTokens.toLocaleString('nl-NL')} tokens antwoord
        </span>
      </div>
    </Kaart>
  );
}

function Logboek(): JSX.Element {
  const logboek = useQuery({ queryKey: ['ai-runs'], queryFn: () => endpoints.aiLogboek() });

  if (logboek.isLoading) {
    return <p style={{ fontSize: 12, color: 'var(--inkt-zacht)' }}>Bezig met laden…</p>;
  }
  if (logboek.error instanceof ApiFout) {
    return <p style={{ fontSize: 12, color: 'var(--ziekte)' }}>{logboek.error.message}</p>;
  }

  const maanden = logboek.data?.meta.perMaand ?? [];
  const regels = logboek.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Verbruik per maand</h2>
        {maanden.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0 }}>
            De assistent heeft nog niet gedraaid.
          </p>
        ) : (
          <Tabel
            koppen={['Maand', 'Aanroepen', 'Tokens in', 'Tokens uit', 'Kosten', 'Fouten']}
            rijen={maanden.map((maand) => [
              maand.maand,
              maand.aanroepen.toLocaleString('nl-NL'),
              Number(maand.invoer ?? 0).toLocaleString('nl-NL'),
              Number(maand.uitvoer ?? 0).toLocaleString('nl-NL'),
              toonKosten(Number(maand.centen ?? 0)),
              String(maand.fouten ?? 0),
            ])}
          />
        )}
        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
          De bedragen zijn een raming in dollars, op basis van de tokenprijzen van het model. Er
          wordt geen wisselkoers verzonnen; de factuur van de leverancier is leidend.
        </p>
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Laatste aanroepen</h2>
        {regels.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0 }}>Nog niets.</p>
        ) : (
          <Tabel
            koppen={['Wanneer', 'Wie', 'Wat', 'Model', 'Tokens', 'Kosten', 'Status']}
            rijen={regels.map((regel) => [
              regel.created_at.slice(0, 16).replace('T', ' '),
              regel.gebruiker_naam ?? '—',
              regel.prompt_summary ?? '—',
              regel.model,
              `${regel.input_tokens.toLocaleString('nl-NL')} / ${regel.output_tokens.toLocaleString('nl-NL')}`,
              toonKosten(regel.cost_estimate_cents),
              regel.status === 'ok' ? 'gelukt' : (regel.error ?? 'fout'),
            ])}
          />
        )}
        <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
          Er wordt bewust geen promptinhoud bewaard: die bevat klantgegevens. Wél de preset, het
          record en wat het gekost heeft.
        </p>
      </Kaart>
    </div>
  );
}

function Tabel({ koppen, rijen }: { koppen: string[]; rijen: string[][] }): JSX.Element {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            {koppen.map((kop) => (
              <th
                key={kop}
                scope="col"
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid var(--rand)',
                  padding: '4px 8px 4px 0',
                  color: 'var(--inkt-zacht)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {kop}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rijen.map((rij, index) => (
            <tr key={`${rij[0] ?? ''}-${index}`}>
              {rij.map((cel, kolom) => (
                <td
                  key={kolom}
                  style={{
                    borderBottom: '1px solid var(--rand)',
                    padding: '4px 8px 4px 0',
                    whiteSpace: kolom === 2 ? 'normal' : 'nowrap',
                  }}
                >
                  {cel}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
