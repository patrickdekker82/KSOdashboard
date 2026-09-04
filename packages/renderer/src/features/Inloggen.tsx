import { useState, type FormEvent } from 'react';
import { ApiFout, endpoints } from '../lib/api.ts';
import type { CSSProperties, JSX } from 'react';

export function Inloggen({ onIngelogd }: { onIngelogd: () => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function verzenden(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      await endpoints.inloggen(email, wachtwoord);
      onIngelogd();
    } catch (error) {
      setFout(
        error instanceof ApiFout ? error.message : 'Inloggen lukte niet. Probeer het opnieuw.',
      );
    } finally {
      setBezig(false);
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form
        onSubmit={(event) => void verzenden(event)}
        style={{
          width: 340,
          background: 'var(--oppervlak-2)',
          border: '1px solid var(--rand)',
          borderRadius: 10,
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Showroom Suite</h1>
        <p style={{ color: 'var(--inkt-zacht)', margin: '0 0 20px', fontSize: 13 }}>
          Log in om verder te gaan.
        </p>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }} htmlFor="email">
          E-mailadres
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="focus-ring"
          style={veldStijl}
        />

        <label
          style={{ display: 'block', fontSize: 13, margin: '14px 0 4px' }}
          htmlFor="wachtwoord"
        >
          Wachtwoord
        </label>
        <input
          id="wachtwoord"
          type="password"
          autoComplete="current-password"
          required
          value={wachtwoord}
          onChange={(event) => setWachtwoord(event.target.value)}
          className="focus-ring"
          style={veldStijl}
        />

        {fout && (
          <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginTop: 14 }}>
            {fout}
          </p>
        )}

        <button
          type="submit"
          disabled={bezig}
          className="focus-ring"
          style={{
            width: '100%',
            marginTop: 20,
            padding: '9px 16px',
            borderRadius: 6,
            border: 0,
            background: 'var(--belasting)',
            color: '#fff',
            fontSize: 14,
            cursor: bezig ? 'progress' : 'pointer',
            opacity: bezig ? 0.7 : 1,
          }}
        >
          {bezig ? 'Bezig met inloggen...' : 'Inloggen'}
        </button>
      </form>
    </div>
  );
}

const veldStijl: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--rand)',
  background: 'var(--oppervlak)',
  color: 'var(--inkt)',
  boxSizing: 'border-box',
};
