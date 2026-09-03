import { describe, expect, it } from 'vitest';
import { toIsoDate } from '@showroom/shared';
import {
  easterSunday,
  generateHolidays,
  isLustrumYear,
  koningsdag,
} from './holidays.ts';

/** Published Western (Gregorian) Easter Sunday dates, 2024 t/m 2035. */
const KNOWN_EASTER: Record<number, string> = {
  2024: '2024-03-31',
  2025: '2025-04-20',
  2026: '2026-04-05',
  2027: '2027-03-28',
  2028: '2028-04-16',
  2029: '2029-04-01',
  2030: '2030-04-21',
  2031: '2031-04-13',
  2032: '2032-03-28',
  2033: '2033-04-17',
  2034: '2034-04-09',
  2035: '2035-03-25',
};

describe('paasberekening (Meeus/Jones/Butcher)', () => {
  for (const [year, expected] of Object.entries(KNOWN_EASTER)) {
    it(`Eerste Paasdag ${year} valt op ${expected}`, () => {
      expect(toIsoDate(easterSunday(Number(year)))).toBe(expected);
    });
  }

  it('Eerste Paasdag valt altijd op een zondag', () => {
    for (let year = 2024; year <= 2035; year += 1) {
      expect(easterSunday(year).getUTCDay()).toBe(0);
    }
  });
});

describe('afgeleide feestdagen', () => {
  it('leidt Goede Vrijdag, Tweede Paasdag, Hemelvaart en Pinksteren correct af', () => {
    // 2026: Eerste Paasdag 5 april.
    const holidays = generateHolidays(2026, { includeGoodFriday: true });
    const byName = new Map(holidays.map((holiday) => [holiday.name, holiday.date]));

    expect(byName.get('Goede Vrijdag')).toBe('2026-04-03'); // Pasen - 2
    expect(byName.get('Eerste Paasdag')).toBe('2026-04-05');
    expect(byName.get('Tweede Paasdag')).toBe('2026-04-06'); // Pasen + 1
    expect(byName.get('Hemelvaartsdag')).toBe('2026-05-14'); // Pasen + 39
    expect(byName.get('Eerste Pinksterdag')).toBe('2026-05-24'); // Pasen + 49
    expect(byName.get('Tweede Pinksterdag')).toBe('2026-05-25'); // Pasen + 50
  });

  it('houdt Hemelvaartsdag altijd op een donderdag en Pinksteren op zondag', () => {
    for (let year = 2024; year <= 2035; year += 1) {
      const byName = new Map(generateHolidays(year).map((h) => [h.name, h.date]));
      const ascension = new Date(`${byName.get('Hemelvaartsdag')}T00:00:00Z`);
      const whitsun = new Date(`${byName.get('Eerste Pinksterdag')}T00:00:00Z`);
      expect(ascension.getUTCDay()).toBe(4); // donderdag
      expect(whitsun.getUTCDay()).toBe(0); // zondag
    }
  });
});

describe('Koningsdag', () => {
  it('valt normaal op 27 april', () => {
    expect(toIsoDate(koningsdag(2026))).toBe('2026-04-27'); // maandag
    expect(toIsoDate(koningsdag(2024))).toBe('2024-04-27'); // zaterdag
  });

  it('schuift naar 26 april wanneer 27 april op zondag valt (2025)', () => {
    // 27 april 2025 is een zondag.
    expect(new Date('2025-04-27T00:00:00Z').getUTCDay()).toBe(0);
    expect(toIsoDate(koningsdag(2025))).toBe('2025-04-26');
  });

  it('valt nooit op een zondag', () => {
    for (let year = 2024; year <= 2035; year += 1) {
      expect(koningsdag(year).getUTCDay()).not.toBe(0);
    }
  });
});

describe('Bevrijdingsdag', () => {
  it('staat standaard niet als vrije dag aan', () => {
    const holiday = generateHolidays(2026).find((h) => h.name === 'Bevrijdingsdag');
    expect(holiday?.date).toBe('2026-05-05');
    expect(holiday?.isDayOff).toBe(false);
  });

  it('is alleen vrij in lustrumjaren wanneer die regel aanstaat', () => {
    const options = { includeLiberationDay: true, liberationDayOnlyInLustrumYears: true };
    const lustrum = generateHolidays(2030, options).find((h) => h.name === 'Bevrijdingsdag');
    const gewoon = generateHolidays(2031, options).find((h) => h.name === 'Bevrijdingsdag');
    expect(isLustrumYear(2030)).toBe(true);
    expect(lustrum?.isDayOff).toBe(true);
    expect(gewoon?.isDayOff).toBe(false);
  });

  it('is elk jaar vrij wanneer de lustrumregel uitstaat', () => {
    const options = { includeLiberationDay: true, liberationDayOnlyInLustrumYears: false };
    expect(
      generateHolidays(2031, options).find((h) => h.name === 'Bevrijdingsdag')?.isDayOff,
    ).toBe(true);
  });
});

describe('generateHolidays', () => {
  it('levert elf feestdagen in datumvolgorde', () => {
    const holidays = generateHolidays(2026);
    expect(holidays).toHaveLength(11);
    const dates = holidays.map((holiday) => holiday.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('zet Goede Vrijdag standaard uit als vrije dag', () => {
    const goodFriday = generateHolidays(2026).find((h) => h.name === 'Goede Vrijdag');
    expect(goodFriday).toBeDefined();
    expect(goodFriday?.isDayOff).toBe(false);
  });
});
