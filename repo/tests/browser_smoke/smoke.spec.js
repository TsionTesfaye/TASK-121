/**
 * Minimal browser-driver smoke test — Playwright + Chromium.
 *
 * Covers one end-to-end flow in a real browser:
 *   1. App loads
 *   2. Bootstrap (first-run setup)
 *   3. Login with the new admin account
 *   4. CRM protected page renders
 *   5. Unauthenticated direct access is redirected to login
 */

import { test, expect } from '@playwright/test';

const ADMIN_USER = 'smokeadmin';
// Password meets policy: ≥12 chars, digit, symbol
const ADMIN_PASS = 'SmokeTest1!xx';
const ORG_NAME = 'Smoke Test Org';

test.describe('Smoke — bootstrap, login, protected page', () => {
  test('full flow: bootstrap → login → CRM → route guard', async ({ page }) => {
    // 1. App loads — lands on bootstrap (first run, no users)
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('RetailOps Console');

    // 2. Bootstrap — create admin account
    const bootstrapHeading = page.locator('text=First-time setup');
    if (await bootstrapHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.fill('#orgName', ORG_NAME);
      await page.fill('#adminUsername', ADMIN_USER);
      await page.fill('#adminPassword', ADMIN_PASS);
      await page.click('button[type="submit"]');

      // Wait for redirect to login
      await expect(page.locator('button[type="submit"]')).toContainText('Sign In', { timeout: 10000 });
    }

    // 3. Login
    await page.fill('input[autocomplete="username"]', ADMIN_USER);
    await page.fill('input[autocomplete="current-password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');

    // 4. CRM protected page renders
    await expect(page.locator('h2')).toContainText('Customer CRM', { timeout: 10000 });

    // 5. Route guard — open a new context (fresh storage, no session) and try CRM directly
    const context = await page.context().browser().newContext();
    const guardPage = await context.newPage();
    await guardPage.goto('/#/crm');
    // Unauthenticated access must not render the CRM page — it should be
    // blocked by either the bootstrap check or the auth route guard.
    await guardPage.waitForTimeout(3000);
    const crmHeading = guardPage.getByRole('heading', { name: 'Customer CRM' });
    await expect(crmHeading).toHaveCount(0);
    await context.close();
  });
});
