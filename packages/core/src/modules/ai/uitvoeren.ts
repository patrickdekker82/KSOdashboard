/**
 * Een preset uitvoeren (hoofdstuk 6.8).
 *
 * De volgorde is met opzet star:
 *
 *   1. preset lezen en controleren of hij aan staat
 *   2. dossier en context uit de database halen
 *   3. het sjabloon invullen
 *   4. anonimiseren — als de preset dat vraagt
 *   5. vangrail: staat er echt niets persoonlijks meer in?
 *   6. pas dán het netwerk op
 *   7. de plaatshouders terugzetten
 *   8. loggen wat het gekost heeft, ook als het misging
 *
 * Stap 5 is er omdat stap 4 een bug kan hebben. Als de vangrail iets vindt,
 * gaat het verzoek niet weg. Dat is vervelend voor de gebruiker en goed voor
 * de klant.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { bouwContext } from '../email/context.ts';
import { vulSjabloonIn } from '../email/template.ts';
import {
  anonimiseer,
  bouwWoordenboek,
  herstel,
  onbekendePlaatshouders,
  restantenPersoonsgegevens,
  type Woordenboek,
} from './anonimiseer.ts';
import { bekendeGegevens, bouwDossier, CONTEXTBLOKKEN, ONDERWERPEN } from './dossier.ts';
import { AiFout, type Model } from './client.ts';
import { raamKosten } from './prijzen.ts';

type Rij = Record<string, unknown>;

export type Preset = {
  id: number;
  naam: string;
  omschrijving: string | null;
  categorie: string | null;
  systeemPrompt: string;
  gebruikersSjabloon: string;
  model: string;
  maxTokens: number;
  context: string[];
  anonimiseren: boolean;
  uitvoerdoel: string | null;
  actief: boolean;
};

export type Uitvoering = {
  runId: number;
  tekst: string;
  model: string;
  invoertokens: number;
  uitvoertokens: number;
  kostenCenten: number | null;
  duurMs: number;
  /** Hoeveel gegevens er vervangen zijn voordat het verzoek wegging. */
  vervangen: number;
  /** Plaatshouders die het model verzon; die staan nog in de tekst. */
  onbekend: string[];
  /** Plaatshouders in het sjabloon die niet ingevuld konden worden. */
  ontbrekend: string[];
};

/** Zet een databaserij om in een preset. */
export function leesPreset(rij: Rij): Preset {
  let context: string[] = [];
  try {
    const gelezen: unknown = JSON.parse(String(rij.include_context ?? '[]'));
    if (Array.isArray(gelezen)) {
      context = gelezen.map(String).filter((blok) => CONTEXTBLOKKEN.has(blok));
    }
  } catch {
    // Een preset met onleesbare JSON krijgt geen context in plaats van een
    // crash; het scherm laat dan zien dat er niets geselecteerd is.
    context = [];
  }

  return {
    id: Number(rij.id),
    naam: String(rij.name ?? ''),
    omschrijving: rij.description === null || rij.description === undefined ? null : String(rij.description),
    categorie: rij.category === null || rij.category === undefined ? null : String(rij.category),
    systeemPrompt: String(rij.system_prompt ?? ''),
    gebruikersSjabloon: String(rij.user_prompt_template ?? ''),
    model: String(rij.model ?? 'claude-opus-5'),
    maxTokens: Number(rij.max_tokens ?? 2048),
    context,
    anonimiseren: Number(rij.anonymise_personal_data ?? 1) === 1,
    uitvoerdoel: rij.output_target === null || rij.output_target === undefined ? null : String(rij.output_target),
    actief: Number(rij.active ?? 1) === 1 && rij.archived_at === null,
  };
}

/** Alle presets, of alleen de actieve. */
export function laadPresets(handle: DatabaseHandle, alleenActieve = false): Preset[] {
  const rijen = handle.raw
    .prepare(
      `SELECT * FROM ai_presets
        WHERE archived_at IS NULL ${alleenActieve ? 'AND active = 1' : ''}
     ORDER BY category, name`,
    )
    .all() as Rij[];

  return rijen.map(leesPreset);
}

