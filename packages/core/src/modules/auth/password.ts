/**
 * Password hashing — hoofdstuk 10.
 *
 * argon2id with the OWASP-recommended parameters. `@node-rs/argon2` ships
 * prebuilt NAPI binaries: ABI-stable, so an Electron upgrade never triggers a
 * native rebuild — the same reasoning behind choosing `node:sqlite` in 2.5.
 */
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

export const ARGON2_OPTIONS = {
  // Algorithm.Argon2id. De enum zelf is een ambient const enum en mag met
  // isolatedModules niet als waarde worden gelezen; 2 is de vaste waarde.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordProblem = { code: string; message: string };

/** Validates a new password against the policy. Returns [] when acceptable. */
export function validatePassword(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    problems.push({
      code: 'te_kort',
      message: `Het wachtwoord moet minimaal ${MINIMUM_PASSWORD_LENGTH} tekens lang zijn.`,
    });
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    problems.push({
      code: 'hoofdletters',
      message: 'Gebruik zowel kleine letters als hoofdletters.',
    });
  }
  if (!/\d/.test(password)) {
    problems.push({ code: 'cijfer', message: 'Gebruik minimaal één cijfer.' });
  }
  return problems;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password. Returns false on a malformed hash rather than throwing,
 * so a corrupted row cannot turn into a 500 on the login endpoint.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
