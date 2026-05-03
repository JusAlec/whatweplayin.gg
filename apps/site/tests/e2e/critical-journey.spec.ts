import { test, expect } from '@playwright/test';
import { setupFixture, teardownFixture } from './fixtures/setup.js';

test.beforeAll(() => setupFixture());
test.afterAll(() => teardownFixture());

test('user can lock in a recommendation in under 60s', async ({ page }) => {
  // Pre-seed localStorage to skip the lock screen
  await page.addInitScript(() => {
    localStorage.setItem('gno:auth', JSON.stringify({ groupId: 'e2etest', secret: 'devsecret' }));
  });

  // Home page loads with the correct heading
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'GameNight OS' })).toBeVisible();

  // Navigate to session setup
  await page.getByRole('link', { name: /Start Tonight's Session/i }).click();
  await expect(page.getByRole('heading', { name: 'Tonight' })).toBeVisible();

  // Kick off the recommendation — SessionSetup uses window.location.href so
  // we explicitly wait for the URL to change to /session/recommend
  await page.getByRole('button', { name: /Get Recommendation/i }).click();
  await page.waitForURL(/\/session\/recommend/, { timeout: 10_000 });

  // Allow up to 10s for the recommendation engine (local + worker /state call)
  // to render a pick card with a "Lock in this pick" button
  await expect(page.getByRole('button', { name: /Lock in this pick/i }).first()).toBeVisible({
    timeout: 10_000,
  });

  // Lock in the top pick — triggers worker POST + PUT, then navigates to /
  await page
    .getByRole('button', { name: /Lock in this pick/i })
    .first()
    .click();

  // Home page should now show the "In progress" section for the locked game
  await expect(page.getByText(/In progress/i)).toBeVisible({ timeout: 5_000 });
});
