import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiFout, endpoints, type Gebruiker } from './lib/api.ts';
import { ROUTES, useRoute } from './lib/routes.ts';
import { Inloggen } from './features/Inloggen.tsx';
import { Dashboard } from './features/Dashboard.tsx';
import { Planning } from './features/Planning.tsx';
import { Verlof } from './features/verlof/Verlof.tsx';
import { NogTeBouwen } from './features/NogTeBouwen.tsx';
import { GeneriekeLijst } from './features/generiek/GeneriekeLijst.tsx';
import { GeneriekDetail } from './features/generiek/GeneriekDetail.tsx';
import { Velden } from './features/instellingen/Velden.tsx';
import { Regels } from './features/signaleringen/Regels.tsx';
import { Instellingen } from './features/instellingen/Instellingen.tsx';
import { VandaagBeschikbaar } from './components/VandaagBeschikbaar.tsx';
import { Zoekbalk } from './components/Zoekbalk.tsx';
import { Dubbelen } from './features/crm/Dubbelen.tsx';
import { Kansenbord } from './features/kansen/Kansenbord.tsx';
import { KansDetail } from './features/kansen/KansDetail.tsx';
import { Pijplijnrapport } from './features/kansen/Pijplijnrapport.tsx';
import { Importwizard } from './features/projecten/Importwizard.tsx';
import { Projectfasen } from './features/projecten/Projectfasen.tsx';
import type { JSX } from 'react';

export function App(): JSX.Element {
  const [pad, navigeer] = useRoute();

  const ik = useQuery({
    queryKey: ['ik'],
    queryFn: () => endpoints.ik(),
    retry: false,
  });

  if (ik.isLoading) {
    return <Bezig tekst="Verbinden met de kern..." />;
  }

  if (ik.error instanceof ApiFout && (ik.error.status === 401 || ik.error.status === 403)) {
    return <Inloggen onIngelogd={() => void ik.refetch()} />;
  }

  if (ik.error) {
    return (
      <Storing
        melding={ik.error instanceof Error ? ik.error.message : 'Onbekende fout'}
        opnieuw={() => void ik.refetch()}
      />
    );
  }

  const gebruiker = ik.data!.gebruiker;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Zijbalk pad={pad} navigeer={navigeer} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Bovenbalk
          gebruiker={gebruiker}
          onUitloggen={() => void ik.refetch()}
          navigeer={navigeer}
        />
        <main style={{ padding: 20, flex: 1, minWidth: 0 }}>
          <Inhoud pad={pad} navigeer={navigeer} gebruiker={gebruiker} />
        </main>
      </div>
    </div>
  );
}

/** Entiteiten die via de generieke lijst en detailpagina lopen. */
const GENERIEK: Record<string, { entiteit: string; titel: string }> = {
  '/klanten': { entiteit: 'organizations', titel: 'Klanten' },
  '/contactpersonen': { entiteit: 'contacts', titel: 'Contactpersonen' },
};

