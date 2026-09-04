/**
 * Het veldenregister (hoofdstuk 3.1).
 *
 * Bewust géén generieke CRUD: bij velden gelden regels die de factory niet
 * kent. Een maatwerkveld mag echt weg, met data en al; een systeemveld nooit,
 * dat kan alleen verborgen of hernoemd worden. En een paar velden (id, naam,
 * status, tijdstempels) mogen zelfs dat niet.
 */
import type { FastifyInstance } from 'fastify';
import {
  CUSTOM_FIELD_KEY_PATTERN,
  FIELD_TYPES,
  FIELD_TYPE_INFO,
  OPERATORS_BY_TYPE,
  toFieldKey,
  type FieldType,
} from '@showroom/shared';
import { ApiError, requireRole } from '../../server.ts';
import { ENTITY_BY_KEY, ENTITIES } from '../crud/registry.ts';
import { BESCHIKBARE_FUNCTIES, checkFormula } from './formula.ts';
import { dropIndex, ensureIndex, IndexFout, removeFieldData } from './index-migration.ts';
import { loadField, loadFields, loadSections } from './repository.ts';

const TOEGESTANE_TABELLEN = ENTITIES.map((entiteit) => entiteit.table);

function entiteitOf(entityKey: string) {
  const definitie = ENTITY_BY_KEY.get(entityKey);
  if (!definitie) {
    throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${entityKey}".`);
  }
  return definitie;
}

/** Controleert een binnenkomende velddefinitie voordat er iets wordt opgeslagen. */
function controleerDefinitie(body: Record<string, unknown>, nieuw: boolean): void {
  if (nieuw) {
    const type = String(body.type ?? '');
    if (!FIELD_TYPES.includes(type as FieldType)) {
      throw new ApiError(
        400,
        'onbekend_type',
        `"${type}" is geen bekend veldtype. Kies uit: ${FIELD_TYPES.join(', ')}.`,
      );
    }
    const sleutel = String(body.field_key ?? '');
    if (!CUSTOM_FIELD_KEY_PATTERN.test(sleutel)) {
      throw new ApiError(
        400,
        'ongeldige_sleutel',
        `"${sleutel}" is geen geldige veldsleutel. Gebruik cf_ gevolgd door kleine ` +
          'letters, cijfers en liggende streepjes.',
      );
    }
  }

  if (typeof body.label === 'string' && body.label.trim() === '') {
    throw new ApiError(400, 'label_leeg', 'Een veld moet een label hebben.');
  }

  // Een formule wordt hier gecontroleerd, niet pas als hij ergens misgaat.
  const validatie = (body.validation ?? {}) as { expression?: string };
  if (body.type === 'formula' || validatie.expression) {
    const expressie = validatie.expression ?? '';
    const resultaat = checkFormula(expressie);
    if (!resultaat.ok) {
      throw new ApiError(400, 'formule_ongeldig', `De formule klopt niet: ${resultaat.fout}`);
    }
  }
}

