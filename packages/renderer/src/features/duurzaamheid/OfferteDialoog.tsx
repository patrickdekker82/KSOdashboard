/** Een offerte samenstellen uit een pakket (hoofdstuk 6.5). */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@showroom/shared';
import { ApiFout, endpoints, type PakketMetPrijs } from '../../lib/api.ts';
import { Dialoog, dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';

export function OfferteDialoog({
  pakket,
  onSluit,
  onKlaar,
}: {
  pakket: PakketMetPrijs;
  onSluit: () => void;
  onKlaar: (quoteId: number) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [organisatieId, setOrganisatieId] = useState(0);
  const [projectId, setProjectId] = useState(0);
  const [aantal, setAantal] = useState('1');
  const [fout, setFout] = useState<string | null>(null);

  const klanten = useQuery({
    queryKey: ['lijst', 'organizations', 'offerte'],
    queryFn: () => endpoints.lijst<{ id: number; name: string }>('organizations', '?pageSize=200'),
  });
  const projecten = useQuery({
    queryKey: ['lijst', 'projects', 'offerte'],
    queryFn: () =>
      endpoints.lijst<{ id: number; name: string; organization_id: number | null; unit_count: number }>(
        'projects',
        '?pageSize=200',
      ),
  });
  const nummer = useQuery({
    queryKey: ['volgend-offertenummer'],
    queryFn: () => endpoints.volgendOffertenummer(),
  });

  // Alleen projecten van de gekozen klant: een offerte voor een project van een
  // andere klant is bijna altijd een vergissing.
  const zichtbareProjecten = useMemo(
    () =>
      (projecten.data?.data ?? []).filter(
        (project) => organisatieId === 0 || project.organization_id === organisatieId,
      ),
    [projecten.data, organisatieId],
  );

  const aantalGetal = Number(aantal.replace(',', '.'));
  const geldig = Number.isFinite(aantalGetal) && aantalGetal > 0;

  const maken = useMutation({
    mutationFn: () =>
      endpoints.offerteVanPakket({
        packageId: pakket.id,
        organizationId: organisatieId > 0 ? organisatieId : null,
        projectId: projectId > 0 ? projectId : null,
        aantal: aantalGetal,
      }),
    onSuccess: (antwoord) => {
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'package-quotes'] });
      void queryClient.invalidateQueries({ queryKey: ['volgend-offertenummer'] });
      onKlaar(antwoord.data.quoteId);
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De offerte kon niet worden aangemaakt.'),
  });

  return (
    <Dialoog titel={`Offerte maken — ${pakket.name}`} onSluit={onSluit}>
      <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 12px', lineHeight: 1.6 }}>
        De offerte wordt een kopie van dit pakket. Latere prijswijzigingen aan het pakket werken er
        niet meer in door — wat de klant heeft gezien, blijft staan.
        {nummer.data?.data.nummer && ` Hij krijgt nummer ${nummer.data.data.nummer}.`}
      </p>

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Klant
        <select
          className="focus-ring"
          value={organisatieId}
          onChange={(event) => {
            setOrganisatieId(Number(event.target.value));
            setProjectId(0);
          }}
          style={{ ...dialoogSelect, marginTop: 3 }}
        >
          <option value={0}>— geen klant —</option>
          {(klanten.data?.data ?? []).map((klant) => (
            <option key={klant.id} value={klant.id}>
              {klant.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Project
        <select
          className="focus-ring"
          value={projectId}
          onChange={(event) => {
            const gekozen = Number(event.target.value);
            setProjectId(gekozen);
            // Het aantal woningen van het project is bijna altijd het aantal
            // pakketten; wie het anders wil, past het aan.
            const project = zichtbareProjecten.find((entry) => entry.id === gekozen);
            if (project && project.unit_count > 0) setAantal(String(project.unit_count));
          }}
          style={{ ...dialoogSelect, marginTop: 3 }}
        >
          <option value={0}>— geen project —</option>
          {zichtbareProjecten.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} ({project.unit_count} won.)
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 12 }}>
        Aantal keer dit pakket
        <input
          className="focus-ring"
          inputMode="numeric"
          value={aantal}
          onChange={(event) => setAantal(event.target.value)}
          style={{ ...invoerStijl, width: 100, display: 'block', marginTop: 3 }}
        />
        <span style={{ display: 'block', fontSize: 11, color: 'var(--inkt-stil)', marginTop: 3 }}>
          Alle aantallen in de regels worden hiermee vermenigvuldigd.
        </span>
      </label>

      {geldig && (
        <p style={{ fontSize: 13, marginTop: 12 }}>
          Indicatie:{' '}
          <strong>{formatCurrency(pakket.prijs.totaalCents * Math.round(aantalGetal))}</strong>{' '}
          <span style={{ color: 'var(--inkt-stil)' }}>incl. btw, zonder optionele onderdelen</span>
        </p>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 10 }}>
          {fout}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="focus-ring" onClick={onSluit} style={dialoogKnop}>
          Annuleren
        </button>
        <button
          type="button"
          className="focus-ring"
          disabled={!geldig || maken.isPending}
          onClick={() => maken.mutate()}
          style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
        >
          {maken.isPending ? 'Bezig…' : 'Offerte maken'}
        </button>
      </div>
    </Dialoog>
  );
}
