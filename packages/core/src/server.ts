/**
 * The core: a Fastify server on loopback, started by the Electron utility
 * process (hoofdstuk 2.2).
 *
 * Keeping the business logic behind HTTP rather than IPC means it is testable
 * without Electron, the host mode of 2.3 costs almost nothing, and the mobile
 * view needs no second implementation.
 */
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { DatabaseHandle } from './db/client.ts';
import { schemaVersion } from './db/migrate.ts';
import {
  SESSION_COOKIE,
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

export type NetworkMode = 'standalone' | 'host' | 'client';

export type CoreOptions = {
  handle: DatabaseHandle;
  /**
   * Shared secret handed to the renderer through preload. On loopback every
   * request must carry it, so another local process cannot reach the API.
   */
  appToken: string;
  mode: NetworkMode;
  logger?: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    core: CoreOptions;
  }
}

export class ApiError extends Error {
  // Geen parameter properties: Node kan TypeScript alleen strippen, niet
  // omzetten, en struikelt daarover bij het draaien van de kern zonder build.
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Endpoints reachable without a session. */
const PUBLIC_PATHS = new Set(['/api/v1/health', '/api/v1/auth/login']);

export async function buildCore(options: CoreOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

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
    app.log.error(error);
    return reply.code(500).send({
      error: { code: 'serverfout', message: 'Er ging iets mis in de kern van de applicatie.' },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'niet_gevonden', message: 'Onbekend adres.' } }),
  );

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

    if (PUBLIC_PATHS.has(new URL(request.url, 'http://localhost').pathname)) return;

    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'niet_ingelogd', message: 'Log eerst in om verder te gaan.' } });
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
        maxAge: 30 * 86_400,
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