export function laadPreset(handle: DatabaseHandle, presetId: number): Preset | null {
  const rij = handle.raw.prepare('SELECT * FROM ai_presets WHERE id = ?').get(presetId) as
    | Rij
    | undefined;

  return rij === undefined ? null : leesPreset(rij);
}

export type Opdracht = {
  presetId: number;
  entiteit: string;
  recordId: number;
  /** Wat de gebruiker er zelf bij typt. Gaat door dezelfde anonimisering. */
  aanvulling?: string;
};

export type Voorbereid = {
  preset: Preset;
  systeem: string;
  gebruiker: string;
  woordenboek: Woordenboek;
  ontbrekend: string[];
};

/**
 * Alles tot en met de vangrail, zonder netwerk.
 *
 * Apart van `voerUit` zodat het scherm kan laten zien wát er verstuurd zou
 * worden, vóórdat het verstuurd wordt. Wie op "Bekijk wat er weggaat" klikt,
 * krijgt letterlijk de tekst te zien die de deur uit gaat.
 */
export function bereidVoor(
  handle: DatabaseHandle,
  opdracht: Opdracht,
  gebruikerId: number,
): Voorbereid {
  const preset = laadPreset(handle, opdracht.presetId);
  if (preset === null) throw new AiFout('niet_gevonden', 'Deze preset bestaat niet.');
  if (!preset.actief) throw new AiFout('preset_uit', `De preset "${preset.naam}" staat uit.`);
  if (!ONDERWERPEN.has(opdracht.entiteit)) {
    throw new AiFout('onderwerp_onbekend', 'Over dit soort record kan de assistent niets zeggen.');
  }

  const context = bouwContext(handle, opdracht.entiteit, opdracht.recordId, gebruikerId);
  const dossier = bouwDossier(handle, opdracht.entiteit, opdracht.recordId, preset.context);
  const ingevuld = vulSjabloonIn(preset.gebruikersSjabloon, context);

  const delen = [ingevuld.tekst.trim(), dossier.trim(), (opdracht.aanvulling ?? '').trim()].filter(
    (deel) => deel !== '',
  );

  if (delen.length === 0) {
    throw new AiFout(
      'niets_te_vragen',
      'Deze preset heeft geen sjabloon en geen context, dus er valt niets te vragen. Vul bij Instellingen › AI een sjabloon in.',
    );
  }

  const ruw = delen.join('\n\n');

  if (!preset.anonimiseren) {
    return {
      preset,
      systeem: preset.systeemPrompt,
      gebruiker: ruw,
      woordenboek: { vervangingen: [] },
      ontbrekend: ingevuld.ontbrekend,
    };
  }

  const bekend = bekendeGegevens(handle, opdracht.entiteit, opdracht.recordId);
  const woordenboek = bouwWoordenboek(ruw, bekend);
  const veilig = anonimiseer(ruw, woordenboek);

  const restanten = restantenPersoonsgegevens(veilig, woordenboek);
  if (restanten.length > 0) {
    throw new AiFout(
      'anonimisering_onvolledig',
      `Het verzoek is niet verstuurd: er staan nog persoonsgegevens in (${restanten
        .slice(0, 3)
        .join(', ')}). Zet het anonimiseren uit als u dit bewust wilt versturen, of pas de tekst aan.`,
    );
  }

  return {
    preset,
    systeem: preset.systeemPrompt,
    gebruiker: veilig,
    woordenboek,
    ontbrekend: ingevuld.ontbrekend,
  };
}

/**
 * Voert de preset uit: bereidt voor, vraagt het model, zet de gegevens terug.
 *
 * Elke poging komt in `ai_runs`, ook een mislukte. Dat is niet alleen voor de
 * kosten: als er iets misgaat wil je kunnen terugzien wanneer, met welk model,
 * en over welk record — en dat laatste staat er als verwijzing in, niet als
 * inhoud.
 */
