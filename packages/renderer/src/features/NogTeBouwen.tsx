/**
 * Eerlijke lege staat voor de schermen die nog niet af zijn.
 *
 * Beter een scherm dat zegt wat er nog moet komen dan een half werkend
 * scherm dat de indruk wekt dat het klaar is.
 */
import type { JSX } from 'react';
const FASE_PER_PAD: Record<string, string> = {
  '/klanten': 'Fase 3 — CRM: organisaties, contactpersonen, tijdlijn en dubbelendetectie.',
  '/kansen': 'Fase 4 — Kansen met disciplineregels, kanban en win/verlies per discipline.',
  '/projecten': 'Fase 6 — Projecten, fasen-editor en de import van de Excel-planning.',
  '/duurzaamheid': 'Fase 8 — Producten, pakketsamensteller en offertes met bevroren prijzen.',
  '/opvolging': 'Fase 9 — Vandaag-scherm, bellijsten en e-mail via Microsoft 365.',
  '/rapportages': 'Fase 11 — Query-bouwer, beveiligde SQL-modus en export naar Excel, PDF en Word.',
  '/instellingen': 'Fase 12 — Beheerschermen voor velden, gebruikers, netwerkstand en back-up.',
};

export function NogTeBouwen({ titel, pad }: { titel: string; pad: string }): JSX.Element {
  return (
    <section
      style={{
        border: '1px dashed var(--rand)',
        borderRadius: 10,
        padding: 32,
        maxWidth: 620,
      }}
    >
      <h1 style={{ fontSize: 17, margin: '0 0 8px' }}>{titel}</h1>
      <p style={{ color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.6 }}>
        Dit scherm is nog niet gebouwd. De gegevens erachter staan al wel in de database en
        zijn via de API te bevragen.
      </p>
      <p style={{ color: 'var(--inkt-zacht)', marginTop: 12, lineHeight: 1.6 }}>
        {FASE_PER_PAD[pad] ?? 'Dit scherm komt in een latere fase.'}
      </p>
    </section>
  );
}
