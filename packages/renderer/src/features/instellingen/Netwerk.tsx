/**
 * Instellingen › Netwerkstand en updates (hoofdstuk 2.3 en 12).
 *
 * Twee dingen die alleen over déze werkplek gaan en dus in `config.json` van
 * de schil staan, niet in de database: of deze pc de host is, en waar de
 * installer vandaan komt. Een collega die dezelfde database gebruikt hoort daar
 * niets van te merken.
 */
import { useEffect, useState, type JSX } from 'react';
import type { AppInstellingen, Updateuitkomst } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';
import { dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';

export function Netwerk({ onTerug }: { onTerug: () => void }): JSX.Element {
  const [config, setConfig] = useState<AppInstellingen | null>(null);
  const [concept, setConcept] = useState<Partial<AppInstellingen>>({});
  const [update, setUpdate] = useState<Updateuitkomst | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    if (!window.showroom) return;
    void window.showroom
      .configLezen()
      .then(setConfig)
      .catch((error: unknown) =>
        setFout(error instanceof Error ? error.message : 'De instellingen konden niet worden gelezen.'),
      );
  }, []);

  if (!window.showroom) {
    return (
      <Terug onTerug={onTerug}>
        <Kaart>
          <p style={{ fontSize: 12, margin: 0 }}>
            De netwerkstand en de updatecontrole horen bij de desktop-applicatie. In de mobiele
            weergave via de hostmodus zijn ze niet in te stellen — dat doet u op de pc die de host
            is.
          </p>
        </Kaart>
      </Terug>
    );
  }

  const waarde = <K extends keyof AppInstellingen>(sleutel: K): AppInstellingen[K] | undefined =>
    (concept[sleutel] ?? config?.[sleutel]) as AppInstellingen[K] | undefined;

  async function opslaan(): Promise<void> {
    if (!window.showroom || Object.keys(concept).length === 0) return;
    setBezig(true);
    try {
      const uitkomst = await window.showroom.configSchrijven(concept);
      setFout(null);
      setMelding(
        uitkomst.herstartNodig
          ? 'Opgeslagen. Sluit de applicatie en start hem opnieuw om de nieuwe netwerkstand te gebruiken.'
          : 'Opgeslagen.',
      );
      setConcept({});
      setConfig(await window.showroom.configLezen());
    } catch (error) {
      setFout(error instanceof Error ? error.message : 'Opslaan lukte niet.');
    } finally {
      setBezig(false);
    }
  }

  async function controleer(): Promise<void> {
    if (!window.showroom) return;
    setBezig(true);
    try {
      setUpdate(await window.showroom.updateControleren());
      setFout(null);
    } catch (error) {
      setFout(error instanceof Error ? error.message : 'De controle is niet gelukt.');
    } finally {
      setBezig(false);
    }
  }

  const modus = waarde('mode') ?? 'standalone';
  const poort = waarde('port') ?? 4317;
  const adressen = config?.adressen ?? [];

  return (
    <Terug onTerug={onTerug}>
      <Kaart accent={modus === 'host' ? 'var(--belasting)' : undefined}>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Netwerkstand</h2>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.5 }}>
          <strong>Alleenstaand</strong> is de gewone stand: de applicatie luistert alleen op deze
          pc en niemand anders komt erbij. In <strong>hostmodus</strong> luistert hij ook op het
          bedrijfsnetwerk, zodat een collega of een telefoon in de browser mee kan kijken. De
          database blijft dan op déze pc staan — dat is de bedoeling, want een database op een
          netwerkschijf raakt beschadigd.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12 }}>
            Stand
            <select
              className="focus-ring"
              value={modus}
              onChange={(event) =>
                setConcept((huidig) => ({
                  ...huidig,
                  mode: event.target.value as AppInstellingen['mode'],
                }))
              }
              style={{ ...dialoogSelect, width: 200, marginTop: 3 }}
            >
              <option value="standalone">Alleenstaand (alleen deze pc)</option>
              <option value="host">Host (ook op het netwerk)</option>
            </select>
          </label>

          <label style={{ fontSize: 12 }}>
            Poort
            <input
              className="focus-ring"
              type="number"
              min={1024}
              max={65535}
              value={poort}
              onChange={(event) =>
                setConcept((huidig) => ({ ...huidig, port: Number(event.target.value) }))
              }
              style={{ ...invoerStijl, width: 110, marginTop: 3, display: 'block' }}
            />
          </label>
        </div>

        {modus === 'host' && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              Collega&apos;s typen dit in hun browser:
            </div>
            {adressen.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0 }}>
                Deze pc heeft geen netwerkadres. Zit de netwerkkabel erin?
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {adressen.map((adres) => (
                  <li key={adres}>
                    <code>
                      http://{adres}:{poort}
                    </code>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '8px 0 0', lineHeight: 1.5 }}>
              Iedereen logt in met zijn eigen account. Windows Firewall vraagt de eerste keer om
              toestemming voor de poort; dat moet u toestaan voor het <em>particuliere</em> netwerk.
            </p>
          </div>
        )}
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Deze werkplek</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              className="focus-ring"
              checked={waarde('minimiseToTray') === true}
              onChange={(event) =>
                setConcept((huidig) => ({ ...huidig, minimiseToTray: event.target.checked }))
              }
            />
            Bij sluiten naar het systeemvak in plaats van afsluiten
          </label>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              className="focus-ring"
              checked={waarde('autoStart') === true}
              onChange={(event) =>
                setConcept((huidig) => ({ ...huidig, autoStart: event.target.checked }))
              }
            />
            Automatisch starten bij het aanmelden in Windows
          </label>

          <p style={{ fontSize: 11, color: 'var(--inkt-zacht)', margin: '4px 0 0' }}>
            Versie {config?.versie ?? '…'} · gegevens in <code>{config?.gegevensmap ?? '…'}</code>
          </p>
        </div>
      </Kaart>

      <Kaart>
        <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Updates</h2>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.5 }}>
          De applicatie haalt niets op bij een leverancier. Wijs hier de map aan waar uw
          systeembeheerder de installer neerzet — meestal een map op de netwerkschijf. Blijft dit
          leeg, dan wordt er nooit ergens gekeken.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, flex: 1, minWidth: 260 }}>
            Map met de installer
            <input
              className="focus-ring"
              value={waarde('updateLocatie') ?? ''}
              placeholder="\\\\server\\software\\showroom"
              onChange={(event) =>
                setConcept((huidig) => ({ ...huidig, updateLocatie: event.target.value }))
              }
              style={{ ...invoerStijl, width: '100%', marginTop: 3, display: 'block' }}
            />
          </label>
          <button
            type="button"
            className="focus-ring"
            disabled={bezig}
            onClick={() => void controleer()}
            style={dialoogKnop}
          >
            Nu controleren
          </button>
        </div>

        {update !== null && <Updatestand uitkomst={update} />}
      </Kaart>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="focus-ring"
          disabled={bezig || Object.keys(concept).length === 0}
          onClick={() => void opslaan()}
          style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', borderColor: 'transparent' }}
        >
          Opslaan
        </button>
        {melding !== null && (
          <span style={{ fontSize: 12, color: 'var(--belasting)' }}>{melding}</span>
        )}
        {fout !== null && <span style={{ fontSize: 12, color: 'var(--ziekte)' }}>{fout}</span>}
      </div>
    </Terug>
  );
}