export async function registerFieldRoutes(app: FastifyInstance): Promise<void> {
  /** Wat een beheerder kan kiezen bij het maken van een veld. */
  app.get('/api/v1/field-types', async () => ({
    data: {
      types: FIELD_TYPES.map((type) => ({
        type,
        ...FIELD_TYPE_INFO[type],
        operators: OPERATORS_BY_TYPE[type],
      })),
      functies: BESCHIKBARE_FUNCTIES,
      entiteiten: ENTITIES.map((entiteit) => entiteit.key),
    },
  }));

  /** Een formule controleren zonder hem op te slaan. */
  app.post('/api/v1/fields/check-formula', async (request) => {
    requireRole(request, 'admin');
    const expressie = String((request.body as { expression?: string } | undefined)?.expression ?? '');
    return { data: checkFormula(expressie) };
  });

  /** Een label omzetten naar een geldige sleutel, voor het formulier. */
  app.post('/api/v1/fields/suggest-key', async (request) => {
    requireRole(request, 'admin');
    const label = String((request.body as { label?: string } | undefined)?.label ?? '');
    return { data: { field_key: toFieldKey(label) } };
  });

  /** Velden en secties van een entiteit. */
  app.get('/api/v1/fields', async (request) => {
    const query = request.query as Record<string, unknown>;
    const entityKey = String(query.entity ?? '');
    entiteitOf(entityKey);
    return {
      data: {
        velden: loadFields(request.core.handle, entityKey, {
          includeArchived: query.includeArchived === 'true',
        }),
        secties: loadSections(request.core.handle, entityKey),
      },
    };
  });

  app.get('/api/v1/fields/:id', async (request) => {
    const veld = loadField(request.core.handle, Number((request.params as { id: string }).id));
    if (!veld) throw new ApiError(404, 'niet_gevonden', 'Dit veld bestaat niet.');
    return { data: veld };
  });

  // --- toevoegen -----------------------------------------------------------
  app.post('/api/v1/fields', async (request, reply) => {
    const user = requireRole(request, 'admin');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const handle = request.core.handle;

    const entityKey = String(body.entity_key ?? '');
    const entiteit = entiteitOf(entityKey);
    if (!entiteit.customFields) {
      throw new ApiError(
        400,
        'geen_maatwerk',
        `Bij "${entityKey}" kunnen geen maatwerkvelden worden toegevoegd.`,
      );
    }

    // Een sleutel mag ontbreken; dan leiden we hem uit het label af.
    if (!body.field_key && typeof body.label === 'string') {
      body.field_key = toFieldKey(body.label);
    }
    controleerDefinitie(body, true);

    const bestaat = handle.raw
      .prepare('SELECT id FROM field_definitions WHERE entity_key = ? AND field_key = ?')
      .get(entityKey, String(body.field_key));
    if (bestaat) {
      throw new ApiError(
        409,
        'sleutel_bestaat',
        `Er bestaat al een veld met de sleutel "${String(body.field_key)}" bij ${entityKey}.`,
      );
    }

    const volgende = handle.raw
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM field_definitions WHERE entity_key = ?')
      .get(entityKey) as { n: number };

    const resultaat = handle.raw
      .prepare(
        `INSERT INTO field_definitions
           (entity_key, field_key, label, help_text, type, storage, is_system, is_locked,
            required, unique_value, default_value, options_source, picklist_id,
            relation_entity, validation, indexed, section_id, sort_order, column_width,
            visible_in_list, visible_in_detail, editable, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'json', 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entityKey,
        String(body.field_key),
        String(body.label ?? body.field_key),
        (body.help_text as string) ?? null,
        String(body.type),
        body.required ? 1 : 0,
        body.unique_value ? 1 : 0,
        (body.default_value as string) ?? null,
        (body.options_source as string) ?? null,
        body.picklist_id === undefined ? null : Number(body.picklist_id),
        (body.relation_entity as string) ?? null,
        JSON.stringify(body.validation ?? {}),
        body.indexed ? 1 : 0,
        body.section_id === undefined ? null : Number(body.section_id),
        Number(body.sort_order ?? volgende.n),
        body.column_width === undefined ? null : Number(body.column_width),
        body.visible_in_list === false ? 0 : 1,
        body.visible_in_detail === false ? 0 : 1,
        1,
        user.id,
        user.id,
      );

    const id = Number(resultaat.lastInsertRowid);
    const veld = loadField(handle, id)!;

    if (veld.indexed) {
      try {
        ensureIndex(handle, entiteit.table, veld.fieldKey, veld.type, TOEGESTANE_TABELLEN);
      } catch (error) {
        // De index is een optimalisatie; het veld zelf blijft bruikbaar.
        handle.raw.prepare('UPDATE field_definitions SET indexed = 0 WHERE id = ?').run(id);
        throw new ApiError(
          400,
          'index_mislukt',
          error instanceof IndexFout
            ? error.message
            : 'Het veld is aangemaakt, maar de index kon niet worden aangelegd.',
        );
      }
    }

    return reply.code(201).send({ data: loadField(handle, id) });
  });

  // --- wijzigen: hernoemen, verplaatsen, verbergen -------------------------
  app.patch('/api/v1/fields/:id', async (request) => {
    const user = requireRole(request, 'admin');
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const handle = request.core.handle;

    const huidig = loadField(handle, id);
    if (!huidig) throw new ApiError(404, 'niet_gevonden', 'Dit veld bestaat niet.');

    // Een vergrendeld veld draagt de identiteit van het record; daar mag niets
    // aan veranderen behalve de plek in de layout.
    if (huidig.isLocked) {
      const verboden = ['label', 'visible_in_list', 'visible_in_detail', 'required', 'type'];
      const geraakt = verboden.filter((sleutel) => sleutel in body);
      if (geraakt.length > 0) {
        throw new ApiError(
          400,
          'veld_vergrendeld',
          `"${huidig.label}" is een vast veld: ${geraakt.join(', ')} kan hier niet gewijzigd worden.`,
        );
      }
    }

    // De sleutel en het type van een bestaand veld liggen vast: anders zou de
    // data die er al in staat ineens iets anders betekenen.
    for (const verboden of ['field_key', 'entity_key', 'storage', 'type']) {
      if (verboden in body && String(body[verboden]) !== String((huidig as never)[verboden])) {
        throw new ApiError(
          400,
          'niet_wijzigbaar',
          `De ${verboden === 'type' ? 'soort' : 'sleutel'} van een bestaand veld kan niet ` +
            'worden gewijzigd. Maak een nieuw veld aan en verplaats de gegevens.',
        );
      }
    }

    controleerDefinitie(body, false);

    const kolommen: Array<[string, unknown]> = [];
    const toegestaan: Record<string, (waarde: unknown) => unknown> = {
      label: String,
      help_text: (waarde) => (waarde === null ? null : String(waarde)),
      required: (waarde) => (waarde ? 1 : 0),
      unique_value: (waarde) => (waarde ? 1 : 0),
      default_value: (waarde) => (waarde === null ? null : String(waarde)),
      options_source: (waarde) => (waarde === null ? null : String(waarde)),
      picklist_id: (waarde) => (waarde === null ? null : Number(waarde)),
      relation_entity: (waarde) => (waarde === null ? null : String(waarde)),
      validation: (waarde) => JSON.stringify(waarde ?? {}),
      section_id: (waarde) => (waarde === null ? null : Number(waarde)),
      sort_order: Number,
      column_width: (waarde) => (waarde === null ? null : Number(waarde)),
      visible_in_list: (waarde) => (waarde ? 1 : 0),
      visible_in_detail: (waarde) => (waarde ? 1 : 0),
      editable: (waarde) => (waarde ? 1 : 0),
    };

    for (const [sleutel, omzetten] of Object.entries(toegestaan)) {
      if (sleutel in body) kolommen.push([sleutel, omzetten(body[sleutel])]);
    }

    if (kolommen.length > 0) {
      handle.raw
        .prepare(
          `UPDATE field_definitions
              SET ${kolommen.map(([sleutel]) => `${sleutel} = ?`).join(', ')},
                  updated_at = datetime('now'), updated_by = ?
            WHERE id = ?`,
        )
        .run(...([...kolommen.map(([, waarde]) => waarde), user.id, id] as never[]));
    }

    // De index aan- of uitzetten is een aparte handeling met echte gevolgen.
    if ('indexed' in body) {
      const wil = Boolean(body.indexed);
      const entiteit = entiteitOf(huidig.entityKey);
      if (huidig.storage !== 'json') {
        throw new ApiError(
          400,
          'geen_maatwerkveld',
          'Alleen maatwerkvelden krijgen een aparte index; systeemvelden hebben er al een.',
        );
      }
      try {
        if (wil && !huidig.indexed) {
          ensureIndex(handle, entiteit.table, huidig.fieldKey, huidig.type, TOEGESTANE_TABELLEN);
        } else if (!wil && huidig.indexed) {
          dropIndex(handle, entiteit.table, huidig.fieldKey, TOEGESTANE_TABELLEN);
        }
        handle.raw
          .prepare('UPDATE field_definitions SET indexed = ? WHERE id = ?')
          .run(wil ? 1 : 0, id);
      } catch (error) {
        throw new ApiError(
          400,
          'index_mislukt',
          error instanceof IndexFout ? error.message : 'De index kon niet worden aangepast.',
        );
      }
    }

    return { data: loadField(handle, id) };
  });

  // --- volgorde ------------------------------------------------------------
  app.post('/api/v1/fields/reorder', async (request) => {
    requireRole(request, 'admin');
    const body = (request.body ?? {}) as {
      entity_key?: string;
      volgorde?: Array<{ id: number; section_id?: number | null; sort_order: number }>;
    };
    const entityKey = String(body.entity_key ?? '');
    entiteitOf(entityKey);

    const handle = request.core.handle;
    const statement = handle.raw.prepare(
      `UPDATE field_definitions
          SET sort_order = ?, section_id = ?, updated_at = datetime('now')
        WHERE id = ? AND entity_key = ?`,
    );

    handle.raw.exec('BEGIN');
    try {
      for (const item of body.volgorde ?? []) {
        statement.run(
          Number(item.sort_order),
          item.section_id === undefined || item.section_id === null ? null : Number(item.section_id),
          Number(item.id),
          entityKey,
        );
      }
      handle.raw.exec('COMMIT');
    } catch (error) {
      handle.raw.exec('ROLLBACK');
      throw error;
    }

    return { data: loadFields(handle, entityKey) };
  });

  // --- archiveren en herstellen -------------------------------------------
  app.delete('/api/v1/fields/:id', async (request) => {
    requireRole(request, 'admin');
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const veld = loadField(handle, id);
    if (!veld) throw new ApiError(404, 'niet_gevonden', 'Dit veld bestaat niet.');

    if (veld.isLocked) {
      throw new ApiError(
        400,
        'veld_vergrendeld',
        `"${veld.label}" is een vast veld en kan niet worden verborgen.`,
      );
    }

    if (veld.storage === 'column') {
      // Een systeemveld heeft een echte kolom; die kan niet weg zonder het
      // datamodel te breken. Verbergen kan wel, en dat is wat de UI aanbiedt.
      handle.raw
        .prepare(
          `UPDATE field_definitions
              SET visible_in_list = 0, visible_in_detail = 0, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .run(id);
      return {
        verborgen: true,
        verwijderd: false,
        melding:
          `"${veld.label}" is een systeemveld. Het is nu overal verborgen, maar de ` +
          'gegevens blijven bestaan; fysiek verwijderen kan niet.',
      };
    }

    handle.raw
      .prepare("UPDATE field_definitions SET archived_at = datetime('now') WHERE id = ?")
      .run(id);
    return {
      gearchiveerd: true,
      verwijderd: false,
      melding:
        `"${veld.label}" is gearchiveerd en verdwijnt uit de schermen. De ingevoerde ` +
        'gegevens blijven bewaard en het veld kan worden teruggehaald.',
    };
  });

  app.post('/api/v1/fields/:id/restore', async (request) => {
    requireRole(request, 'admin');
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;
    const resultaat = handle.raw
      .prepare('UPDATE field_definitions SET archived_at = NULL WHERE id = ?')
      .run(id);
    if (Number(resultaat.changes ?? 0) === 0) {
      throw new ApiError(404, 'niet_gevonden', 'Dit veld bestaat niet.');
    }
    return { data: loadField(handle, id) };
  });

  // --- definitief verwijderen, inclusief data ------------------------------
  app.post('/api/v1/fields/:id/purge', async (request) => {
    requireRole(request, 'admin');
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { bevestiging?: string };
    const handle = request.core.handle;

    const veld = loadField(handle, id);
    if (!veld) throw new ApiError(404, 'niet_gevonden', 'Dit veld bestaat niet.');

    if (veld.storage !== 'json') {
      throw new ApiError(
        400,
        'systeemveld',
        `"${veld.label}" is een systeemveld met een eigen kolom. Dat kan alleen worden ` +
          'verborgen, niet verwijderd.',
      );
    }

    // Dubbele bevestiging: de beheerder moet de sleutel intikken. Dit is de
    // enige handeling in de applicatie die data onherstelbaar weggooit.
    if (body.bevestiging !== veld.fieldKey) {
      throw new ApiError(
        400,
        'bevestiging_onjuist',
        `Typ "${veld.fieldKey}" over om te bevestigen dat dit veld en alle ingevoerde ` +
          'waarden definitief verwijderd worden.',
      );
    }

    const entiteit = entiteitOf(veld.entityKey);
    const user = request.user!;

    handle.raw.exec('BEGIN');
    try {
      const { rijen } = removeFieldData(
        handle,
        entiteit.table,
        veld.fieldKey,
        TOEGESTANE_TABELLEN,
      );
      handle.raw.prepare('DELETE FROM field_definitions WHERE id = ?').run(id);
      handle.raw
        .prepare(
          `INSERT INTO audit_log (user_id, entity_key, record_id, action, before, after)
           VALUES (?, 'field_definitions', ?, 'definitief_verwijderd', ?, NULL)`,
        )
        .run(user.id, id, JSON.stringify({ ...veld, rijen_geraakt: rijen }));
      handle.raw.exec('COMMIT');

      return {
        verwijderd: true,
        rijen,
        melding: `"${veld.label}" is definitief verwijderd uit ${rijen} record(s).`,
      };
    } catch (error) {
      handle.raw.exec('ROLLBACK');
      throw error;
    }
  });
}
