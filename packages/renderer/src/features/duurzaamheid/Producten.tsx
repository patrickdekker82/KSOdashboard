/**
 * De producten waar pakketten uit worden opgebouwd (hoofdstuk 6.5).
 *
 * Zonder dit scherm was de pakketeditor op een verse installatie onbruikbaar:
 * een pakketregel wijst naar een product, en er was geen manier om er een aan
 * te maken. De inkoopprijs die hier staat is wat de marge op een pakketregel
 * rekent, dus die hoort hier ingevuld te worden en nergens anders.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@showroom/shared';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { Kaart, Skelet } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

type Product = {
  id: number;
  sku: string | null;
  name: string;
  unit: string;
  purchase_price_cents: number;
  sales_price_cents: number;
  vat_rate_bp: number;
  active: number;
  archived_at: string | null;
};

type Concept = {
  name: string;
  sku: string;
  unit: string;
  inkoop: string;
  verkoop: string;
  btw: string;
  active: boolean;
};

const LEEG: Concept = {
  name: '',
  sku: '',
  unit: 'stuk',
  inkoop: '0.00',
  verkoop: '0.00',
  btw: '21',
  active: true,
};

function centenNaarVeld(centen: number): string {
  return (centen / 100).toFixed(2);
}
function veldNaarCenten(waarde: string): number {
  const getal = Number(waarde.replace(',', '.'));
  return Number.isFinite(getal) ? Math.round(getal * 100) : 0;
}

export function Producten(): JSX.Element {
  const queryClient = useQueryClient();
  const [bewerkt, setBewerkt] = useState<Product | 'nieuw' | null>(null);
  const [concept, setConcept] = useState<Concept>(LEEG);
  const [fout, setFout] = useState<string | null>(null);

  const lijst = useQuery({
    queryKey: ['producten-beheer'],
    queryFn: () => endpoints.lijst<Product>('products', '?pageSize=300'),
  });

  const bewaren = useMutation({
    mutationFn: () =>
      endpoints.bewaar<Product>(
        'products',
        bewerkt === 'nieuw' || bewerkt === null ? null : bewerkt.id,
        {
          name: concept.name.trim(),
          sku: concept.sku.trim() === '' ? null : concept.sku.trim(),
          unit: concept.unit.trim() === '' ? 'stuk' : concept.unit.trim(),
          purchase_price_cents: veldNaarCenten(concept.inkoop),
          sales_price_cents: veldNaarCenten(concept.verkoop),
          // Procenten naar basispunten: 21% is 2100.
          vat_rate_bp: Math.round((Number(concept.btw.replace(',', '.')) || 0) * 100),
          active: concept.active ? 1 : 0,
        },
      ),
    onSuccess: () => {
      setBewerkt(null);
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['producten-beheer'] });
      // De pakketeditor put uit dezelfde lijst.
      void queryClient.invalidateQueries({ queryKey: ['producten-keuze'] });
      void queryClient.invalidateQueries({ queryKey: ['pakketten'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  const archiveren = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('products', id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['producten-beheer'] }),
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Archiveren lukte niet.'),
  });

  function open(product: Product | 'nieuw'): void {
    setBewerkt(product);
    setFout(null);
    setConcept(
      product === 'nieuw'
        ? LEEG
        : {
            name: product.name,
            sku: product.sku ?? '',
            unit: product.unit,
            inkoop: centenNaarVeld(product.purchase_price_cents),
            verkoop: centenNaarVeld(product.sales_price_cents),
            btw: String(product.vat_rate_bp / 100),
            active: product.active === 1,
          },
    );
  }

  const rijen = lijst.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <p
          style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: 0, lineHeight: 1.55, flex: 1 }}
        >
          De onderdelen waar een pakket uit bestaat. De <strong>inkoopprijs</strong> is wat de marge
          op een pakketregel rekent; de verkoopprijs geldt als er geen marge is ingevuld.
        </p>
        <button
          type="button"
          className="focus-ring"
          onClick={() => open('nieuw')}
          style={{
            ...dialoogKnop,
            background: 'var(--belasting)',
            color: '#fff',
            borderColor: 'transparent',
          }}
        >
          + Nieuw product
        </button>
      </div>

      {fout !== null && (
        <Kaart>
          <p role="alert" style={{ fontSize: 13, color: 'var(--ziekte)', margin: 0 }}>
            {fout}
          </p>
        </Kaart>
      )}

      <Kaart>
        {lijst.isLoading ? (
          <Skelet hoogte={160} />
        ) : rijen.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: 0 }}>
            Er staan nog geen producten. Maak er een aan; daarna kunt u ze in een pakket zetten.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--inkt-zacht)', fontSize: 12 }}>
                <Th>Naam</Th>
                <Th>Artikelnr.</Th>
                <Th>Eenheid</Th>
                <Th>Inkoop</Th>
                <Th>Verkoop</Th>
                <Th>Btw</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((product) => (
                <tr key={product.id} style={{ borderTop: '1px solid var(--rand)' }}>
                  <Td>{product.name}</Td>
                  <Td>{product.sku ?? '—'}</Td>
                  <Td>{product.unit}</Td>
                  <Td>{formatCurrency(product.purchase_price_cents)}</Td>
                  <Td>{formatCurrency(product.sales_price_cents)}</Td>
                  <Td>{product.vat_rate_bp / 100} %</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => open(product)}
                        style={dialoogKnop}
                      >
                        Bewerken
                      </button>
                      <button
                        type="button"
                        className="focus-ring"
                        onClick={() => archiveren.mutate(product.id)}
                        style={{ ...dialoogKnop, color: 'var(--ziekte)' }}
                      >
                        Archiveren
                      </button>
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
          titel={bewerkt === 'nieuw' ? 'Nieuw product' : `Product: ${bewerkt.name}`}
          onSluit={() => setBewerkt(null)}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 12,
            }}
          >
            <Veld id="pr-naam" label="Naam">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  value={concept.name}
                  onChange={(e) => setConcept((h) => ({ ...h, name: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="pr-sku" label="Artikelnummer" hulp="Mag leeg blijven; moet uniek zijn.">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  value={concept.sku}
                  onChange={(e) => setConcept((h) => ({ ...h, sku: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="pr-eenheid" label="Eenheid" hulp="stuk, m², uur…">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  value={concept.unit}
                  onChange={(e) => setConcept((h) => ({ ...h, unit: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="pr-inkoop" label="Inkoopprijs (€)" hulp="Waar de marge op gerekend wordt.">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  type="number"
                  step={0.01}
                  value={concept.inkoop}
                  onChange={(e) => setConcept((h) => ({ ...h, inkoop: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="pr-verkoop" label="Verkoopprijs (€)" hulp="Geldt als er geen marge staat.">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  type="number"
                  step={0.01}
                  value={concept.verkoop}
                  onChange={(e) => setConcept((h) => ({ ...h, verkoop: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
            <Veld id="pr-btw" label="Btw (%)">
              {(p) => (
                <input
                  {...p}
                  className="focus-ring"
                  type="number"
                  step={1}
                  value={concept.btw}
                  onChange={(e) => setConcept((h) => ({ ...h, btw: e.target.value }))}
                  style={invoerStijl}
                />
              )}
            </Veld>
          </div>

          <label
            style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 12 }}
          >
            <input
              type="checkbox"
              className="focus-ring"
              checked={concept.active}
              onChange={(e) => setConcept((h) => ({ ...h, active: e.target.checked }))}
            />
            Actief — inactieve producten zijn niet meer te kiezen in een pakket
          </label>

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
              disabled={bewaren.isPending || concept.name.trim() === ''}
              onClick={() => bewaren.mutate()}
              style={{
                ...dialoogKnop,
                background: 'var(--belasting)',
                color: '#fff',
                borderColor: 'transparent',
                opacity: concept.name.trim() === '' ? 0.5 : 1,
              }}
            >
              {bewaren.isPending ? 'Bezig…' : 'Opslaan'}
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

function Veld({
  id,
  label,
  hulp,
  children,
}: {
  id: string;
  label: string;
  hulp?: string;
  children: (eigenschappen: { id: string; 'aria-describedby'?: string }) => ReactNode;
}): JSX.Element {
  const hulpId = hulp === undefined ? undefined : `${id}-hulp`;
  return (
    <div style={{ fontSize: 12 }}>
      <label htmlFor={id} style={{ display: 'block', color: 'var(--inkt-zacht)' }}>
        {label}
      </label>
      <div style={{ marginTop: 3 }}>{children({ id, 'aria-describedby': hulpId })}</div>
      {hulp !== undefined && (
        <span id={hulpId} style={{ fontSize: 11, color: 'var(--inkt-stil)' }}>
          {hulp}
        </span>
      )}
    </div>
  );
}
