/**
 * Het beginwachtwoord wijzigen (hoofdstuk 10).
 *
 * De installatie zet accounts klaar met een wachtwoord dat in de handleiding
 * staat. Zolang dat niet gewijzigd is, laat de kern niets anders toe dan dit
 * scherm — en in de hostmodus is dat het verschil tussen een applicatie op het
 * kantoornetwerk en een applicatie op het kantoornetwerk met een wachtwoord dat
 * iedereen kan opzoeken.
 */
import { useState, type JSX } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiFout, endpoints, type Gebruiker } from '../lib/api.ts';

export function Wachtwoord({
  gebruiker,
  onGewijzigd,
}: {
  gebruiker: Gebruiker;
  onGewijzigd: () => void;
}): JSX.Element {
  const [huidig, setHuidig] = useState('');
  const [nieuw, setNieuw] = useState('');
  const [herhaling, setHerhaling] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const wijzigen = useMutation({
    mutationFn: () => endpoints.wachtwoordWijzigen(huidig, nieuw),
    onSuccess: onGewijzigd,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Het wijzigen is niet gelukt.'),
  });

  const gelijk = nieuw !== '' && nieuw === herhaling;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'var(--oppervlak)',
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFout(null);
          if (!gelijk) {
            setFout('De twee nieuwe wachtwoorden zijn niet gelijk.');
            return;
          }
          wijzigen.mutate();
        }}
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          padding: 24,
          display: 'grid',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 17, margin: 0 }}>Kies eerst een eigen wachtwoord</h1>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.5 }}>
          Dit account ({gebruiker.email}) gebruikt nog het wachtwoord van de installatie. Dat
          wachtwoord staat in de handleiding en is dus voor iedereen te vinden. Kies een eigen
          wachtwoord van minimaal twaalf tekens, met hoofdletters, kleine letters en een cijfer.
        </p>

        <label style={{ fontSize: 12 }}>
          Huidig wachtwoord
          <input
            className="focus-ring"
            type="password"
            autoComplete="current-password"
            value={huidig}
            onChange={(event) => setHuidig(event.target.value)}
            style={veld}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Nieuw wachtwoord
          <input
            className="focus-ring"
            type="password"
            autoComplete="new-password"
            value={nieuw}
            onChange={(event) => setNieuw(event.target.value)}
            style={veld}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          Nieuw wachtwoord nogmaals
          <input
            className="focus-ring"
            type="password"
            autoComplete="new-password"
            value={herhaling}
            onChange={(event) => setHerhaling(event.target.value)}
            style={{
              ...veld,
              borderColor:
                herhaling === '' || gelijk ? 'var(--rand)' : 'var(--ziekte)',
            }}
          />
        </label>

        {fout !== null && (
          <p style={{ fontSize: 12, color: 'var(--ziekte)', margin: 0 }}>{fout}</p>
        )}

        <button
          type="submit"
          className="focus-ring"
          disabled={huidig === '' || !gelijk || wijzigen.isPending}
          style={{
            background: 'var(--belasting)',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            padding: '9px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {wijzigen.isPending ? 'Bezig…' : 'Wachtwoord wijzigen'}
        </button>
      </form>
    </main>
  );
}

const veld: React.CSSProperties = {
  width: '100%',
  marginTop: 3,
  padding: '7px 9px',
  borderRadius: 6,
  border: '1px solid var(--rand)',
  background: 'var(--oppervlak)',
  color: 'var(--inkt)',
  fontSize: 13,
};
