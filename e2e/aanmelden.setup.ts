/**
 * Eén keer inloggen per rol, en de sessie bewaren (hoofdstuk 13).
 *
 * Elk scenario apart laten inloggen liep stuk op de snelheidsbegrenzing van
 * tien pogingen per kwartier — precies zoals bedoeld, maar niet handig als de
 * tests zelf de aanvaller spelen. Bijkomend voordeel: het scheelt bij elk
 * scenario een paar seconden.
 */
import { expect, test as setup } from '@playwright/test';
import { BEHEERDER, MEEKIJKER, WACHTWOORD } from './rollen.ts';

async function meldAan(page: import('@playwright/test').Page, email: string, bestand: string) {
  await page.goto('/');
  await page.getByLabel(/e-mailadres/i).fill(email);
  await page.getByLabel(/wachtwoord/i).fill(WACHTWOORD);
  await page.getByRole('button', { name: /inloggen/i }).click();

  await expect(page.getByRole('navigation', { name: /hoofdnavigatie/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.context().storageState({ path: bestand });
}

setup('aanmelden als beheerder', async ({ page }) => {
  await meldAan(page, BEHEERDER.email, BEHEERDER.sessie);
});

setup('aanmelden als meekijker', async ({ page }) => {
  await meldAan(page, MEEKIJKER.email, MEEKIJKER.sessie);
});
