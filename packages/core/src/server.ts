/**
 * The core: a Fastify server on loopback, started by the Electron utility
 * process (hoofdstuk 2.2).
 *
 * Keeping the business logic behind HTTP rather than IPC means it is testable
 * without Electron, the host mode of 2.3 costs almost nothing, and the mobile
 * view needs no second implementation.
 */
import Fastify from 'fastify';
import { ApiError } from './api-error.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseHandle } from './db/client.ts';
import { schemaVersion } from './db/migrate.ts';
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
  deleteAllSessions,
  deleteSession,
  resolveSession,
  roleAtLeast,
  safeEquals,
  type SessionUser,
} from './modules/auth/session.ts';
import { hashPassword, validatePassword, verifyPassword } from './modules/auth/password.ts';
import { registerCapacityRoutes } from './modules/capacity/routes.ts';
import { registerAvailabilityRoutes } from './modules/availability/routes.ts';
import { registerCrudRoutes } from './modules/crud/routes.ts';
import { registerFieldRoutes } from './modules/fields/routes.ts';
import { registerCrmRoutes } from './modules/crm/routes.ts';
import { registerImportRoutes } from './modules/import/routes.ts';
import { registerAlertRoutes } from './modules/alerts/routes.ts';
import { registerPackageRoutes } from './modules/packages/routes.ts';
import { registerEmailRoutes } from './modules/email/routes.ts';
import { registerAttachmentRoutes } from './modules/attachments/routes.ts';
import { registerOpportunityRoutes } from './modules/opportunities/routes.ts';
import { registerAiRoutes } from './modules/ai/routes.ts';
import { registerQueryRoutes } from './modules/query/routes.ts';
import { registerBackupRoutes } from './modules/backup/routes.ts';

export { ApiError };

/**
 * De netwerkstand van de kern.
 *
 * Er was ook een `client`-stand bedacht, waarin de applicatie geen eigen
 * database opent maar met een host praat. Die is nooit gebouwd, en hij is ook
 * niet nodig: wie meekijkt doet dat in de browser op het adres van de host.
 * Eén versie van de schermen, niets aparts om bij te werken. Het derde geval
 * is daarom weg — een stand die je kunt kiezen maar die niets doet, is een val.
 */
export type NetworkMode = 'standalone' | 'host';

export type CoreOptions = {
  handle: DatabaseHandle;
  /**
   * Shared secret handed to the renderer through preload. On loopback every
   * request must carry it, so another local process cannot reach the API.
   */
  appToken: string;
  mode: NetworkMode;
  /** Map met de database, bijlagen, back-ups en logboeken. */
  dataDirectory: string;
  logger?: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    core: CoreOptions;
  }
}


/** `840000` → "14 minuten". Voor de melding bij te veel inlogpogingen. */
function wachttijd(milliseconden: number): string {
  const seconden = Math.ceil(milliseconden / 1000);
  if (seconden < 60) return `${seconden} ${seconden === 1 ? 'seconde' : 'seconden'}`;
  const minuten = Math.ceil(seconden / 60);
  return `${minuten} ${minuten === 1 ? 'minuut' : 'minuten'}`;
}

/** Endpoints reachable without a session. */
const PUBLIC_PATHS = new Set(['/api/v1/health', '/api/v1/auth/login']);

/**
 * Wat een ingelogde gebruiker met een verlopen beginwachtwoord nog wél mag.
 *
 * Precies genoeg om het scherm te bereiken waar hij zijn wachtwoord wijzigt,
 * en om weer weg te kunnen.
 */
const TOEGESTAAN_BIJ_WACHTWOORDWISSEL = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/change-password',
]);

