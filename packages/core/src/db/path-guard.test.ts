import { describe, expect, it } from 'vitest';
import { checkDatabasePath } from './path-guard.ts';

describe('databaselocatie blokkeren (hoofdstuk 2.3)', () => {
  it('staat een gewone lokale map toe', () => {
    expect(checkDatabasePath('C:\\Users\\patrick\\AppData\\Roaming\\ShowroomSuite')).toEqual({
      ok: true,
    });
    expect(checkDatabasePath('D:\\Data\\Showroom')).toEqual({ ok: true });
  });

  it('blokkeert een UNC-pad met uitleg', () => {
    const verdict = checkDatabasePath('\\\\server\\showroom\\data');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('unc');
    expect(verdict.message).toContain('netwerkshare');
    expect(verdict.message).toContain('hostmodus');
  });

  it('blokkeert een toegewezen netwerkschijf', () => {
    const verdict = checkDatabasePath('Z:\\showroom\\data', ['Z']);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('netwerkschijf');
    expect(verdict.message).toContain('back-uppad');
  });

  it('laat dezelfde letter door wanneer het geen netwerkschijf is', () => {
    expect(checkDatabasePath('Z:\\showroom\\data', ['X'])).toEqual({ ok: true });
  });

  it('blokkeert bekende synchronisatiemappen', () => {
    for (const path of [
      'C:\\Users\\patrick\\OneDrive\\Showroom',
      'C:\\Users\\patrick\\OneDrive - Bouwbedrijf\\Showroom',
      'C:\\Users\\patrick\\Dropbox\\db',
      'C:\\Users\\patrick\\Google Drive\\db',
    ]) {
      const verdict = checkDatabasePath(path);
      expect(verdict.ok, path).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.reason).toBe('synchronisatiemap');
    }
  });

  it('laat een map die alleen toevallig zo heet met rust', () => {
    // "Onedriveronderdelen" is geen synchronisatiemap.
    expect(checkDatabasePath('C:\\Data\\Onedriveronderdelen\\db')).toEqual({ ok: true });
  });

  it('herkent ook vooruit geschreven scheidingstekens', () => {
    expect(checkDatabasePath('C:/Users/patrick/OneDrive/Showroom').ok).toBe(false);
  });
});
