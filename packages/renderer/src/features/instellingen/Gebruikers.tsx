/**
 * Gebruikersbeheer (hoofdstuk 15).
 *
 * Hier stond de generieke lijst, en die was leeg: gebruikers hebben geen
 * velddefinities in het veldenregister, en zonder definities weet die lijst
 * niet welke kolommen er bestaan. Vandaar een eigen scherm.
 *
 * Aanmaken gaat langs een eigen adres in de kern, omdat `password_hash`
 * verplicht is: de generieke aanmaakroute zou stuklopen op een NOT NULL.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints, veldFouten, type Beheergebruiker } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

const ROLLEN: Array<[Beheergebruiker['role'], string, string]> = [
  ['admin', 'Beheerder', 'Alles, inclusief instellingen, back-up, SQL-modus en de AI-sleutel.'],
  ['manager', 'Manager', 'Alle gegevens, verlof goedkeuren, rapportages bewaren.'],
  ['user', 'Medewerker', 'Gegevens invoeren en eigen verlof aanvragen.'],
  ['readonly', 'Meekijker', 'Ziet alles, wijzigt niets.'],
];

type Concept = {
  name: string;
  initials: string;
  email: string;
  role: Beheergebruiker['role'];
  color: string;
  is_kopersbegeleider: boolean;
  may_manage_absences: boolean;
  active: boolean;
  wachtwoord: string;
};

const LEEG: Concept = {
  name: '',
  initials: '',
  email: '',
  role: 'user',
  color: '#2563eb',
  is_kopersbegeleider: false,
  may_manage_absences: false,
  active: true,
  wachtwoord: '',
};

export function Gebruikers({ onTerug }: { onTerug: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerkt, setBewerkt] = useState<Beheergebruiker | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept>(LEEG);
  const [herstelVoor, setHerstelVoor] = useState<Beheergebruiker | null>(null);
  const [nieuwWachtwoord, setNieuwWachtwoord] = useState('');
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [veldfouten, setVeldfouten] = useState<Record<string, string>>({});

  const lijst = useQuery({
    queryKey: ['gebruikers-beheer'],
    queryFn: () => endpoints.lijst<Beheergebruiker>('users', '?pageSize=200'),
  });

  function verwerkFout(error: unknown, terugval: string): void {
    const perVeld = veldFouten(error);
    setVeldfouten(Object.fromEntries(perVeld.map((f) => [f.veld, f.melding])));
    setFout(
      perVeld.length > 0
        ? 'Niet alles is goed ingevuld.'
        : error instanceof ApiFout
          ? error.message
          : terugval,
    );
  }

  const bewaren = useMutation({
    mutationFn: () => {
      const gedeeld = {
        name: concept.name.trim(),
        initials: concept.initials.trim().toUpperCase(),
        email: concept.email.trim().toLowerCase(),
        role: concept.role,
        color: concept.color || null,
        is_kopersbegeleider: concept.is_kopersbegeleider ? 1 : 0,
        may_manage_absences: concept.may_manage_absences ? 1 : 0,
      };
      if (bewerkt === 'nieuw' || bewerkt === null) {
        return endpoints.gebruikerAanmaken({ ...gedeeld, wachtwoord: concept.wachtwoord });
      }
      return endpoints.bewaar('users', bewerkt.id, {
        ...gedeeld,
        active: concept.active ? 1 : 0,
      });
    },
    onSuccess: () => {
      setBewerkt(null);
      setFout(null);
      setVeldfouten({});
      setMelding('Opgeslagen.');
      void queryClient.invalidateQueries({ queryKey: ['gebruikers-beheer'] });
      void queryClient.invalidateQueries({ queryKey: ['verwijzing', 'users'] });
    },
    onError: (error: unknown) => verwerkFout(error, 'Opslaan lukte niet.'),
  });

  const herstellen = useMutation({
    mutationFn: () => endpoints.wachtwoordHerstellen(herstelVoor!.id, nieuwWachtwoord),
    onSuccess: (antwoord) => {
      setHerstelVoor(null);
      setNieuwWachtwoord('');
      setFout(null);
      setVeldfouten({});
      setMelding(
        `Wachtwoord van ${antwoord.naam} is opnieuw ingesteld. Geef het door; bij de eerste keer ` +
          'inloggen moet er een eigen wachtwoord gekozen worden.',
      );
      void queryClient.invalidateQueries({ queryKey: ['gebruikers-beheer'] });
    },
    onError: (error: unknown) => verwerkFout(error, 'Opnieuw instellen lukte niet.'),
  });

  const archiveren = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('users', id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gebruikers-beheer'] }),
    onError: (error: unknown) => verwerkFout(error, 'Archiveren lukte niet.'),
  });

  function open(gebruiker: Beheergebruiker | 'nieuw'): void {
    setBewerkt(gebruiker);
    setFout(null);
    setVeldfouten({});
    setConcept(
      gebruiker === 'nieuw'
        ? LEEG
        : {
            name: gebruiker.name,
            initials: gebruiker.initials,
            email: gebruiker.email,
            role: gebruiker.role,
            color: gebruiker.color ?? '#2563eb',
            is_kopersbegeleider: gebruiker.is_kopersbegeleider === 1,
            may_manage_absences: gebruiker.may_manage_absences === 1,
            active: gebruiker.active === 1,
            wachtwoord: '',
          },
    );
  }

  const rijen = lijst.data?.data ?? [];
  const nieuw = bewerkt === 'nieuw';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Gebruikers &amp; rollen</h1>
        <button type="button" className="focus-ring" onClick={onTerug} style={dialoogKnop}>
          Terug naar instellingen
        </button>
        <button
          type="button"
          className="focus-ring"
          onClick={() => open('nieuw')}
          style={{
            ...dialoogKnop,
            background: 'var(--belasting)',
            color: '#fff',
            borderColor: 'transparent',
            marginLeft: 'auto',
          }}
        >
          + Nieuwe gebruiker
        </button>
      </div>

      <Kaart>
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.55 }}>
          Vier rollen, van veel naar weinig: beheerder, manager, medewerker, meekijker. Daarnaast
          twee vinkjes die los van de rol staan:
          <br />
          <br />
          <strong>Kopersbegeleider</strong> — telt mee in de showroombezetting. Alleen aanvinken bij
          wie echt showroomafspraken doet, want dit getal stuurt de hele capaciteitsberekening.
          <br />
          <strong>Mag verlof en inzet voor collega&apos;s invullen</strong> — voor wie de planning
          bijhoudt zonder manager te zijn. Zonder dit vinkje vult iemand alleen zijn eigen verlof
          in.
          <br />
          <br />
          Iemand die weggaat zet u op <em>gearchiveerd</em>. Verwijderen kan niet: dan verdwijnt ook
          wie wat gedaan heeft.
        </p>
      </Kaart>

      {melding !== null && (
        <Kaart>
          <p style={{ fontSize: 13, color: 'var(--belasting)', margin: 0 }}>{melding}</p>
        </Kaart>
      )}
      {fout !== null && bewerkt === null && herstelVoor === null && (
        <Kaart>
          <p role="alert" style={{ fontSize: 13, color: 'var(--ziekte)', margin: 0 }}>
            {fout}
          </p>
        </Kaart>
      )}

      <Kaart>
        {lijst.isLoading ? (
          <Skelet hoogte={200} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--inkt-zacht)', fontSize: 12 }}>
                <Th>Naam</Th>
                <Th>E-mailadres</Th>
                <Th>Rol</Th>
                <Th>Begeleider</Th>
                <Th>Verlof anderen</Th>
                <Th>Actief</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((gebruiker) => (
                <tr key={gebruiker.id} style={{ borderTop: '1px solid var(--rand)' }}>
                  <Td>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        marginRight: 6,
                        background: gebruiker.color ?? 'var(--rand)',
                      }}
                    />
                    {gebruiker.name}{' '}
                    <span style={{ color: 'var(--inkt-stil)' }}>({gebruiker.initials})</span>
                  </Td>
                  <Td>{gebruiker.email}</Td>
                  <Td>
                    {ROLLEN.find(([sleutel]) => sleutel === gebruiker.role)?.[1] ?? gebruiker.role}
                  </Td>
                  <Td>{gebruiker.is_kopersbegeleider === 1 ? 'ja' : '—'}</Td>
                  <Td>{gebruiker.may_manage_absences === 1 ? 'ja' : '—'}</Td>
                  <Td>
                    {gebruiker.archived_at !== null
                      ? 'gearchiveerd'
                      : gebruiker.active === 1
                        ? 'ja'
                        : 'nee'}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => open(gebruiker)}
                        style={dialoogKnop}
                      >
                        Bewerken
                      </button>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => {
                          setHerstelVoor(gebruiker);
                          setNieuwWachtwoord('');
                          setFout(null);
                          setVeldfouten({});
                        }}
                        style={dialoogKnop}
                      >
                        Wachtwoord…
                      </button>
                      {gebruiker.archived_at === null && (
                        <button
                          type="button"
                          className="focus-ring"
                          onClick={() => archiveren.mutate(gebruiker.id)}
                          style={{ ...dialoogKnop, color: 'var(--ziekte)' }}
                        >
                          Archiveren
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kaart>

      {bewerkt !== null && (
        <Dialoog
          titel={nieuw ? 'Nieuwe gebruiker' : `Gebruiker: ${bewerkt.name}`}
          onSluit={() => setBewerkt(null)}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <Veld id="gb-naam" label="Naam" fout={veldfouten.name}>
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  value={concept.name}
                  onChange={(e) => setConcept((h) => ({ ...h, name: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="gb-initialen" label="Initialen" fout={veldfouten.initials}>
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  maxLength={4}
                  value={concept.initials}
                  onChange={(e) => setConcept((h) => ({ ...h, initials: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="gb-email" label="E-mailadres" fout={veldfouten.email}>
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="email"
                  value={concept.email}
                  onChange={(e) => setConcept((h) => ({ ...h, email: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="gb-rol" label="Rol" fout={veldfouten.role}>
              {(props) => (
                <select
                  {...props}
                  className="focus-ring"
                  value={concept.role}
                  onChange={(e) =>
                    setConcept((h) => ({ ...h, role: e.target.value as Concept['role'] }))
                  }
                  style={invoerStijl}
                >
                  {ROLLEN.map(([sleutel, label]) => (
                    <option key={sleutel} value={sleutel}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Veld>
            <Veld id="gb-kleur" label="Kleur">
              {(props) => (
                <input
                  {...props}
                  className="focus-ring"
                  type="color"
                  value={concept.color}
                  onChange={(e) => setConcept((h) => ({ ...h, color: e.target.value }))}
                  style={{ ...invoerStijl, padding: 2, height: 32 }}
                />
              )}
            </Veld>
            {nieuw && (
              <Veld
                id="gb-wachtwoord"
                label="Beginwachtwoord"
                hulp="Minimaal twaalf tekens. De gebruiker moet het bij de eerste keer inloggen wijzigen."
                fout={veldfouten.wachtwoord}
              >
                {(props) => (
                  <input
                    {...props}
                    className="focus-ring"
                    type="text"
                    value={concept.wachtwoord}
                    onChange={(e) => setConcept((h) => ({ ...h, wachtwoord: e.target.value }))}
                    style={invoerStijl}
                  />
                )}
              </Veld>
            )}
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            <Vinkje
              aan={concept.is_kopersbegeleider}
              onWissel={(aan) => setConcept((h) => ({ ...h, is_kopersbegeleider: aan }))}
              label="Kopersbegeleider"
              uitleg="Telt mee in de showroombezetting."
            />
            <Vinkje
              aan={concept.may_manage_absences}
              onWissel={(aan) => setConcept((h) => ({ ...h, may_manage_absences: aan }))}
              label="Mag verlof en inzet voor collega's invullen"
              uitleg="Voor wie de planning bijhoudt zonder manager te zijn."
            />
            {!nieuw && (
              <Vinkje
                aan={concept.active}
                onWissel={(aan) => setConcept((h) => ({ ...h, active: aan }))}
                label="Actief"
                uitleg="Uit betekent: kan niet meer inloggen, maar blijft overal zichtbaar."
              />
            )}
          </div>

          {fout !== null && (
            <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginTop: 12 }}>
              {fout}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => setBewerkt(null)}
              style={dialoogKnop}
            >
              Annuleren
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={bewaren.isPending}
              onClick={() => bewaren.mutate()}
              style={{
                ...dialoogKnop,
                background: 'var(--belasting)',
                color: '#fff',
                borderColor: 'transparent',
              }}
            >
              {bewaren.isPending ? 'Bezig…' : 'Opslaan'}
            </button>
          </div>
        </Dialoog>
      )}

      {herstelVoor !== null && (
        <Dialoog titel={`Wachtwoord van ${herstelVoor.name}`} onSluit={() => setHerstelVoor(null)}>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 12px' }}>
            U stelt hier een nieuw wachtwoord in en geeft dat door aan {herstelVoor.name}. Bij de
            eerste keer inloggen moet er meteen een eigen wachtwoord gekozen worden, dus u kent het
            daarna niet meer. Alle openstaande sessies van deze gebruiker vervallen.
          </p>
          <Veld
            id="gb-herstel"
            label="Nieuw wachtwoord"
            hulp="Minimaal twaalf tekens, met hoofdletters, kleine letters en een cijfer."
            fout={veldfouten.wachtwoord ?? veldfouten.nieuw}
          >
            {(props) => (
              <input
                {...props}
                className="focus-ring"
                type="text"
                value={nieuwWachtwoord}
                onChange={(e) => setNieuwWachtwoord(e.target.value)}
                style={{ ...invoerStijl, width: '100%' }}
              />
            )}
          </Veld>

          {fout !== null && (
            <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginTop: 12 }}>
              {fout}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="focus-ring"
              onClick={() => setHerstelVoor(null)}
              style={dialoogKnop}
            >
              Annuleren
            </button>
            <button
              type="button"
              className="focus-ring"
              disabled={herstellen.isPending || nieuwWachtwoord.length < 12}
              onClick={() => herstellen.mutate()}
              style={{
                ...dialoogKnop,
                background: 'var(--belasting)',
                color: '#fff',
                borderColor: 'transparent',
                opacity: nieuwWachtwoord.length < 12 ? 0.5 : 1,
              }}
            >
              {herstellen.isPending ? 'Bezig…' : 'Instellen'}
            </button>
          </div>
        </Dialoog>
      )}
    </div>
  );
}

function Th({ children }: { children: ReactNode }): JSX.Element {
  return <th style={{ padding: '6px 8px', fontWeight: 600 }}>{children}</th>;
}

function Td({ children }: { children: ReactNode }): JSX.Element {
  return <td style={{ padding: '7px 8px' }}>{children}</td>;
}

function Vinkje({
  aan,
  onWissel,
  label,
  uitleg,
}: {
  aan: boolean;
  onWissel: (aan: boolean) => void;
  label: string;
  uitleg: string;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
      <input
        type="checkbox"
        className="focus-ring"
        checked={aan}
        onChange={(event) => onWissel(event.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>
        {label}
        <br />
        <span style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>{uitleg}</span>
      </span>
    </label>
  );
}

/** Label, invoer en hulptekst, met de hulp aan aria-describedby en niet in het label. */
function Veld({
  id,
  label,
  hulp,
  fout,
  children,
}: {
  id: string;
  label: string;
  hulp?: string;
  fout?: string;
  children: (eigenschappen: { id: string; 'aria-describedby'?: string }) => ReactNode;
}): JSX.Element {
  const hulpId = hulp === undefined ? undefined : `${id}-hulp`;
  const foutId = fout === undefined ? undefined : `${id}-fout`;
  return (
    <div style={{ fontSize: 12 }}>
      <label htmlFor={id} style={{ display: 'block', color: 'var(--inkt-zacht)' }}>
        {label}
      </label>
      <div style={{ marginTop: 3 }}>{children({ id, 'aria-describedby': foutId ?? hulpId })}</div>
      {fout !== undefined ? (
        <span id={foutId} role="alert" style={{ fontSize: 11, color: 'var(--ziekte)' }}>
          {fout}
        </span>
      ) : (
        hulp !== undefined && (
          <span id={hulpId} style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
            {hulp}
          </span>
        )
      )}
    </div>
  );
}
