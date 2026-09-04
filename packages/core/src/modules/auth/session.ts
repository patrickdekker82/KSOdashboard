/**
 * Sessions (hoofdstuk 10).
 *
 * The database only ever stores the SHA-256 hash of a session token, so a
 * leaked database file does not hand out live sessions. The token itself lives
 * in an httpOnly cookie.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseHandle } from '../../db/client.ts';
import type { UserRole } from '@showroom/shared';

/** Sessions last 30 days and are extended on use. */
export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = 'showroom_sessie';

export type SessionUser = {
  id: number;
  name: string;
  initials: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
  isKopersbegeleider: boolean;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison, so a wrong token cannot be found byte by byte. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function expiryFrom(now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}

export function createSession(
  handle: DatabaseHandle,
  userId: number,
  context: { ip?: string; userAgent?: string } = {},
  now = new Date(),
): string {
  const token = generateToken();
  handle.raw
    .prepare(
      'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, expiryFrom(now), context.ip ?? null, context.userAgent ?? null);
  handle.raw
    .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
    .run(userId);
  return token;
}

/**
 * Resolves a session token to a user, extending the session on the way.
 * Returns null for an unknown, expired or archived-user session.
 */
export function resolveSession(
  handle: DatabaseHandle,
  token: string,
  now = new Date(),
): SessionUser | null {
  const row = handle.raw
    .prepare(
      `SELECT s.expires_at, u.id, u.name, u.initials, u.email, u.role,
              u.must_change_password, u.is_kopersbegeleider, u.active, u.archived_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(hashToken(token)) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() < now.getTime()) {
    deleteSession(handle, token);
    return null;
  }
  if (Number(row.active) !== 1 || row.archived_at !== null) return null;

  // Rolling expiry: an active user is never logged out mid-week.
  handle.raw
    .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .run(expiryFrom(now), hashToken(token));

  return {
    id: Number(row.id),
    name: String(row.name),
    initials: String(row.initials),
    email: String(row.email),
    role: String(row.role) as UserRole,
    mustChangePassword: Number(row.must_change_password) === 1,
    isKopersbegeleider: Number(row.is_kopersbegeleider) === 1,
  };
}

export function deleteSession(handle: DatabaseHandle, token: string): void {
  handle.raw.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

/** "Log alle sessies uit" for one user, or for everyone when userId is null. */
export function deleteAllSessions(handle: DatabaseHandle, userId: number | null = null): number {
  const statement =
    userId === null
      ? handle.raw.prepare('DELETE FROM sessions')
      : handle.raw.prepare('DELETE FROM sessions WHERE user_id = ?');
  const result = userId === null ? statement.run() : statement.run(userId);
  return Number(result.changes ?? 0);
}

export function purgeExpiredSessions(handle: DatabaseHandle, now = new Date()): number {
  const result = handle.raw
    .prepare('DELETE FROM sessions WHERE expires_at < ?')
    .run(now.toISOString());
  return Number(result.changes ?? 0);
}

// ---------------------------------------------------------------------------
// Autorisatie
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<UserRole, number> = {
  readonly: 0,
  user: 1,
  manager: 2,
  admin: 3,
};

/** True when `role` is at least `minimum`. Enforced server-side per endpoint. */
export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Whether a role may change data at all. */
export function canWrite(role: UserRole): boolean {
  return role !== 'readonly';
}

/**
 * Whether the viewer may see the *type* of someone's absence.
 * Everyone can see that a colleague is away — that is needed for planning —
 * but the type (sickness above all) is for managers and the person themselves
 * (hoofdstuk 10).
 */
export function maySeeAbsenceType(
  viewer: SessionUser,
  absenceUserId: number,
  typeVisibility: 'iedereen' | 'management',
): boolean {
  if (typeVisibility === 'iedereen') return true;
  if (viewer.id === absenceUserId) return true;
  return roleAtLeast(viewer.role, 'manager');
}
