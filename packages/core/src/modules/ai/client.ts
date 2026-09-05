/**
 * De verbinding met de taalmodel-API (hoofdstuk 6.8).
 *
 * Dit is de énige plek in de hele applicatie die het internet op gaat. Alles
 * eromheen — de anonimisering, het logboek, de vangrail — staat er juist om
 * die ene uitgang zo klein en zo zichtbaar mogelijk te houden.
 *
 * De aanroep zit achter een `Model`-interface. Daardoor kunnen de tests de
 * hele keten doorlopen zonder netwerk en zonder sleutel, en dat is precies wat
 * je wil testen: dat er geen persoonsgegevens in het verzoek zitten.
 */
import {
  Anthropic,
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';

export class AiFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AiFout';
    this.code = code;
  }
}

export type Verzoek = {
  model: string;
  systeem: string;
  gebruiker: string;
  maxTokens: number;
};

export type Antwoord = {
  tekst: string;
  invoertokens: number;
  uitvoertokens: number;
  /** `refusal` als het model geweigerd heeft, anders wat de API teruggaf. */
  reden: string;
};

/** Wat de rest van de module nodig heeft. Tests leveren hun eigen versie. */
export type Model = {
  vraag: (verzoek: Verzoek) => Promise<Antwoord>;
};

/**
 * Vertaalt een fout van de SDK naar iets dat een Nederlandse gebruiker snapt.
 *
 * Het gaat via de getypeerde foutklassen van de SDK, niet via het aflezen van
 * foutteksten: die veranderen, de klassen niet.
 */
export function vertaalFout(fout: unknown): AiFout {
  if (fout instanceof AiFout) return fout;

  if (fout instanceof AuthenticationError) {
    return new AiFout(
      'sleutel_ongeldig',
      'De API-sleutel wordt niet geaccepteerd. Controleer hem bij Instellingen › AI.',
    );
  }
  if (fout instanceof PermissionDeniedError) {
    return new AiFout(
      'geen_toegang',
      'Deze API-sleutel heeft geen toegang tot dit model. Kies een ander model of gebruik een andere sleutel.',
    );
  }
  if (fout instanceof NotFoundError) {
    return new AiFout(
      'model_onbekend',
      'Dit model bestaat niet (meer). Kies een ander model bij Instellingen › AI.',
    );
  }
  if (fout instanceof RateLimitError) {
    return new AiFout(
      'te_druk',
      'De dienst is even vol. Probeer het over een minuut opnieuw.',
    );
  }
  if (fout instanceof BadRequestError) {
    return new AiFout('verzoek_geweigerd', `Het verzoek werd geweigerd: ${fout.message}`);
  }
  if (fout instanceof APIConnectionError) {
    return new AiFout(
      'geen_verbinding',
      'Geen verbinding met de dienst. Werkt het internet, en laat de firewall api.anthropic.com door?',
    );
  }
  if (fout instanceof APIError) {
    return new AiFout('api_fout', `De dienst gaf een fout terug (${fout.status}): ${fout.message}`);
  }

  return new AiFout(
    'onbekende_fout',
    fout instanceof Error ? fout.message : 'Er ging iets mis bij het benaderen van de dienst.',
  );
}

/**
 * De echte koppeling.
 *
 * Er wordt gestreamd, ook al is de uitvoer meestal kort: een niet-gestreamd
 * verzoek met een royale `max_tokens` loopt tegen de aanvraagtimeout aan, en
 * dat is precies het soort storing dat je op een drukke dinsdagmiddag niet wil
 * uitleggen. `finalMessage()` levert daarna gewoon het hele antwoord op.
 *
 * `thinking: adaptive` is de stand voor dit model; `budget_tokens` bestaat er
 * niet meer en levert een 400 op.
 */
export function maakModel(apiSleutel: string): Model {
  const client = new Anthropic({ apiKey: apiSleutel });

  return {
    vraag: async (verzoek) => {
      try {
        const stroom = client.messages.stream({
          model: verzoek.model,
          max_tokens: verzoek.maxTokens,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system: verzoek.systeem,
          messages: [{ role: 'user', content: verzoek.gebruiker }],
        });

        const bericht = await stroom.finalMessage();

        if (bericht.stop_reason === 'refusal') {
          throw new AiFout(
            'geweigerd',
            'Het model heeft dit verzoek geweigerd. Pas de preset of de vraag aan.',
          );
        }

        const tekst = bericht.content
          .filter((blok) => blok.type === 'text')
          .map((blok) => blok.text)
          .join('')
          .trim();

        if (tekst === '') {
          throw new AiFout('leeg_antwoord', 'De dienst gaf een leeg antwoord terug.');
        }

        return {
          tekst,
          invoertokens: bericht.usage.input_tokens,
          uitvoertokens: bericht.usage.output_tokens,
          reden: bericht.stop_reason ?? 'onbekend',
        };
      } catch (fout) {
        throw vertaalFout(fout);
      }
    },
  };
}