export async function buildCore(options: CoreOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    /*
     * De melding in het Nederlands.
     *
     * De standaardtekst van de plug-in is Engels ("Rate limit exceeded, retry
     * in 14 minutes") en die verscheen gewoon op het inlogscherm, tussen alle
     * Nederlandse teksten door. Een e2e-scenario liep ertegenaan.
     */
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      code: 'te_veel_pogingen',
      // `context.after` is óók Engels ("14 minutes"), dus de wachttijd wordt
      // hier zelf uit de resterende milliseconden opgemaakt.
      message:
        `Te veel pogingen. Probeer het over ${wachttijd(context.ttl)} opnieuw, ` +
        'of vraag een beheerder om uw wachtwoord opnieuw in te stellen.',
    }),
  });

  app.decorateRequest('user', null);
  // Een getter in plaats van een waarde: Fastify 5 waarschuwt terecht tegen
  // het delen van een objectreferentie over requests heen.
  app.decorateRequest('core', { getter: () => options });

  // --- foutafhandeling in het Nederlands ------------------------------------
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({
        error: {
          code: 'validatiefout',
          message: 'De gegevens zijn niet geldig.',
          details: (error as { validation?: unknown }).validation,
        },
      });
    }
    // Fastify weigert zelf ook dingen — een lege body bij content-type json,
    // een te groot verzoek — en dat zijn fouten van de aanroeper. Die als
    // "er ging iets mis in de kern" tonen is onwaar en helpt niemand verder.
    const geweigerd = error as { statusCode?: number; code?: string; message?: string };
    const status = Number(geweigerd.statusCode ?? 500);
    if (status >= 400 && status < 500) {
      return reply.code(status).send({
        error: {
          code: String(geweigerd.code ?? 'ongeldig_verzoek').toLowerCase(),
          message: String(geweigerd.message ?? 'Dit verzoek kon niet worden verwerkt.'),
        },
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: { code: 'serverfout', message: 'Er ging iets mis in de kern van de applicatie.' },
    });
  });

  /*
   * In de hostmodus serveert de kern ook de schermen zelf.
   *
   * Zonder dit krijgt de collega die het adres van de host in zijn browser
   * typt alleen `{"error":"Onbekend adres"}` — en dan bestaat de mobiele
   * weergave uit hoofdstuk 12 alleen op papier. In de alleenstaande modus
   * gebeurt dit niet: daar laadt Electron de bestanden zelf, en een
   * webserver die niemand gebruikt is een aanvalsvlak zonder doel.
   */
  /*
   * De schermen worden in béide standen uitgeleverd, niet alleen in de
   * hostmodus.
   *
   * Het Electron-venster laadde ze eerst van schijf, met `file://` als
   * oorsprong. De kern draait op `http://127.0.0.1:<poort>`, en dat is voor de
   * browser een andere site: een sessiecookie met `sameSite: 'lax'` wordt dan
   * niet bewaard. Inloggen slaagde daardoor wel (200), maar de volgende vraag
   * was weer 401 en de gebruiker belandde zonder melding terug op het
   * inlogscherm. Nu haalt ook het venster de schermen hier op, is alles
   * dezelfde oorsprong, en werkt de cookie zoals bedoeld.
   */
  const schermen = zoekSchermen();
  if (schermen !== null) {
    await app.register(fastifyStatic, { root: schermen, prefix: '/', index: 'index.html' });
  }

  app.setNotFoundHandler((request, reply) => {
    // Alles buiten /api is een route van de schermen: de navigatie loopt via
    // de hash, maar een browser die ververst vraagt het pad zelf op.
    if (schermen !== null && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'niet_gevonden', message: 'Onbekend adres.' } });
  });

  // --- authenticatie --------------------------------------------------------
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;

    // In alleenstaande modus en hostmodus luistert de kern op loopback; het
    // sessietoken uit preload houdt andere lokale processen buiten de deur.
    if (options.mode !== 'host') {
      const provided = request.headers['x-showroom-token'];
      if (typeof provided !== 'string' || !safeEquals(provided, options.appToken)) {
        return reply
          .code(401)
          .send({ error: { code: 'geen_toegang', message: 'Ongeldig of ontbrekend sessietoken.' } });
      }
    }

    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? resolveSession(options.handle, token) : null;

    const pad = new URL(request.url, 'http://localhost').pathname;
    if (PUBLIC_PATHS.has(pad)) return;

    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'niet_ingelogd', message: 'Log eerst in om verder te gaan.' } });
    }

    /*
     * Wie zijn beginwachtwoord nog niet gewijzigd heeft, komt nergens.
     *
     * De installatie zet vijf accounts klaar met hetzelfde wachtwoord, en dat
     * wachtwoord staat in de handleiding. Zonder deze regel blijft dat
     * wachtwoord werken zolang niemand het wijzigt — en in de hostmodus is de
     * applicatie dan voor het hele kantoornetwerk open met een wachtwoord dat
     * iedereen kan opzoeken.
     *
     * Alleen uitloggen, jezelf opvragen en het wachtwoord wijzigen mogen wel;
     * anders kan de gebruiker niet eens het scherm bereiken waar hij het moet
     * veranderen.
     */
    if (request.user.mustChangePassword && !TOEGESTAAN_BIJ_WACHTWOORDWISSEL.has(pad)) {
      return reply.code(403).send({
        error: {
          code: 'wachtwoord_wijzigen',
          message:
            'Wijzig eerst uw wachtwoord. Dit account gebruikt nog het wachtwoord van de installatie.',
        },
      });
    }

    // Autorisatie wordt server-side afgedwongen, niet alleen in de UI verborgen.
    if (request.method !== 'GET' && request.user.role === 'readonly') {
      return reply.code(403).send({
        error: {
          code: 'alleen_lezen',
          message: 'Uw account heeft alleen leesrechten.',
        },
      });
    }
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  await registerCapacityRoutes(app);
  await registerAvailabilityRoutes(app);
  await registerFieldRoutes(app);
  await registerCrmRoutes(app);
  // Vóór de generieke factory: /opportunities/board mag niet als een
  // record-id op /:entity/:id worden gelezen.
  await registerOpportunityRoutes(app);
  await registerAttachmentRoutes(app);
  // Na de bijlagen: die registreren de multipart-plugin die de import gebruikt.
  await registerImportRoutes(app);
  // Vóór de generieke factory: /alerts/rules mag niet als record-id worden gelezen.
  await registerAlertRoutes(app);
  // Ook vóór de factory: /packages/overview mag niet als record-id worden gelezen.
  await registerPackageRoutes(app);
  await registerEmailRoutes(app);
  await registerAiRoutes(app);
  await registerQueryRoutes(app);
  await registerBackupRoutes(app);
  await registerCrudRoutes(app);

  return app;
}

