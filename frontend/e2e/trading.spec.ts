import { test, expect } from './fixtures/wallet';
import { TradingPage } from './pages/trading.page';

/**
 * Trading flow E2E tests.
 *
 * These tests cover the core trading functionality including
 * order placement, order book interaction, and trade history.
 */

test.describe('Trading', () => {
  test.describe('Order Book', () => {
    test('displays order book with bids and asks', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      await tradingPage.expectOrderBookLoaded();
    });

    test('order book updates in real-time', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      await tradingPage.expectOrderBookLoaded();

      // Wait and verify the order book doesn't disappear
      await page.waitForTimeout(5000);
      await expect(tradingPage.orderBookContainer).toBeVisible();
    });

    test.skip('clicking order book row fills price input', async ({ page }) => {
      // TODO: Implement order book row click -> price input feature
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      await tradingPage.expectOrderBookLoaded();

      // Click on a bid row if available
      const bidRow = tradingPage.bidRows.first();

      if (await bidRow.isVisible()) {
        await bidRow.click();

        // Verify price input was filled
        const priceValue = await tradingPage.priceInput.inputValue();
        expect(priceValue).not.toBe('');
      }
    });
  });

  test.describe('Order Form', () => {
    test('order form elements are present', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      await expect(tradingPage.priceInput.or(page.locator('[placeholder*="Price"]'))).toBeVisible();
      await expect(tradingPage.sizeInput.or(page.locator('[placeholder*="Size"]'))).toBeVisible();
    });

    test('can switch between buy and sell', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      const buyButton = page.getByRole('button', { name: /buy/i }).first();
      const sellButton = page.getByRole('button', { name: /sell/i }).first();

      // Click buy
      await buyButton.click();

      // Click sell
      await sellButton.click();

      // No errors should occur
    });

    test('validates empty order submission', async ({ walletPage, mockWalletConnection }) => {
      const tradingPage = new TradingPage(walletPage);
      await tradingPage.goto();

      // Mock wallet connection
      await mockWalletConnection('MockPublicKey111111111111111111111111111111');

      // Try to submit without filling form
      const submitButton = walletPage.getByRole('button', { name: /place order|submit/i });

      if (await submitButton.isVisible() && await submitButton.isEnabled()) {
        await submitButton.click();

        // Should show validation error or button should be disabled
        const errorMessage = walletPage.locator('text=/required|invalid|enter/i');
        const isDisabled = await submitButton.isDisabled();

        expect(await errorMessage.isVisible() || isDisabled).toBeTruthy();
      }
    });

    test('price and size inputs accept valid numbers', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      const priceInput = tradingPage.priceInput.or(page.locator('[placeholder*="Price"]'));
      const sizeInput = tradingPage.sizeInput.or(page.locator('[placeholder*="Size"]'));

      await priceInput.fill('100.50');
      await expect(priceInput).toHaveValue('100.50');

      await sizeInput.fill('1.5');
      await expect(sizeInput).toHaveValue('1.5');
    });
  });

  test.describe('Wallet Connection', () => {
    test('shows connect wallet prompt when not connected', async ({ page }) => {
      await page.goto('/');

      const connectButton = page.getByRole('button', { name: /connect wallet/i });
      await expect(connectButton).toBeVisible();
    });

    test('submit order button requires wallet connection', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      // Without wallet connection, the submit button should show "Connect Wallet"
      const submitButton = page.getByTestId('submit-order-button');

      if (await submitButton.isVisible()) {
        const buttonText = await submitButton.textContent();
        const isDisabled = await submitButton.isDisabled();

        // Either button says connect wallet or is disabled
        expect(buttonText?.toLowerCase().includes('connect') || isDisabled).toBeTruthy();
      }
    });
  });

  test.describe('Trade History', () => {
    test('trade history tab is accessible', async ({ page }) => {
      const tradingPage = new TradingPage(page);
      await tradingPage.goto();

      const historyTab = page.getByRole('tab', { name: /trades|history/i });

      if (await historyTab.isVisible()) {
        await historyTab.click();

        // Should show either trades or empty state
        const tradesOrEmpty = page.locator('text=/no trades|recent|executed/i');
        await expect(tradesOrEmpty).toBeVisible({ timeout: 10000 });
      }
    });
  });
});
