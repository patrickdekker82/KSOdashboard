/**
 * Een bericht opstellen bij een record (hoofdstuk 9).
 *
 * Het bericht gaat niet vanzelf de deur uit. De applicatie stelt het op, legt
 * het vast bij het record en schrijft het weg als .eml — die opent in Outlook
 * als klaargezet concept. De gebruiker leest het na en verstuurt zelf.
 *
 * Dat is een keuze en geen tekortkoming: er hoeft geen token van een mailbox
 * bewaard te worden en er gaat niets naar buiten dat de gebruiker niet zelf
 * verstuurt.
 */
import { useEffect, useState, type JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFout, endpoints, type OpgesteldBericht } from '../../lib/api.ts';
import { Dialoog, dialoogKnop, dialoogSelect, invoerStijl } from '../kansen/Dialoog.tsx';

export function MailDialoog({
  entiteit,
  recordId,
  onSluit,
}: {
  entiteit: string;
  recordId: number;
  onSluit: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState(0);
  const [onderwerp, setOnderwerp] = useState('');
  const [body, setBody] = useState('');
  const [opgesteld, setOpgesteld] = useState<OpgesteldBericht | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const sjablonen = useQuery({
    queryKey: ['mailsjablonen', entiteit],
    queryFn: () => endpoints.mailsjablonen(entiteit),
  });
  const context = useQuery({
    queryKey: ['mailcontext', entiteit, recordId],
    queryFn: () => endpoints.mailContext(entiteit, recordId),
  });

  // Bij het kiezen van een sjabloon nemen we de tekst over, zodat de gebruiker
  // hem nog kan aanpassen voordat de plaatshouders worden ingevuld.
  useEffect(() => {
    const sjabloon = (sjablonen.data?.data ?? []).find((entry) => entry.id === templateId);
    if (!sjabloon) return;
    setOnderwerp(sjabloon.subject);
    setBody(sjabloon.body_html);
  }, [templateId, sjablonen.data]);

  const opstellen = useMutation({
    mutationFn: () =>
      endpoints.mailOpstellen({
        entity: entiteit,
        recordId,
        templateId: templateId > 0 && onderwerp === '' ? templateId : null,
        onderwerp,
        bodyHtml: body,
      }),
    onSuccess: (antwoord) => {
      setOpgesteld(antwoord.data);
      setFout(null);
      void queryClient.invalidateQueries({ queryKey: ['tijdlijn'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Het bericht kon niet worden opgesteld.'),
  });

  const verstuurd = useMutation({
    mutationFn: (id: number) => endpoints.mailVerstuurd(id),
    onSuccess: () => {
      setMelding('Genoteerd als verstuurd.');
      void queryClient.invalidateQueries({ queryKey: ['tijdlijn'] });
    },
    onError: (error: unknown) =>
      setFout(error instanceof ApiFout ? error.message : 'Dat lukte niet.'),
  });

  async function opslaanEml(bericht: OpgesteldBericht): Promise<void> {
    if (!window.showroom) {
      setFout('Een bestand opslaan werkt alleen in de desktop-applicatie.');
      return;
    }
    const uitkomst = (await window.showroom.opslaanAls(bericht.bestandsnaam, bericht.eml)) as
      | { opgeslagen?: boolean; pad?: string }
      | undefined;

    setMelding(
      uitkomst?.opgeslagen
        ? `Opgeslagen als ${uitkomst.pad ?? bericht.bestandsnaam}. Dubbelklik het bestand om het in Outlook te openen.`
        : 'Opslaan afgebroken.',
    );
  }

  const ontvangers = context.data?.data.ontvangers;

  return (
    <Dialoog titel="Bericht opstellen" onSluit={onSluit}>
      {!opgesteld && (
        <>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
            Sjabloon
            <select
              className="focus-ring"
              value={templateId}
              onChange={(event) => setTemplateId(Number(event.target.value))}
              style={{ ...dialoogSelect, marginTop: 3 }}
            >
              <option value={0}>— zelf schrijven —</option>
              {(sjablonen.data?.data ?? []).map((sjabloon) => (
                <option key={sjabloon.id} value={sjabloon.id}>
                  {sjabloon.name}
                </option>
              ))}
            </select>
          </label>

          {ontvangers && (
            <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 12px' }}>
              Aan:{' '}
              {ontvangers.ontvangers.length === 0 ? (
                <span style={{ color: 'var(--ziekte)' }}>
                  geen ontvanger bekend
                  {ontvangers.geweigerd.length > 0 &&
                    ` — ${ontvangers.geweigerd.join(', ')} staat op "niet mailen"`}
                </span>
              ) : (
                ontvangers.ontvangers
                  .map((entry) => `${entry.naam ?? ''} <${entry.adres}>`.trim())
                  .join(', ')
              )}
            </p>
          )}

          <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
            Onderwerp
            <input
              className="focus-ring"
              value={onderwerp}
              onChange={(event) => setOnderwerp(event.target.value)}
              style={{ ...invoerStijl, width: '100%', marginTop: 3 }}
            />
          </label>

          <label style={{ display: 'block', fontSize: 12 }}>
            Bericht
            <textarea
              className="focus-ring"
              rows={8}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              style={{
                ...invoerStijl,
                width: '100%',
                marginTop: 3,
                resize: 'vertical',
                fontFamily: 'monospace',
              }}
            />
          </label>

          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 12, color: 'var(--inkt-zacht)', cursor: 'pointer' }}>
              Beschikbare plaatshouders
            </summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {Object.entries(context.data?.data.waarden ?? {}).map(([naam, waarde]) => (
                <button
                  key={naam}
                  type="button"
                  className="focus-ring"
                  title={waarde}
                  onClick={() => setBody((huidig) => `${huidig}{{${naam}}}`)}
                  style={{ ...dialoogKnop, fontFamily: 'monospace', fontSize: 11 }}
                >
                  {`{{${naam}}}`}
                </button>
              ))}
            </div>
          </details>
        </>
      )}

      {opgesteld && (
        <>
          <p style={{ fontSize: 12, color: 'var(--inkt-zacht)', margin: '0 0 10px', lineHeight: 1.6 }}>
            Het bericht is vastgelegd bij dit record. Sla het op als .eml en dubbelklik het bestand:
            Outlook opent het als concept, u leest het na en verstuurt zelf.
          </p>

          {opgesteld.ontbrekend.length > 0 && (
            <p
              role="alert"
              style={{ fontSize: 12, color: 'var(--ziekte)', margin: '0 0 10px', lineHeight: 1.6 }}
            >
              Let op: {opgesteld.ontbrekend.length} plaatshouder
              {opgesteld.ontbrekend.length === 1 ? '' : 's'} kon niet worden ingevuld en is
              leeggelaten — {opgesteld.ontbrekend.join(', ')}.
            </p>
          )}

          <div style={{ border: '1px solid var(--rand)', borderRadius: 6, padding: 10 }}>
            <p style={{ margin: 0, fontSize: 12 }}>
              <strong>Aan:</strong>{' '}
              {opgesteld.aan.map((entry) => entry.naam ?? entry.adres).join(', ')}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>
              <strong>Onderwerp:</strong> {opgesteld.onderwerp}
            </p>
            <pre
              style={{
                margin: '8px 0 0',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                color: 'var(--inkt-zacht)',
              }}
            >
              {opgesteld.bodyText}
            </pre>
          </div>
        </>
      )}

      {melding && (
        <p role="status" style={{ fontSize: 12, color: 'var(--inkt-zacht)', marginTop: 10 }}>
          {melding}
        </p>
      )}
      {fout && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--ziekte)', marginTop: 10 }}>
          {fout}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" className="focus-ring" onClick={onSluit} style={dialoogKnop}>
          {opgesteld ? 'Sluiten' : 'Annuleren'}
        </button>

        {!opgesteld && (
          <button
            type="button"
            className="focus-ring"
            disabled={opstellen.isPending || onderwerp.trim() === ''}
            onClick={() => opstellen.mutate()}
            style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
          >
            {opstellen.isPending ? 'Bezig…' : 'Opstellen'}
          </button>
        )}

        {opgesteld && (
          <>
            <button
              type="button"
              className="focus-ring"
              onClick={() => verstuurd.mutate(opgesteld.messageId)}
              style={dialoogKnop}
            >
              Ik heb hem verstuurd
            </button>
            <button
              type="button"
              className="focus-ring"
              onClick={() => void opslaanEml(opgesteld)}
              style={{ ...dialoogKnop, background: 'var(--belasting)', color: '#fff', border: 0 }}
            >
              Openen in Outlook (.eml)
            </button>
          </>
        )}
      </div>
    </Dialoog>
  );
}
