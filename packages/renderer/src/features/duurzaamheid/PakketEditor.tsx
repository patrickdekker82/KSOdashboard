/**
 * Een pakket samenstellen (hoofdstuk 6.5).
 *
 * De rekenkant bestond al en is getest: som van de regels, die som plus een
 * opslag, of een vaste prijs — en per regel de verkoopprijs afleiden uit de
 * inkoopprijs plus een marge. Wat ontbrak was het scherm eromheen: pakketten
 * waren alleen te bekijken.
 *
 * De prijs die hier meeloopt komt uit de kern, niet uit een eigen sommetje in
 * het scherm. Twee plekken die hetzelfde uitrekenen gaan vroeg of laat uit
 * elkaar lopen, en dan is het de vraag welke van de twee op de offerte staat.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBp, formatCurrency } from '@showroom/shared';
import { ApiFout, endpoints, type PakketMetPrijs, type Pakketregel } from '../../lib/api.ts';
import { Kaart } from '../Dashboard.tsx';
import { Dialoog, dialoogKnop, invoerStijl } from '../kansen/Dialoog.tsx';

type Product = {
  id: number;
  name: string;
  sku: string | null;
  unit: string | null;
  purchase_price_cents: number;
  sales_price_cents: number;
};

/** Centen naar een bedrag om te tonen in een invoerveld, en terug. */
function centenNaarVeld(centen: number): string {
  return (centen / 100).toFixed(2);
}
function veldNaarCenten(waarde: string): number {
  const getal = Number(waarde.replace(',', '.'));
  return Number.isFinite(getal) ? Math.round(getal * 100) : 0;
}

