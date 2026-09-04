/**
 * Toont de waarde van één veld, volgens zijn type (hoofdstuk 3.2).
 *
 * Eén component voor alle 21 types, zodat een nieuw veld dat een beheerder
 * aanmaakt meteen overal goed getoond wordt: in de lijst, op de detailpagina
 * en in de export.
 */
import type { JSX } from 'react';
import {
  FIELD_TYPE_INFO,
  formatCurrency,
  formatDate,
  formatDecimal,
  type FieldDefinition,
} from '@showroom/shared';

export type Opzoeker = {
  /** Label bij een verwijzing of gebruiker, bijvoorbeeld id 3 -> "RB". */
  label: (entiteit: string | null | undefined, id: number) => string;
  /** Label en kleur bij een keuzelijstwaarde. */
  optie: (veld: FieldDefinition, waarde: string) => { label: string; color?: string | null };
};

export const GEEN_OPZOEKER: Opzoeker = {
  label: (_entiteit, id) => `#${id}`,
  optie: (_veld, waarde) => ({ label: waarde }),
};

export function VeldWaarde({
  veld,
  waarde,
  opzoeker = GEEN_OPZOEKER,
}: {
  veld: FieldDefinition;
  waarde: unknown;
  opzoeker?: Opzoeker;
}): JSX.Element {
  if (waarde === null || waarde === undefined || waarde === '') {
    return <span style={{ color: 'var(--inkt-stil)' }}>—</span>;
  }

  switch (veld.type) {
    case 'currency':
      // Bedragen staan als centen in de database.
      return <>{formatCurrency(Math.round(Number(waarde)))}</>;

    case 'percent':
      // Percentages staan als basispunten.
      return <>{formatDecimal(Number(waarde) / 100)}%</>;

    case 'number':
      return <>{formatDecimal(Number(waarde))}</>;
    case 'integer':
      return <>{Number(waarde).toLocaleString('nl-NL')}</>;

    case 'date':
      return <>{formatDate(String(waarde).slice(0, 10))}</>;
    case 'datetime': {
      const tekst = String(waarde);
      return (
        <>
          {formatDate(tekst.slice(0, 10))} {tekst.slice(11, 16)}
        </>
      );
    }
    case 'time':
      return <>{String(waarde).slice(0, 5)}</>;

    case 'boolean':
      return <>{waarde ? 'Ja' : 'Nee'}</>;

    case 'select': {
      const optie = opzoeker.optie(veld, String(waarde));
      return <Chip label={optie.label} kleur={optie.color} />;
    }

    case 'multiselect': {
      const waarden = Array.isArray(waarde) ? waarde : [waarde];
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {waarden.map((keuze) => {
            const optie = opzoeker.optie(veld, String(keuze));
            return <Chip key={String(keuze)} label={optie.label} kleur={optie.color} />;
          })}
        </span>
      );
    }

    case 'relation':
    case 'user':
      return <>{opzoeker.label(veld.relationEntity ?? 'users', Number(waarde))}</>;

    case 'email':
      return <Link href={`mailto:${String(waarde)}`}>{String(waarde)}</Link>;
    case 'phone':
      return <Link href={`tel:${String(waarde).replace(/\s/g, '')}`}>{String(waarde)}</Link>;
    case 'url':
      return <Link href={String(waarde)}>{String(waarde).replace(/^https?:\/\//, '')}</Link>;

    case 'color':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: String(waarde),
              border: '1px solid var(--rand)',
            }}
          />
          {String(waarde)}
        </span>
      );

    case 'richtext':
      // Bewust als platte tekst: HTML uit de database komt van gebruikers en
      // gaat hier niet ongefilterd het document in.
      return <>{String(waarde).replace(/<[^>]*>/g, ' ').trim()}</>;

    case 'formula':
      return (
        <span title="Berekend veld">
          {typeof waarde === 'number' ? formatDecimal(waarde) : String(waarde)}
        </span>
      );

    default:
      return <>{String(waarde)}</>;
  }
}

function Chip({ label, kleur }: { label: string; kleur?: string | null }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '1px 8px',
        borderRadius: 10,
        fontSize: 12,
        background: 'var(--rand)',
        color: 'var(--inkt)',
      }}
    >
      {kleur && (
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: 4, background: kleur }}
        />
      )}
      {label}
    </span>
  );
}

/**
 * Externe links gaan via het hoofdproces, dat alleen https: en mailto:
 * doorlaat. Een link in de renderer opent nooit rechtstreeks een venster.
 */
function Link({ href, children }: { href: string; children: React.ReactNode }): JSX.Element {
  return (
    <a
      href={href}
      className="focus-ring"
      style={{ color: 'var(--belasting)', textDecoration: 'none' }}
      onClick={(event) => {
        event.preventDefault();
        void window.showroom?.externeLink(href);
      }}
    >
      {children}
    </a>
  );
}

/** Uitlijning van een kolom in de lijst, afgeleid van het type. */
export function uitlijning(veld: FieldDefinition): 'left' | 'right' | 'center' {
  return FIELD_TYPE_INFO[veld.type].align;
}