/** Throws unless the caller has at least the given role. */
export function requireRole(request: FastifyRequest, minimum: 'manager' | 'admin'): SessionUser {
  const user = request.user;
  if (!user) throw new ApiError(401, 'niet_ingelogd', 'Log eerst in om verder te gaan.');
  if (!roleAtLeast(user.role, minimum)) {
    throw new ApiError(
      403,
      'geen_rechten',
      minimum === 'admin'
        ? 'Alleen een beheerder mag dit.'
        : 'Alleen een manager of beheerder mag dit.',
    );
  }
  return user;
}

/**
 * Waar de gebouwde schermen staan.
 *
 * Naast de kern in de bundel (`out/main/core/` → `out/renderer/`). In
 * ontwikkeling draait de kern uit de bron en staan ze er niet; dan levert dit
 * `null` op en serveert de kern niets — de ontwikkelserver van Vite doet dat.
 */
function zoekSchermen(): string | null {
  const hier = dirname(fileURLToPath(import.meta.url));
  for (const kandidaat of [join(hier, '../renderer'), join(hier, '../../renderer')]) {
    if (existsSync(join(kandidaat, 'index.html'))) return kandidaat;
  }
  return null;
}

export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new ApiError(401, 'niet_ingelogd', 'Log eerst in om verder te gaan.');
  return request.user;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/v1/health', async (request) => {
    const { handle, mode } = request.core;
    const counts = handle.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return {
      status: 'ok',
      schemaVersion: schemaVersion(handle),
      mode,
      users: Number(counts.n),
      ingelogd: request.user !== null,
    };
  });
}

function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/auth/login',
    {
      // Tien pogingen per kwartier, zoals hoofdstuk 10 voorschrijft.
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const body = request.body as { email?: string; password?: string } | undefined;
      const email = String(body?.email ?? '').trim().toLowerCase();
      const password = String(body?.password ?? '');

      if (!email || !password) {
        throw new ApiError(400, 'onvolledig', 'Vul een e-mailadres en wachtwoord in.');
      }

      const { handle } = request.core;
      const row = handle.raw
        .prepare(
          `SELECT id, password_hash, active, archived_at FROM users
            WHERE lower(email) = ?`,
        )
        .get(email) as Record<string, unknown> | undefined;

      // Dezelfde melding voor een onbekend account en een fout wachtwoord, zodat
      // je via het inlogscherm niet kunt achterhalen wie er een account heeft.
      const invalid = new ApiError(
        401,
        'onjuiste_inloggegevens',
        'Het e-mailadres of wachtwoord klopt niet.',
      );
      if (!row || Number(row.active) !== 1 || row.archived_at !== null) throw invalid;
      if (!(await verifyPassword(String(row.password_hash), password))) throw invalid;

      const token = createSession(handle, Number(row.id), {
        ip: request.ip,
        userAgent: String(request.headers['user-agent'] ?? ''),
      });

      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // Even lang als de sessie zelf; anders staat er een cookie die de
        // server allang niet meer accepteert.
        maxAge: SESSION_TTL_DAYS * 86_400,
      });

      return { gebruiker: resolveSession(handle, token) };
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deleteSession(request.core.handle, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { afgemeld: true };
  });

  app.get('/api/v1/auth/me', async (request) => ({ gebruiker: currentUser(request) }));

  app.post('/api/v1/auth/change-password', async (request) => {
    const user = currentUser(request);
    const body = request.body as { huidig?: string; nieuw?: string } | undefined;
    const current = String(body?.huidig ?? '');
    const next = String(body?.nieuw ?? '');

    const { handle } = request.core;
    const row = handle.raw.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(row.password_hash, current))) {
      throw new ApiError(400, 'wachtwoord_onjuist', 'Het huidige wachtwoord klopt niet.');
    }

    const problems = validatePassword(next);
    if (problems.length > 0) {
      throw new ApiError(
        400,
        'wachtwoord_zwak',
        problems.map((problem) => problem.message).join(' '),
        problems,
      );
    }

    handle.raw
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(await hashPassword(next), user.id);

    // Alle andere sessies uitloggen: een wachtwoordwissel hoort overal te gelden.
    deleteAllSessions(handle, user.id);
    return { gewijzigd: true };
  });
}
