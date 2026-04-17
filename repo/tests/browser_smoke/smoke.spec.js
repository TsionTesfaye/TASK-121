/**
 * Minimal browser-driver smoke test — Playwright + Chromium.
 *
 * Covers one end-to-end flow in a real browser:
 *   1. App loads and auto-seeds demo accounts (no bootstrap form)
 *   2. Login with the seeded admin account
 *   3. CRM protected page renders
 *   4. Unauthenticated direct access is redirected to login
 */

import { test, expect } from '@playwright/test';

// Seeded demo credentials — provisioned automatically on first run.
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Admin@retailops1';

test.describe('Smoke — auto-seed, login, protected page', () => {
  test('full flow: auto-seed → login → CRM → route guard', async ({ page }) => {
    // 1. App loads — auto-seeds and lands on login (no bootstrap form)
    await page.goto('/');
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });

    // 2. Login with seeded admin account
    await page.fill('input[autocomplete="username"]', ADMIN_USER);
    await page.fill('input[autocomplete="current-password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');

    // 3. CRM protected page renders
    await page.waitForSelector('text=Customer CRM', { timeout: 10000 });
    await expect(page.locator('text=Customer CRM').first()).toBeVisible();

    // 4. Route guard — open a new context (fresh storage, no session) and try CRM directly
    const context = await page.context().browser().newContext();
    const guardPage = await context.newPage();
    try {
      await guardPage.goto('/#/crm');
      await guardPage.waitForTimeout(3000);
      const crmHeading = guardPage.getByRole('heading', { name: 'Customer CRM' });
      await expect(crmHeading).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
