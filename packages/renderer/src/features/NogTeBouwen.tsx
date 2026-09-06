/**
 * Eerlijke lege staat voor de schermen die nog niet af zijn.
 *
 * Beter een scherm dat zegt wat er nog moet komen dan een half werkend
 * scherm dat de indruk wekt dat het klaar is.
 */
import type { JSX } from 'react';
/*
 * Alle schermen uit de opdracht zijn gebouwd, dus deze lijst is leeg.
 *
 * De component blijft staan: hij vangt een route op die wel in het menu staat
 * maar (nog) geen scherm heeft, en dat is beter dan een wit vlak. Komt er ooit
 * een route bij, dan hoort hier de uitleg te staan.
 */
const FASE_PER_PAD: Record<string, string> = {};

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
        Voor dit adres is geen scherm gevonden. De gegevens erachter staan wel in de database
        en zijn via de API te bevragen.
      </p>
      <p style={{ color: 'var(--inkt-zacht)', marginTop: 12, lineHeight: 1.6 }}>
        {FASE_PER_PAD[pad] ??
          'Controleer het adres in de balk, of kies links een onderdeel uit het menu.'}
      </p>
    </section>
  );
}
