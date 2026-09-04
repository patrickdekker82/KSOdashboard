/**
 * Bewerkt de waarde van één veld, volgens zijn type (hoofdstuk 3.2).
 *
 * Dezelfde regels als de kern hanteert, zodat een fout al zichtbaar is voordat
 * je opslaat — maar de kern blijft degene die het afdwingt.
 */
import type { CSSProperties, JSX } from 'react';
import type { FieldDefinition } from '@showroom/shared';

export type Keuze = { value: string; label: string; color?: string | null };

export type InvoerProps = {
  veld: FieldDefinition;
  waarde: unknown;
  onWijzig: (waarde: unknown) => void;
  keuzes?: Keuze[];
  fout?: string | null;
  compact?: boolean;
};

const veldStijl: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--rand)',
  background: 'var(--oppervlak)',
  color: 'var(--inkt)',
  fontSize: 13,
  boxSizing: 'border-box',
};

export function VeldInvoer({
  veld,
  waarde,
  onWijzig,
  keuzes = [],
  fout,
  compact,
}: InvoerProps): JSX.Element {
  const id = `veld-${veld.entityKey}-${veld.fieldKey}`;
  const stijl: CSSProperties = {
    ...veldStijl,
    ...(fout ? { borderColor: 'var(--ziekte)' } : {}),
    ...(compact ? { padding: '4px 6px' } : {}),
  };
  const gemeenschappelijk = {
    id,
    className: 'focus-ring',
    style: stijl,
    disabled: !veld.editable,
    'aria-invalid': fout ? true : undefined,
    'aria-describedby': fout ? `${id}-fout` : veld.helpText ? `${id}-hulp` : undefined,
  };

  const tekst = waarde === null || waarde === undefined ? '' : String(waarde);

  const invoer = ((): JSX.Element => {
    switch (veld.type) {
      case 'formula':
        return (
          <output style={{ ...stijl, display: 'block', color: 'var(--inkt-zacht)' }}>
            {tekst === '' ? '—' : tekst}{' '}
            <span style={{ fontSize: 11 }}>(berekend)</span>
          </output>
        );

      case 'textarea':
      case 'richtext':
        return (
          <textarea
            {...gemeenschappelijk}
            rows={veld.type === 'richtext' ? 6 : 3}
            value={tekst}
            onChange={(event) => onWijzig(event.target.value || null)}
          />
        );

      case 'boolean':
        return (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              id={id}
              type="checkbox"
              className="focus-ring"
              disabled={!veld.editable}
              checked={Boolean(waarde)}
              onChange={(event) => onWijzig(event.target.checked)}
            />
            {waarde ? 'Ja' : 'Nee'}
          </label>
        );

      case 'select':
      case 'relation':
      case 'user':
        return (
          <select
            {...gemeenschappelijk}
            value={tekst}
            onChange={(event) => {
              const gekozen = event.target.value;
              if (gekozen === '') return onWijzig(null);
              onWijzig(veld.type === 'select' ? gekozen : Number(gekozen));
            }}
          >
            <option value="">— kies —</option>
            {keuzes.map((keuze) => (
              <option key={keuze.value} value={keuze.value}>
                {keuze.label}
              </option>
            ))}
          </select>
        );

      case 'multiselect': {
        const gekozen = new Set((Array.isArray(waarde) ? waarde : []).map(String));
        return (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              padding: '4px 0',
            }}
            role="group"
            aria-labelledby={`${id}-label`}
          >
            {keuzes.map((keuze) => (
              <label
                key={keuze.value}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 12,
                  border: '1px solid var(--rand)',
                  background: gekozen.has(keuze.value) ? 'var(--rand)' : 'transparent',
                  fontSize: 12,
                  cursor: veld.editable ? 'pointer' : 'default',
                }}
              >
                <input
                  type="checkbox"
                  className="focus-ring"
                  disabled={!veld.editable}
                  checked={gekozen.has(keuze.value)}
                  onChange={(event) => {
                    const volgende = new Set(gekozen);
                    if (event.target.checked) volgende.add(keuze.value);
                    else volgende.delete(keuze.value);
                    onWijzig(volgende.size === 0 ? null : [...volgende]);
                  }}
                  style={{ margin: 0 }}
                />
                {keuze.label}
              </label>
            ))}
          </div>
        );
      }

      case 'date':
      case 'time':
      case 'color':
        return (
          <input
            {...gemeenschappelijk}
            type={veld.type === 'color' ? 'color' : veld.type}
            value={tekst}
            onChange={(event) => onWijzig(event.target.value || null)}
          />
        );

      case 'datetime':
        return (
          <input
            {...gemeenschappelijk}
            type="datetime-local"
            value={tekst.slice(0, 16)}
            onChange={(event) => onWijzig(event.target.value || null)}
          />
        );

      case 'currency':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--inkt-stil)' }}>€</span>
            <input
              {...gemeenschappelijk}
              type="number"
              step="0.01"
              // Opslag is in centen; het formulier toont euro's.
              value={waarde === null || waarde === undefined ? '' : Number(waarde) / 100}
              onChange={(event) =>
                onWijzig(event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))
              }
            />
          </div>
        );

      case 'percent':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              {...gemeenschappelijk}
              type="number"
              step="0.1"
              // Opslag is in basispunten; het formulier toont procenten.
              value={waarde === null || waarde === undefined ? '' : Number(waarde) / 100}
              onChange={(event) =>
                onWijzig(event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))
              }
            />
            <span style={{ color: 'var(--inkt-stil)' }}>%</span>
          </div>
        );

      case 'number':
      case 'integer':
        return (
          <input
            {...gemeenschappelijk}
            type="number"
            step={veld.type === 'integer' ? 1 : 'any'}
            min={veld.validation.min}
            max={veld.validation.max}
            value={tekst}
            onChange={(event) => onWijzig(event.target.value === '' ? null : Number(event.target.value))}
          />
        );

      case 'email':
      case 'phone':
      case 'url':
        return (
          <input
            {...gemeenschappelijk}
            type={veld.type === 'phone' ? 'tel' : veld.type}
            value={tekst}
            onChange={(event) => onWijzig(event.target.value || null)}
          />
        );

      default:
        return (
          <input
            {...gemeenschappelijk}
            type="text"
            maxLength={veld.validation.maxLength}
            value={tekst}
            onChange={(event) => onWijzig(event.target.value || null)}
          />
        );
    }
  })();

  return (
    <div>
      <label
        id={`${id}-label`}
        htmlFor={id}
        style={{ display: 'block', fontSize: 12, color: 'var(--inkt-zacht)', marginBottom: 3 }}
      >
        {veld.label}
        {veld.required && (
          <span aria-label="verplicht" style={{ color: 'var(--ziekte)' }}>
            {' *'}
          </span>
        )}
      </label>
      {invoer}
      {veld.helpText && !fout && (
        <p id={`${id}-hulp`} style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '3px 0 0' }}>
          {veld.helpText}
        </p>
      )}
      {fout && (
        <p
          id={`${id}-fout`}
          role="alert"
          style={{ fontSize: 11, color: 'var(--ziekte)', margin: '3px 0 0' }}
        >
          {fout}
        </p>
      )}
    </div>
  );
}
