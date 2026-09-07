/**
 * De mobiele weergave van de hostmodus (hoofdstuk 12 en 13).
 *
 * Op een telefoon is het geen andere applicatie maar hetzelfde scherm in een
 * smal venster. Wat er wél anders is, is het menu: dat wordt een lade die over
 * de inhoud schuift. Precies dat stukje bestond tot nu toe alleen op papier —
 * niets controleerde of de lade opengaat, of hij daarna weer dichtgaat, en of
 * er onderweg niet horizontaal gescrold moet worden.
 *
 * Dit scenario draait in het `telefoon`-project uit `playwright.config.ts`,
 * met het schermformaat van een Pixel 7.
 */
import { expect, test } from '@playwright/test';

/** Breedte van het venster; alles wat breder rendert, dwingt zijwaarts scrollen af. */
async function paginabreedte(page: import('@playwright/test').Page): Promise<{
  venster: number;
  inhoud: number;
}> {
  return page.evaluate(() => ({
    venster: window.innerWidth,
    inhoud: document.documentElement.scrollWidth,
  }));
}

test.describe('op een telefoon', () => {
  test('begint met een dichte menulade en de inhoud in beeld', async ({ page }) => {
    await page.goto('/');

    // De hamburgerknop hoort er te zijn...
    await expect(page.getByRole('button', { name: 'Menu openen' })).toBeVisible({
      timeout: 25_000,
    });
    // ...en het menu zelf niet, want dan zag je bij het openen alleen navigatie.
    await expect(page.getByRole('navigation', { name: /hoofdnavigatie/i })).toHaveCount(0);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('opent de lade, kiest een scherm en sluit daarna vanzelf', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu openen' }).click();

    const menu = page.getByRole('navigation', { name: /hoofdnavigatie/i });
    await expect(menu).toBeVisible();

    await menu.getByRole('link', { name: 'Projecten', exact: true }).click();

    // De lade hoort dicht te gaan; blijft hij open, dan staat hij over het
    // scherm heen dat je net gekozen hebt.
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /projecten/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('sluit de lade ook met de sluitknop, zonder te navigeren', async ({ page }) => {
    await page.goto('/#/klanten');
    await page.getByRole('button', { name: 'Menu openen' }).click();

    const menu = page.getByRole('navigation', { name: /hoofdnavigatie/i });
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Menu sluiten' }).click();

    await expect(menu).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('#/klanten');
  });

  test('past de drukste schermen in de breedte van het toestel', async ({ page }) => {
    // Een lijst met veel kolommen en een bord met veel banen zijn de twee
    // plekken waar het misgaat. Ze mogen breed zijn, maar dan binnen hun eigen
    // schuifvenster — de pagina zelf hoort niet mee te schuiven.
    for (const pad of ['/#/dashboard', '/#/klanten', '/#/kansen', '/#/planning']) {
      await page.goto(pad);
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 25_000 });

      const maat = await paginabreedte(page);
      expect(
        maat.inhoud,
        `${pad} rendert ${maat.inhoud}px breed in een venster van ${maat.venster}px`,
      ).toBeLessThanOrEqual(maat.venster + 1);
    }
  });

  test('houdt de zoekbalk bereikbaar naast de menuknop', async ({ page }) => {
    // Ctrl+K bestaat niet op een telefoon; de knop ernaast is dan de enige weg.
    await page.goto('/');

    await page.getByRole('button', { name: /zoeken/i }).click();
    const veld = page.getByLabel('Zoekterm');
    await expect(veld).toBeVisible({ timeout: 25_000 });

    await veld.fill('Meesters');
    await expect(
      page
        .getByRole('listbox')
        .getByText(/Meesters/)
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });
  });
});
