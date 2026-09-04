/**
 * AVG-paneel bij een contactpersoon (hoofdstuk 6.1 en 10).
 *
 * Twee rechten van betrokkenen, als twee knoppen: inzage en vergetelheid.
 * Anonimiseren is onomkeerbaar, dus dat gaat via dezelfde dubbele bevestiging
 * als het definitief verwijderen van een veld.
 */
import { useState, type JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';

export function AvgPaneel({ contactId }: { contactId: number }): JSX.Element {
  const queryClient = useQueryClient();
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [dialoogOpen, setDialoogOpen] = useState(false);
  const [bevestiging, setBevestiging] = useState('');

  const meldFout = (error: unknown): void => {
    setFout(error instanceof ApiFout ? error.message : 'Er ging iets mis.');
    setMelding(null);
  };

  const exporteren = useMutation({
    mutationFn: () => endpoints.avgDossier(contactId),
    onSuccess: async (antwoord) => {
      const inhoud = JSON.stringify(antwoord.data, null, 2);
      const naam = `inzagedossier-contact-${contactId}.json`;

      // In de app via de opslaan-dialoog; in de browser als download.
      if (window.showroom) {
        await window.showroom.opslaanAls(naam, inhoud);
        setMelding('Het dossier is opgeslagen.');
      } else {
        const url = URL.createObjectURL(new Blob([inhoud], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = naam;
        link.click();
        URL.revokeObjectURL(url);
        setMelding('Het dossier is gedownload.');
      }
      setFout(null);
    },
    onError: meldFout,
  });

  const anonimiseren = useMutation({
    mutationFn: () => endpoints.avgAnonimiseren(contactId),
    onSuccess: (antwoord) => {
      setDialoogOpen(false);
      setBevestiging('');
      setFout(null);
      const behouden = antwoord.data.behouden
        .filter((entry) => entry.aantal > 0)
        .map((entry) => `${entry.aantal} ${entry.wat}`)
        .join(', ');
      setMelding(
        behouden
          ? `De persoonsgegevens zijn overschreven. Behouden: ${behouden}.`
          : 'De persoonsgegevens zijn overschreven.',
      );
      void queryClient.invalidateQueries({ queryKey: ['record', 'contacts', contactId] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'contacts'] });
    },
    onError: meldFout,
  });

  return (
    <Kaart>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>Privacy (AVG)</h2>
      <p style={{ color: 'var(--inkt-zacht)', fontSize: 12, margin: '0 0 12px', lineHeight: 1.6 }}>
        Bij een inzageverzoek levert de export alles wat er over deze persoon is vastgelegd.
        Anonimiseren overschrijft de naam en contactgegevens, maar laat offertes en kansen
        staan — die zijn bedrijfsadministratie.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="focus-ring"
          onClick={() => exporteren.mutate()}
          disabled={exporteren.isPending}
          style={knopStijl}
        >
          {exporteren.isPending ? 'Bezig…' : 'Gegevens exporteren'}
        </button>
        <button
          type="button"
          className="focus-ring"
          onClick={() => setDialoogOpen(true)}
          style={{ ...knopStijl, color: 'var(--ziekte)' }}
        >
          Anonimiseren
        </button>
      </div>

      {melding && (
        <p role="status" style={{ color: 'var(--inkt-zacht)', fontSize: 12, margin: '10px 0 0' }}>
          {melding}
        </p>
      )}
      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, margin: '10px 0 0' }}>
          {fout}
        </p>
      )}

      {dialoogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Contactpersoon anonimiseren"
          onClick={() => setDialoogOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgb(0 0 0 / 0.45)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 60,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--oppervlak-2)',
              border: '1px solid var(--rand)',
              borderRadius: 10,
              padding: 20,
              width: 440,
            }}
          >
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Anonimiseren</h3>
            <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', lineHeight: 1.6 }}>
              Naam, e-mailadres, telefoonnummers, geboortedatum en notities worden overschreven
              en zijn daarna niet meer terug te halen — ook niet uit het auditlog. Offertes,
              kansen en activiteiten blijven bestaan, zonder herleidbare gegevens.
            </p>
            <p style={{ fontSize: 13, margin: '12px 0 4px' }}>
              Typ <code style={{ background: 'var(--rand)', padding: '1px 5px' }}>ANONIMISEREN</code>{' '}
              over om te bevestigen:
            </p>
            <input
              className="focus-ring"
              value={bevestiging}
              onChange={(event) => setBevestiging(event.target.value)}
              aria-label="Bevestiging"
              style={{
                width: '100%',
                padding: '7px 9px',
                borderRadius: 6,
                border: '1px solid var(--rand)',
                background: 'var(--oppervlak)',
                color: 'var(--inkt)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="focus-ring"
                onClick={() => setDialoogOpen(false)}
                style={knopStijl}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="focus-ring"
                disabled={bevestiging !== 'ANONIMISEREN' || anonimiseren.isPending}
                onClick={() => anonimiseren.mutate()}
                style={{
                  ...knopStijl,
                  background: bevestiging === 'ANONIMISEREN' ? 'var(--ziekte)' : 'var(--rand)',
                  color: bevestiging === 'ANONIMISEREN' ? '#fff' : 'var(--inkt-stil)',
                  border: 0,
                }}
              >
                Anonimiseren
              </button>
            </div>
          </div>
        </div>
      )}
    </Kaart>
  );
}

const knopStijl: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rand)',
  borderRadius: 6,
  padding: '5px 12px',
  color: 'var(--inkt-zacht)',
  cursor: 'pointer',
  fontSize: 12,
};
