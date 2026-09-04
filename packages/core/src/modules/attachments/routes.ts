/**
 * Bijlagen: uploaden, opsommen, downloaden en verwijderen (hoofdstuk 10).
 *
 * Bestanden staan buiten de database, in de bijlagenmap onder userData, met een
 * naam die wij genereren. Downloaden kan alleen via dit endpoint, en dat vraagt
 * een sessie — een bijlage is nooit een los te raden URL.
 */
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { ENTITY_BY_KEY } from '../crud/registry.ts';
import {
  absoluutBinnenMap,
  BijlageFout,
  controleerBijlage,
  extensieVan,
  genereerOpslagPad,
  MAX_BIJLAGE_BYTES,
  mimetypeVoor,
  veiligeToonNaam,
} from './storage.ts';

type Rij = Record<string, unknown>;

function bijlagenMapVan(dataDirectory: string): string {
  return join(dataDirectory, 'attachments');
}

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_BIJLAGE_BYTES,
      files: 1,
      // Een upload heeft één bestand en een paar korte velden nodig.
      fields: 8,
    },
  });

  app.get('/api/v1/:entity/:id/attachments', async (request) => {
    const params = request.params as { entity: string; id: string };
    if (!ENTITY_BY_KEY.has(params.entity)) {
      throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${params.entity}".`);
    }
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT a.id, a.filename, a.mime, a.size_bytes, a.description, a.uploaded_at, u.name AS door
           FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.entity_key = ? AND a.record_id = ? AND a.archived_at IS NULL
          ORDER BY a.uploaded_at DESC`,
      )
      .all(params.entity, Number(params.id)) as Rij[];
    return { data: rijen };
  });

  app.post('/api/v1/:entity/:id/attachments', async (request, reply) => {
    const params = request.params as { entity: string; id: string };
    if (!ENTITY_BY_KEY.has(params.entity)) {
      throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${params.entity}".`);
    }
    const user = currentUser(request);

    const bestand = await request.file();
    if (!bestand) {
      throw new ApiError(400, 'geen_bestand', 'Er is geen bestand meegestuurd.');
    }

    // Het hele bestand in het geheugen: 25 MB is de bovengrens en dit draait
    // lokaal, dus streamen naar schijf levert hier weinig op en maakt het
    // opruimen bij een afgekeurd bestand ingewikkelder.
    const inhoud = await bestand.toBuffer();

    if (bestand.file.truncated) {
      throw new ApiError(
        413,
        'te_groot',
        'Dit bestand is groter dan 25 MB en is daarom niet opgeslagen.',
      );
    }

    const toonNaam = veiligeToonNaam(bestand.filename ?? 'bijlage');

    let extensie: string;
    try {
      extensie = controleerBijlage(toonNaam, inhoud.byteLength);
    } catch (error) {
      if (error instanceof BijlageFout) {
        throw new ApiError(400, error.code, error.message);
      }
      throw error;
    }

    const map = bijlagenMapVan(request.core.dataDirectory);
    const relatiefPad = genereerOpslagPad(extensie);
    const absoluutPad = absoluutBinnenMap(map, relatiefPad);

    await mkdir(dirname(absoluutPad), { recursive: true });
    await writeFile(absoluutPad, inhoud);

    const omschrijving =
      typeof bestand.fields?.description === 'object' &&
      bestand.fields.description !== null &&
      'value' in bestand.fields.description
        ? String((bestand.fields.description as { value: unknown }).value)
        : null;

    const resultaat = request.core.handle.raw
      .prepare(
        `INSERT INTO attachments
           (entity_key, record_id, filename, stored_path, mime, size_bytes, uploaded_by, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.entity,
        Number(params.id),
        toonNaam,
        relatiefPad,
        mimetypeVoor(extensie),
        inhoud.byteLength,
        user.id,
        omschrijving,
      );

    return reply.code(201).send({
      data: {
        id: Number(resultaat.lastInsertRowid),
        filename: toonNaam,
        mime: mimetypeVoor(extensie),
        size_bytes: inhoud.byteLength,
      },
    });
  });

  app.get('/api/v1/attachments/:id/download', async (request, reply) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);

    const rij = request.core.handle.raw
      .prepare('SELECT * FROM attachments WHERE id = ? AND archived_at IS NULL')
      .get(id) as Rij | undefined;
    if (!rij) throw new ApiError(404, 'niet_gevonden', 'Deze bijlage bestaat niet.');

    const map = bijlagenMapVan(request.core.dataDirectory);
    let absoluutPad: string;
    try {
      absoluutPad = absoluutBinnenMap(map, String(rij.stored_path));
    } catch (error) {
      // Een pad dat buiten de map wijst is een fout in de data, geen
      // gebruikersfout; hem gewoon niet serveren.
      request.log.error({ id, pad: rij.stored_path }, 'bijlagepad buiten de bijlagenmap');
      throw new ApiError(
        500,
        'ongeldig_pad',
        error instanceof BijlageFout ? error.message : 'Deze bijlage kan niet worden geopend.',
      );
    }

    const naam = veiligeToonNaam(String(rij.filename));
    return reply
      .header('content-type', String(rij.mime ?? mimetypeVoor(extensieVan(naam))))
      // `attachment`, niet `inline`: een bijlage wordt gedownload, niet in de
      // app gerenderd.
      .header('content-disposition', `attachment; filename="${naam}"`)
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(absoluutPad));
  });

  app.delete('/api/v1/attachments/:id', async (request) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const rij = handle.raw.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      | Rij
      | undefined;
    if (!rij) throw new ApiError(404, 'niet_gevonden', 'Deze bijlage bestaat niet.');

    handle.raw
      .prepare("UPDATE attachments SET archived_at = datetime('now') WHERE id = ?")
      .run(id);
    handle.raw
      .prepare(
        `INSERT INTO audit_log (user_id, entity_key, record_id, action, before, after)
         VALUES (?, 'attachments', ?, 'verwijderd', ?, NULL)`,
      )
      .run(user.id, id, JSON.stringify({ filename: rij.filename }));

    return { verwijderd: true, herstelbaar: true };
  });

  /**
   * Bestanden die niet meer bij een bijlage horen echt van schijf halen.
   * Apart van het verwijderen, zodat "ongedaan maken" tot dat moment kan.
   */
  app.post('/api/v1/attachments/cleanup', async (request) => {
    requireRole(request, 'admin');
    const dagen = Math.max(1, Number((request.body as { days?: number } | undefined)?.days ?? 30));
    const handle = request.core.handle;
    const map = bijlagenMapVan(request.core.dataDirectory);

    const rijen = handle.raw
      .prepare(
        `SELECT id, stored_path FROM attachments
          WHERE archived_at IS NOT NULL AND archived_at < date('now', ?)`,
      )
      .all(`-${dagen} days`) as Rij[];

    let opgeruimd = 0;
    for (const rij of rijen) {
      try {
        await unlink(absoluutBinnenMap(map, String(rij.stored_path)));
      } catch {
        // Het bestand was al weg; de rij mag alsnog verdwijnen.
      }
      handle.raw.prepare('DELETE FROM attachments WHERE id = ?').run(Number(rij.id));
      opgeruimd += 1;
    }

    return { opgeruimd, ouderDanDagen: dagen };
  });
}
