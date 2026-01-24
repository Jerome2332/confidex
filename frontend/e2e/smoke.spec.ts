import { test, expect } from '@playwright/test';

/**
 * Smoke tests - basic functionality checks.
 *
 * These tests verify the application loads and basic elements are present.
 * Run after every deployment to catch obvious regressions.
 */

test.describe('Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/confidex/i);

    // Check main navigation elements exist
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('connect wallet button is visible', async ({ page }) => {
    await page.goto('/');

    const connectButton = page.getByRole('button', { name: /connect wallet/i });
    await expect(connectButton).toBeVisible();
  });

  test('trading pair selector is visible', async ({ page }) => {
    await page.goto('/');

    // Look for trading pair display (e.g., SOL/USDC)
    await expect(page.locator('text=/SOL|USDC|BTC/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('order book component loads', async ({ page }) => {
    await page.goto('/trade');

    // Wait for order book container
    const orderBook = page.getByTestId('order-book').or(page.locator('[class*="orderbook"]'));
    await expect(orderBook).toBeVisible({ timeout: 15000 });
  });

  test('no console errors on page load', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Filter out known acceptable errors (e.g., RPC rate limits in dev)
    const criticalErrors = consoleErrors.filter(
      (error) =>
        !error.includes('429') && // Rate limit
        !error.includes('Failed to fetch') && // Network issues in dev
        !error.includes('WebSocket') && // WS connection issues in dev
        !error.includes('Pyth') && // Pyth price feed connection issues
        !error.includes('RPC') && // RPC connection errors
        !error.includes('network') && // General network errors
        !error.includes('CORS') && // CORS issues in dev
        !error.includes('hydration') // React hydration warnings
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('page is responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Page should still load without horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);

    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 25); // Small tolerance for scrollbars/padding
  });

  test('dark mode toggle works', async ({ page }) => {
    await page.goto('/');

    const themeToggle = page.getByRole('button', { name: /theme|dark|light/i });

    if (await themeToggle.isVisible()) {
      // Get initial theme
      const initialTheme = await page.evaluate(() => document.documentElement.classList.contains('dark'));

      // Toggle theme
      await themeToggle.click();

      // Verify theme changed
      const newTheme = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      expect(newTheme).not.toBe(initialTheme);
    }
  });
});