/** Leest het record-id uit een pad als `/kansen/12`. Geeft `null` bij `/kansen`. */
function recordId(pad: string, basis: string): number | null {
  const rest = pad.slice(basis.length).replace(/^\//, '');
  const id = Number(rest);
  return rest !== '' && Number.isInteger(id) && id > 0 ? id : null;
}

function Inhoud({
  pad,
  navigeer,
  gebruiker,
}: {
  pad: string;
  navigeer: (pad: string) => void;
  gebruiker: Gebruiker;
}): JSX.Element {
  if (pad.startsWith('/dashboard')) return <Dashboard navigeer={navigeer} />;
  if (pad.startsWith('/planning')) return <Planning />;
  if (pad.startsWith('/verlof')) return <Verlof ik={gebruiker} />;
  if (pad.startsWith('/instellingen/velden')) return <Velden />;
  if (pad.startsWith('/instellingen/signaleringen'))
    return <Regels onTerug={() => navigeer('/instellingen')} />;
  if (pad.startsWith('/dubbelen')) return <Dubbelen navigeer={navigeer} />;
  if (pad.startsWith('/rapportages')) return <Pijplijnrapport />;

  // De planningimport hangt onder projecten: het is de snelste weg van een
  // Excel-planning naar de bezetting.
  if (pad.startsWith('/projecten/import')) return <Importwizard navigeer={navigeer} />;

  if (pad.startsWith('/projecten')) {
    const id = recordId(pad, '/projecten');
    return id === null ? (
      <GeneriekeLijst
        entiteit="projects"
        titel="Projecten"
        onOpen={(projectId) => navigeer(`/projecten/${projectId}`)}
        acties={
          <button
            type="button"
            className="focus-ring"
            onClick={() => navigeer('/projecten/import')}
            style={{
              background: 'transparent',
              border: '1px solid var(--rand)',
              borderRadius: 6,
              padding: '5px 12px',
              color: 'var(--inkt-zacht)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Planning importeren…
          </button>
        }
      />
    ) : (
      <GeneriekDetail
        entiteit="projects"
        id={id}
        titel="Projecten"
        onTerug={() => navigeer('/projecten')}
        extra={<Projectfasen projectId={id} />}
      />
    );
  }

  // Kansen hebben een eigen bord en een eigen detailpagina met disciplineregels.
  // De generieke lijst blijft bereikbaar, want daar zitten de filters en de
  // opgeslagen weergaven die een bord niet kan bieden.
  if (pad.startsWith('/kansen/lijst')) {
    return (
      <GeneriekeLijst
        entiteit="opportunities"
        titel="Kansen"
        onOpen={(kansId) => navigeer(`/kansen/${kansId}`)}
      />
    );
  }
  if (pad.startsWith('/kansen')) {
    const id = recordId(pad, '/kansen');
    return id === null ? (
      <Kansenbord
        onOpen={(kansId) => navigeer(`/kansen/${kansId}`)}
        onLijst={() => navigeer('/kansen/lijst')}
      />
    ) : (
      <KansDetail id={id} onTerug={() => navigeer('/kansen')} navigeer={navigeer} />
    );
  }

  if (pad.startsWith('/instellingen')) return <Instellingen navigeer={navigeer} />;

  for (const [basis, opzet] of Object.entries(GENERIEK)) {
    if (!pad.startsWith(basis)) continue;
    const id = recordId(pad, basis);
    if (id !== null) {
      return (
        <GeneriekDetail
          entiteit={opzet.entiteit}
          id={id}
          titel={opzet.titel}
          onTerug={() => navigeer(basis)}
        />
      );
    }
    return (
      <GeneriekeLijst
        entiteit={opzet.entiteit}
        titel={opzet.titel}
        onOpen={(recordId) => navigeer(`${basis}/${recordId}`)}
      />
    );
  }

  const route = ROUTES.find((entry) => pad.startsWith(entry.pad));
  return <NogTeBouwen titel={route?.label ?? 'Onbekend scherm'} pad={route?.pad ?? pad} />;
}

function Zijbalk({
  pad,
  navigeer,
}: {
  pad: string;
  navigeer: (pad: string) => void;
}): JSX.Element {
  const [ingeklapt, setIngeklapt] = useState(false);

  return (
    <nav
      aria-label="Hoofdnavigatie"
      style={{
        width: ingeklapt ? 56 : 208,
        flexShrink: 0,
        background: 'var(--oppervlak-2)',
        borderRight: '1px solid var(--rand)',
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        transition: 'width 120ms ease',
      }}
    >
      <button
        type="button"
        className="focus-ring"
        aria-label={ingeklapt ? 'Menu uitklappen' : 'Menu inklappen'}
        onClick={() => setIngeklapt((huidig) => !huidig)}
        style={{
          background: 'transparent',
          border: 0,
          color: 'var(--inkt-zacht)',
          cursor: 'pointer',
          textAlign: 'left',
          padding: '6px 8px',
          marginBottom: 8,
          fontWeight: 600,
        }}
      >
        {ingeklapt ? '»' : '« Showroom Suite'}
      </button>

      {ROUTES.map((route, index) => {
        const actief = pad.startsWith(route.pad);
        const nieuweGroep = index > 0 && ROUTES[index - 1]!.groep !== route.groep;
        return (
          <div key={route.pad}>
            {nieuweGroep && (
              <hr style={{ border: 0, borderTop: '1px solid var(--rand)', margin: '8px 4px' }} />
            )}
            <a
              href={`#${route.pad}`}
              className="focus-ring"
              aria-current={actief ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigeer(route.pad);
              }}
              style={{
                display: 'block',
                padding: '7px 10px',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 13,
                color: actief ? 'var(--inkt)' : 'var(--inkt-zacht)',
                background: actief ? 'var(--rand)' : 'transparent',
                fontWeight: actief ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
              title={route.label}
            >
              {ingeklapt ? route.label.slice(0, 1) : route.label}
            </a>
          </div>
        );
      })}
    </nav>
  );
}

function Bovenbalk({
  gebruiker,
  onUitloggen,
  navigeer,
}: {
  gebruiker: Gebruiker;
  onUitloggen: () => void;
  navigeer: (pad: string) => void;
}): JSX.Element {
  const [versie, setVersie] = useState('');

  useEffect(() => {
    void window.showroom?.appVersie().then(setVersie);
  }, []);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 20px',
        borderBottom: '1px solid var(--rand)',
        background: 'var(--oppervlak-2)',
      }}
    >
      <Zoekbalk navigeer={navigeer} />

      {/* Rechtsboven in een oogopslag wie er vandaag is (hoofdstuk 9). */}
      <VandaagBeschikbaar />

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {versie && (
          <span style={{ color: 'var(--inkt-stil)', fontSize: 11 }}>v{versie}</span>
        )}
        <span style={{ fontSize: 13 }}>
          {gebruiker.name}{' '}
          <span style={{ color: 'var(--inkt-stil)' }}>({gebruiker.initials})</span>
        </span>
        <button
          type="button"
          className="focus-ring"
          onClick={() => {
            void endpoints.uitloggen().then(onUitloggen);
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--rand)',
            borderRadius: 6,
            padding: '4px 10px',
            color: 'var(--inkt-zacht)',
            cursor: 'pointer',
          }}
        >
          Uitloggen
        </button>
      </div>
    </header>
  );
}

export function Bezig({ tekst }: { tekst: string }): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <p style={{ color: 'var(--inkt-zacht)' }}>{tekst}</p>
    </div>
  );
}

function Storing({ melding, opnieuw }: { melding: string; opnieuw: () => void }): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18 }}>De kern is niet bereikbaar</h1>
        <p style={{ color: 'var(--inkt-zacht)' }}>{melding}</p>
        <button
          type="button"
          className="focus-ring"
          onClick={opnieuw}
          style={{
            marginTop: 12,
            padding: '8px 16px',
            borderRadius: 6,
            border: 0,
            background: 'var(--belasting)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Opnieuw proberen
        </button>
      </div>
    </div>
  );
}
