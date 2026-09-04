import { describe, expect, it } from 'vitest';
import { hashPassword, validatePassword, verifyPassword } from './password.ts';

describe('wachtwoordbeleid', () => {
  it('accepteert het standaardwachtwoord uit bijlage A', () => {
    expect(validatePassword('Showroom2026!')).toEqual([]);
  });

  it('weigert een te kort wachtwoord', () => {
    const problems = validatePassword('Kort1');
    expect(problems.map((problem) => problem.code)).toContain('te_kort');
  });

  it('vraagt om hoofdletters en een cijfer', () => {
    expect(validatePassword('allemaalkleineletters').map((p) => p.code)).toEqual([
      'hoofdletters',
      'cijfer',
    ]);
  });
});

describe('argon2id', () => {
  it('maakt een argon2id-hash en verifieert die', async () => {
    const stored = await hashPassword('Showroom2026!');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'Showroom2026!')).toBe(true);
    expect(await verifyPassword(stored, 'VerkeerdWachtwoord1')).toBe(false);
  });

  it('geeft voor elk hetzelfde wachtwoord een andere hash (salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('Showroom2026!'), hashPassword('Showroom2026!')]);
    expect(a).not.toBe(b);
  });

  it('geeft false in plaats van een fout bij een kapotte hash', async () => {
    expect(await verifyPassword('geen-geldige-hash', 'Showroom2026!')).toBe(false);
  });
});