export function PakketEditor({
  pakket,
  onSluit,
}: {
  /** Een bestaand pakket, of null voor een nieuw pakket. */
  pakket: PakketMetPrijs | null;
  onSluit: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const nieuw = pakket === null;
  const [naam, setNaam] = useState(pakket?.name ?? '');
  const [code, setCode] = useState(pakket?.code ?? '');
  const [omschrijving, setOmschrijving] = useState(pakket?.description ?? '');
  const [modus, setModus] = useState<PakketMetPrijs['pricing_mode']>(pakket?.pricing_mode ?? 'sum');
  const [opslag, setOpslag] = useState(String((pakket?.margin_bp ?? 0) / 100));
  const [vastePrijs, setVastePrijs] = useState(centenNaarVeld(pakket?.fixed_price_cents ?? 0));
  const [fout, setFout] = useState<string | null>(null);

  function ververs(): void {
    void queryClient.invalidateQueries({ queryKey: ['pakketten'] });
  }

  const bewaren = useMutation({
    mutationFn: () =>
      endpoints.bewaar<{ id: number }>('packages', pakket?.id ?? null, {
        name: naam.trim(),
        code: code.trim() === '' ? null : code.trim(),
        description: omschrijving.trim() === '' ? null : omschrijving.trim(),
        pricing_mode: modus,
        margin_bp: Math.round(Number(opslag.replace(',', '.')) * 100) || 0,
        fixed_price_cents: modus === 'fixed' ? veldNaarCenten(vastePrijs) : null,
      }),
    onSuccess: () => {
      setFout(null);
      ververs();
      if (nieuw) onSluit();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Opslaan lukte niet.'),
  });

  return (
    <Dialoog titel={nieuw ? 'Nieuw pakket' : `Pakket: ${pakket.name}`} onSluit={onSluit}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <Veld id="pk-naam" label="Naam">
          {(props) => (
            <input
              {...props}
              className="focus-ring"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              style={invoerStijl}
            />
          )}
        </Veld>
        <Veld id="pk-code" label="Code" hulp="Kort en uniek; mag leeg blijven.">
          {(props) => (
            <input
              {...props}
              className="focus-ring"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={invoerStijl}
            />
          )}
        </Veld>
        <Veld id="pk-modus" label="Hoe komt de prijs tot stand?">
          {(props) => (
            <select
              {...props}
              className="focus-ring"
              value={modus}
              onChange={(e) => setModus(e.target.value as PakketMetPrijs['pricing_mode'])}
              style={invoerStijl}
            >
              <option value="sum">Som van de regels</option>
              <option value="sum_with_margin">Som van de regels plus opslag</option>
              <option value="fixed">Vaste prijs</option>
            </select>
          )}
        </Veld>
        {modus === 'sum_with_margin' && (
          <Veld id="pk-opslag" label="Opslag (%)" hulp="Komt boven op de som van alle regels.">
            {(props) => (
              <input
                {...props}
                className="focus-ring"
                type="number"
                step={0.5}
                value={opslag}
                onChange={(e) => setOpslag(e.target.value)}
                style={invoerStijl}
              />
            )}
          </Veld>
        )}
        {modus === 'fixed' && (
          <Veld
            id="pk-vast"
            label="Vaste prijs (€)"
            hulp="Het verschil wordt evenredig over de regels verdeeld."
          >
            {(props) => (
              <input
                {...props}
                className="focus-ring"
                type="number"
                step={0.01}
                value={vastePrijs}
                onChange={(e) => setVastePrijs(e.target.value)}
                style={invoerStijl}
              />
            )}
          </Veld>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <Veld id="pk-omschrijving" label="Omschrijving">
          {(props) => (
            <textarea
              {...props}
              className="focus-ring"
              rows={2}
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              style={{ ...invoerStijl, width: '100%', resize: 'vertical' }}
            />
          )}
        </Veld>
      </div>

      {fout !== null && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 13, marginTop: 12 }}>
          {fout}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="focus-ring" onClick={onSluit} style={dialoogKnop}>
          {nieuw ? 'Annuleren' : 'Sluiten'}
        </button>
        <button
          type="button"
          className="focus-ring"
          disabled={bewaren.isPending || naam.trim() === ''}
          onClick={() => bewaren.mutate()}
          style={{
            ...dialoogKnop,
            background: 'var(--belasting)',
            color: '#fff',
            borderColor: 'transparent',
            opacity: naam.trim() === '' ? 0.5 : 1,
          }}
        >
          {bewaren.isPending ? 'Bezig…' : nieuw ? 'Aanmaken' : 'Opslaan'}
        </button>
      </div>

      {/* Regels kunnen pas als het pakket bestaat: ze hangen aan zijn id. */}
      {!nieuw && <Regels pakket={pakket} onGewijzigd={ververs} />}
    </Dialoog>
  );
}

function Regels({
  pakket,
  onGewijzigd,
}: {
  pakket: PakketMetPrijs;
  onGewijzigd: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState(0);
  const [aantal, setAantal] = useState('1');
  const [marge, setMarge] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const producten = useQuery({
    queryKey: ['producten-keuze'],
    queryFn: () => endpoints.lijst<Product>('products', '?pageSize=500'),
    staleTime: 5 * 60_000,
  });

  function ververs(): void {
    onGewijzigd();
    void queryClient.invalidateQueries({ queryKey: ['pakketten'] });
  }

  const toevoegen = useMutation({
    mutationFn: () => {
      const margeBp =
        marge.trim() === '' ? null : Math.round(Number(marge.replace(',', '.')) * 100);
      return endpoints.bewaar('package-items', null, {
        package_id: pakket.id,
        product_id: productId,
        quantity: Number(aantal.replace(',', '.')) || 1,
        // Met een marge rekent de kern de prijs uit de inkoopprijs; zonder
        // marge geldt de verkoopprijs van het product.
        margin_bp: margeBp,
        unit_price_cents: 0,
      });
    },
    onSuccess: () => {
      setProductId(0);
      setAantal('1');
      setMarge('');
      setFout(null);
      ververs();
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Toevoegen lukte niet.'),
  });

  const verwijderen = useMutation({
    mutationFn: (id: number) => endpoints.verwijder('package-items', id),
    onSuccess: ververs,
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Verwijderen lukte niet.'),
  });

  const gekozenProduct = (producten.data?.data ?? []).find((p) => p.id === productId);
  const voorbeeld =
    gekozenProduct && marge.trim() !== ''
      ? Math.round(
          gekozenProduct.purchase_price_cents * (1 + (Number(marge.replace(',', '.')) || 0) / 100),
        )
      : null;

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--rand)', paddingTop: 14 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>Samenstelling</h3>

      {pakket.regels.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--inkt-zacht)', margin: '0 0 12px' }}>
          Nog geen regels. Voeg hieronder een product toe.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--inkt-zacht)' }}>
              <th style={{ padding: '4px 6px' }}>Regel</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Aantal</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Inkoop</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Marge</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Verkoop</th>
              <th style={{ padding: '4px 6px' }}> </th>
            </tr>
          </thead>
          <tbody>
            {pakket.regels.map((regel: Pakketregel) => (
              <tr key={regel.id} style={{ borderTop: '1px solid var(--rand)' }}>
                <td style={{ padding: '5px 6px' }}>{regel.naam}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{regel.quantity}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {regel.purchase_price_cents === null
                    ? '—'
                    : formatCurrency(regel.purchase_price_cents)}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {regel.margin_bp === null ? '—' : formatBp(regel.margin_bp)}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  {formatCurrency(regel.verkoop_cents)}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => verwijderen.mutate(regel.id)}
                    style={{ ...dialoogKnop, color: 'var(--ziekte)' }}
                  >
                    Weg
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}
      >
        <label style={{ fontSize: 12 }} htmlFor="pk-regel-product">
          <span style={{ color: 'var(--inkt-zacht)' }}>Product</span>
          <select
            id="pk-regel-product"
            className="focus-ring"
            value={productId}
            onChange={(event) => setProductId(Number(event.target.value))}
            style={{ ...invoerStijl, width: 240, marginTop: 3, display: 'block' }}
          >
            <option value={0}>— kies —</option>
            {(producten.data?.data ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12 }} htmlFor="pk-regel-aantal">
          <span style={{ color: 'var(--inkt-zacht)' }}>Aantal</span>
          <input
            id="pk-regel-aantal"
            className="focus-ring"
            type="number"
            step={0.5}
            value={aantal}
            onChange={(event) => setAantal(event.target.value)}
            style={{ ...invoerStijl, width: 90, marginTop: 3, display: 'block' }}
          />
        </label>
        <label style={{ fontSize: 12 }} htmlFor="pk-regel-marge">
          <span style={{ color: 'var(--inkt-zacht)' }}>Marge op inkoop (%)</span>
          <input
            id="pk-regel-marge"
            className="focus-ring"
            type="number"
            step={0.5}
            placeholder="leeg = verkoopprijs"
            value={marge}
            onChange={(event) => setMarge(event.target.value)}
            style={{ ...invoerStijl, width: 150, marginTop: 3, display: 'block' }}
          />
        </label>
        <button
          type="button"
          className="focus-ring"
          disabled={productId === 0 || toevoegen.isPending}
          onClick={() => toevoegen.mutate()}
          style={{ ...dialoogKnop, opacity: productId === 0 ? 0.5 : 1 }}
        >
          {toevoegen.isPending ? 'Bezig…' : 'Regel toevoegen'}
        </button>
      </div>

      {voorbeeld !== null && gekozenProduct && (
        <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '8px 0 0' }}>
          {formatCurrency(gekozenProduct.purchase_price_cents)} inkoop plus {marge}% wordt{' '}
          <strong>{formatCurrency(voorbeeld)}</strong> verkoop.
        </p>
      )}

      {fout !== null && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--ziekte)', margin: '8px 0 0' }}>
          {fout}
        </p>
      )}

      <Kaart>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, marginTop: 4 }}>
          <span>
            Kostprijs <strong>{formatCurrency(pakket.prijs.kostprijsCents)}</strong>
          </span>
          <span>
            Verkoop excl. btw <strong>{formatCurrency(pakket.prijs.subtotaalCents)}</strong>
          </span>
          <span>
            Marge{' '}
            <strong>
              {formatCurrency(pakket.prijs.margeCents)} · {formatBp(pakket.prijs.margeBp)}
            </strong>
          </span>
        </div>
      </Kaart>
    </div>
  );
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
