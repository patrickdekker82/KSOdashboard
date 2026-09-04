/**
 * Een kans verliezen (hoofdstuk 6.2).
 *
 * Een reden is verplicht: zonder reden is het verliesrapport waardeloos. De
 * kern dwingt dat ook af, maar het scherm zegt het vooraf in plaats van pas
 * na een mislukte poging.
 */
import { useMemo, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints } from '../../lib/api.ts';
import { Dialoog, dialoogKnop, dialoogSelect, invoerStijl } from './Dialoog.tsx';

export function VerliesDialoog({
  kansId,
  kansnaam,
  onSluit,
  onKlaar,
}: {
  kansId: number;
  kansnaam: string;
  onSluit: () => void;
  onKlaar: (melding: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [redenId, setRedenId] = useState(0);
  const [notitie, setNotitie] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const keuzelijsten = useQuery({
    queryKey: ['keuzelijsten'],
    queryFn: () => endpoints.keuzelijsten(),
  });

  const verliesredenLijst = useMemo(
    () => (keuzelijsten.data?.data ?? []).find((lijst) => lijst.key === 'verliesreden') ?? null,
    [keuzelijsten.data],
  );

  const redenen = useQuery({
    queryKey: ['keuzelijstItems', verliesredenLijst?.id],
    queryFn: () => endpoints.keuzelijstItems(verliesredenLijst!.id),
    enabled: verliesredenLijst !== null,
  });

  const verliezen = useMutation({
    mutationFn: () =>
      endpoints.kansVerliezen(
        kansId,
        redenId > 0 ? redenId : null,
        notitie.trim() === '' ? null : notitie.trim(),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kansenbord'] });
      void queryClient.invalidateQueries({ queryKey: ['record', 'opportunities', kansId] });
      void queryClient.invalidateQueries({ queryKey: ['lijst', 'opportunities'] });
      onKlaar('De kans staat op verloren.');
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'De kans kon niet worden afgesloten.'),
  });

  const kanVerliezen = redenId > 0 || notitie.trim() !== '';

  return (
    <Dialoog titel={`Kans verliezen — ${kansnaam}`} onSluit={onSluit}>
      <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 12px', lineHeight: 1.6 }}>
        Alle regels van deze kans worden op verloren gezet en het bedrag telt niet meer mee in de
        trechter. Kies een reden, of licht in het kort toe wat er speelde.
      </p>

      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        Verliesreden
        <select
          className="focus-ring"
          value={redenId}
          onChange={(event) => setRedenId(Number(event.target.value))}
          style={{ ...dialoogSelect, marginTop: 3 }}
        >
          <option value={0}>— geen keuze —</option>
          {(redenen.data?.data ?? []).map((reden) => (
            <option key={reden.id} value={reden.id}>
              {reden.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', fontSize: 12 }}>
        Toelichting
        <textarea
          className="focus-ring"
          rows={3}
          value={notitie}
          onChange={(event) => setNotitie(event.target.value)}
          style={{ ...invoerStijl, width: '100%', marginTop: 3, resize: 'vertical' }}
        />
      </label>

      {!kanVerliezen && (
        <p style={{ fontSize: 11, color: 'var(--inkt-stil)', margin: '6px 0 0' }}>
          Kies een reden of vul een toelichting in voordat u afsluit.
        </p>
      )}

      {fout && (
        <p role="alert" style={{ color: 'var(--ziekte)', fontSize: 12, marginTop: 12 }}>
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
          disabled={verliezen.isPending || !kanVerliezen}
          onClick={() => verliezen.mutate()}
          style={{ ...dialoogKnop, background: 'var(--ziekte)', color: '#fff', border: 0 }}
        >
          {verliezen.isPending ? 'Bezig…' : 'Verliezen'}
        </button>
      </div>
    </Dialoog>
  );
}
