/**
 * De schermen, via de hostmodus in een browser (hoofdstuk 13).
 *
 * Tot nu toe raakte geen enkele test de renderer aan. Dat is precies de laag
 * waar de fouten zaten die de applicatie onbruikbaar maakten, en waar de
 * hostmodus alleen op papier bestond. Deze scenario's lopen de weg die een
 * gebruiker loopt: inloggen, rondkijken, iets vragen, exporteren.
 *
 * De sessie komt uit `aanmelden.setup.ts`; elk scenario apart laten inloggen
 * liep stuk op de snelheidsbegrenzing — terecht, maar niet handig.
 */
import { expect, test } from '@playwright/test';
import { MEEKIJKER } from './rollen.ts';

test.describe('door de applicatie lopen', () => {
  test('bereikt elk onderdeel uit het menu zonder foutmelding', async ({ page }) => {
    const fouten: string[] = [];
    page.on('pageerror', (fout) => fouten.push(fout.message));

    await page.goto('/');

    for (const label of [
      'Klanten',
      'Contactpersonen',
      'Kansen',
      'Projecten',
      'Planning',
      'Verlof & inzet',
      'Duurzaamheid',
      'Opvolging',
      'Dubbelen',
      'Rapportages',
      'Instellingen',
    ]) {
      await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
      // Elk scherm heeft een kop; zonder die kop is er iets stukgelopen.
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
      // En nergens hoort nog een "nog te bouwen"-scherm te staan.
      await expect(page.getByText(/geen scherm gevonden/i)).toHaveCount(0);
    }

    expect(fouten, `JavaScript-fouten tijdens het rondlopen: ${fouten.join(' | ')}`).toEqual([]);
  });

  test('toont het dashboard met de grafiek die apart geladen wordt', async ({ page }) => {
    // De grafiekcode zit sinds de bundelsplitsing in een eigen bestand dat pas
    // opgehaald wordt als er een grafiek in beeld komt. Hij moet dus wél komen.
    await page.goto('/');

    await expect(page.getByText(/showroombezetting/i)).toBeVisible({ timeout: 25_000 });
  });

  test('toont de klantenlijst met de demo-gegevens erin', async ({ page }) => {
    await page.goto('/#/klanten');

    await expect(page.getByText(/Meesters/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('opent een klant en toont de tijdlijn ernaast', async ({ page }) => {
    await page.goto('/#/klanten');
    await page
      .getByText(/Meesters/)
      .first()
      .click();

    await expect(page.getByText(/tijdlijn/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('rapportages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/rapportages');
    await expect(page.getByRole('heading', { name: /rapportages/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('draait een rapportage over klanten', async ({ page }) => {
    await page.getByLabel(/waarover gaat de rapportage/i).selectOption('organizations');
    await page.getByRole('checkbox', { name: 'name', exact: true }).check();
    await page.getByRole('button', { name: /^draaien$/i }).click();

    await expect(page.getByRole('columnheader', { name: 'name' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/regels? in \d+ ms/i)).toBeVisible();
  });

  test('weigert een rapportage zonder kolommen met een leesbare melding', async ({ page }) => {
    await page.getByRole('button', { name: /^draaien$/i }).click();

    await expect(page.getByText(/minstens één kolom/i)).toBeVisible({ timeout: 20_000 });
  });

  test('toont het SQL-tabblad voor een beheerder', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'SQL', exact: true })).toBeVisible();
  });

  test('weigert een DELETE in de SQL-modus en laat de gegevens staan', async ({ page }) => {
    await page.getByRole('button', { name: 'SQL', exact: true }).click();

    const veld = page.getByRole('textbox', { name: 'Query', exact: true });
    await veld.fill('DELETE FROM organizations');
    await page.getByRole('button', { name: /^draaien$/i }).click();

    await expect(page.getByText(/alleen bevragen mag/i)).toBeVisible({ timeout: 20_000 });

    // En de klanten staan er nog.
    await page.goto('/#/klanten');
    await expect(page.getByText(/Meesters/).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('instellingen', () => {
  test('alle tegels zijn ingevuld, geen enkele zegt nog "komt in fase"', async ({ page }) => {
    await page.goto('/#/instellingen');

    await expect(page.getByRole('heading', { name: /instellingen/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/komt in fase/i)).toHaveCount(0);
  });

  test('de AI-assistent staat uit zolang er geen sleutel is', async ({ page }) => {
    await page.goto('/#/instellingen/ai');

    await expect(page.getByText(/de assistent staat uit/i)).toBeVisible({ timeout: 20_000 });
  });

  test('het back-upscherm maakt een back-up en zet hem in het logboek', async ({ page }) => {
    await page.goto('/#/instellingen/backup');
    await expect(page.getByRole('heading', { name: /back-up & herstel/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: /nu een back-up maken/i }).click();

    await expect(page.getByText(/gemaakt \(/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/showroom-handmatig/).first()).toBeVisible();
  });
});

test.describe('rechten in het scherm', () => {
  test.use({ storageState: MEEKIJKER.sessie });

  test('een meekijker krijgt de SQL-modus niet te zien', async ({ page }) => {
    await page.goto('/#/rapportages');

    await expect(page.getByRole('button', { name: 'Bouwer', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'SQL', exact: true })).toHaveCount(0);
  });
});

test.describe('inloggen', () => {
  // Deze scenario's beginnen zonder sessie.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('toont het inlogscherm zonder sessie', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: /inloggen/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: /hoofdnavigatie/i })).toHaveCount(0);
  });

  test('weigert een fout wachtwoord met een Nederlandse melding', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/e-mailadres/i).fill('patrick@showroom.local');
    await page.getByLabel(/wachtwoord/i).fill('ditklopniet');
    await page.getByRole('button', { name: /inloggen/i }).click();

    // Nederlands, en zonder te verklappen of het account bestaat.
    await expect(page.getByText(/klopt niet/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: /hoofdnavigatie/i })).toHaveCount(0);
  });

  test('houdt elke melding op het inlogscherm in het Nederlands', async ({ page }) => {
    // De snelheidsbegrenzing gaf oorspronkelijk een Engelse tekst terug
    // ("Rate limit exceeded, retry in 14 minutes"), midden tussen de
    // Nederlandse. Een scenario liep daartegenaan; vandaar deze test.
    await page.goto('/');

    for (let poging = 0; poging < 12; poging += 1) {
      await page.getByLabel(/e-mailadres/i).fill('niemand@showroom.local');
      await page.getByLabel(/wachtwoord/i).fill('foutfoutfout');
      await page.getByRole('button', { name: /inloggen/i }).click();
      await page.waitForTimeout(150);
    }

    const melding = page.getByRole('alert');
    await expect(melding).toBeVisible({ timeout: 20_000 });
    await expect(melding).not.toContainText(/rate limit|retry/i);
    await expect(melding).toContainText(/klopt niet|te veel pogingen/i);
  });
});