export async function voerUit(
  handle: DatabaseHandle,
  model: Model,
  opdracht: Opdracht,
  gebruikerId: number,
): Promise<Uitvoering> {
  const voorbereid = bereidVoor(handle, opdracht, gebruikerId);
  const begin = Date.now();

  try {
    const antwoord = await model.vraag({
      model: voorbereid.preset.model,
      systeem: voorbereid.systeem,
      gebruiker: voorbereid.gebruiker,
      maxTokens: voorbereid.preset.maxTokens,
    });

    const duurMs = Date.now() - begin;
    const kostenCenten = raamKosten(
      voorbereid.preset.model,
      antwoord.invoertokens,
      antwoord.uitvoertokens,
    );
    const tekst = herstel(antwoord.tekst, voorbereid.woordenboek);

    const runId = legVast(handle, {
      presetId: voorbereid.preset.id,
      gebruikerId,
      model: voorbereid.preset.model,
      samenvatting: samenvatting(voorbereid.preset, opdracht),
      invoertokens: antwoord.invoertokens,
      uitvoertokens: antwoord.uitvoertokens,
      kostenCenten: kostenCenten ?? 0,
      duurMs,
      status: 'ok',
      fout: null,
      entiteit: opdracht.entiteit,
      recordId: opdracht.recordId,
    });

    return {
      runId,
      tekst,
      model: voorbereid.preset.model,
      invoertokens: antwoord.invoertokens,
      uitvoertokens: antwoord.uitvoertokens,
      kostenCenten,
      duurMs,
      vervangen: voorbereid.woordenboek.vervangingen.length,
      onbekend: onbekendePlaatshouders(antwoord.tekst, voorbereid.woordenboek),
      ontbrekend: voorbereid.ontbrekend,
    };
  } catch (fout) {
    const aiFout = fout instanceof AiFout ? fout : new AiFout('onbekende_fout', String(fout));

    legVast(handle, {
      presetId: voorbereid.preset.id,
      gebruikerId,
      model: voorbereid.preset.model,
      samenvatting: samenvatting(voorbereid.preset, opdracht),
      invoertokens: 0,
      uitvoertokens: 0,
      kostenCenten: 0,
      duurMs: Date.now() - begin,
      status: 'fout',
      fout: `${aiFout.code}: ${aiFout.message}`,
      entiteit: opdracht.entiteit,
      recordId: opdracht.recordId,
    });

    throw aiFout;
  }
}

/**
 * De omschrijving in het logboek.
 *
 * Bewust géén promptinhoud: die bevat klantgegevens, en het logboek is voor
 * iedere manager zichtbaar. De naam van de preset en het record zeggen genoeg
 * om te snappen wat er gebeurd is.
 */
function samenvatting(preset: Preset, opdracht: Opdracht): string {
  return `${preset.naam} · ${opdracht.entiteit} #${opdracht.recordId}`;
}

type Logregel = {
  presetId: number;
  gebruikerId: number;
  model: string;
  samenvatting: string;
  invoertokens: number;
  uitvoertokens: number;
  kostenCenten: number;
  duurMs: number;
  status: string;
  fout: string | null;
  entiteit: string;
  recordId: number;
};

function legVast(handle: DatabaseHandle, regel: Logregel): number {
  handle.raw
    .prepare(
      `INSERT INTO ai_runs (
         preset_id, user_id, model, prompt_summary,
         input_tokens, output_tokens, cost_estimate_cents, duration_ms,
         status, error, entity_key, record_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      regel.presetId,
      regel.gebruikerId,
      regel.model,
      regel.samenvatting,
      regel.invoertokens,
      regel.uitvoertokens,
      regel.kostenCenten,
      regel.duurMs,
      regel.status,
      regel.fout,
      regel.entiteit,
      regel.recordId,
    );

  const rij = handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return Number(rij.id);
}

/** Het verbruik per maand, voor het logboekscherm. */
export function verbruikPerMaand(handle: DatabaseHandle, maanden = 12): Rij[] {
  return handle.raw
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS maand,
              COUNT(*)                      AS aanroepen,
              SUM(input_tokens)             AS invoer,
              SUM(output_tokens)            AS uitvoer,
              SUM(cost_estimate_cents)      AS centen,
              SUM(status <> 'ok')           AS fouten
         FROM ai_runs
     GROUP BY maand
     ORDER BY maand DESC
        LIMIT ?`,
    )
    .all(maanden) as Rij[];
}