function Updatestand({ uitkomst }: { uitkomst: Updateuitkomst }): JSX.Element {
  if (!uitkomst.ingeschakeld) {
    return (
      <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '10px 0 0' }}>
        Er is geen locatie ingesteld, dus er is nergens gekeken.
      </p>
    );
  }

  if (uitkomst.fout !== null && !uitkomst.nieuwerBeschikbaar) {
    return (
      <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: '10px 0 0' }}>{uitkomst.fout}</p>
    );
  }

  if (!uitkomst.nieuwerBeschikbaar) {
    return (
      <p style={{ fontSize: 12, color: 'var(--belasting)', margin: '10px 0 0' }}>
        U draait versie {uitkomst.huidigeVersie}; dat is de nieuwste die er staat.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      <p style={{ margin: '0 0 4px' }}>
        <strong>Versie {uitkomst.nieuwsteVersie} staat klaar</strong> (u draait{' '}
        {uitkomst.huidigeVersie}
        {uitkomst.uitgebracht === null ? '' : `, uitgebracht ${uitkomst.uitgebracht}`}).
      </p>
      {uitkomst.opmerkingen !== null && (
        <p style={{ margin: '0 0 8px', color: 'var(--inkt-zacht)' }}>{uitkomst.opmerkingen}</p>
      )}
      {uitkomst.fout !== null && (
        <p style={{ margin: '0 0 8px', color: 'var(--ziekte)' }}>{uitkomst.fout}</p>
      )}
      {uitkomst.installer !== null && (
        <>
          <button
            type="button"
            className="focus-ring"
            onClick={() => void window.showroom?.installerTonen(uitkomst.installer ?? '')}
            style={dialoogKnop}
          >
            Toon het installatiebestand
          </button>
          <p style={{ margin: '8px 0 0', color: 'var(--inkt-zacht)', lineHeight: 1.5 }}>
            Sluit de applicatie en dubbelklik het bestand. De installatie is per gebruiker, dus u
            hebt er geen beheerdersrechten voor nodig. Uw gegevens blijven staan.
          </p>
        </>
      )}
    </div>
  );
}

function Terug({
  onTerug,
  children,
}: {
  onTerug: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Netwerk &amp; updates</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
      </div>
      {children}
    </div>
  );
}
