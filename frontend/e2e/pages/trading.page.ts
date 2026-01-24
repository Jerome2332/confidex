import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object Model for the Trading page.
 *
 * Encapsulates locators and actions for E2E tests.
 */
export class TradingPage {
  readonly page: Page;

  // Navigation
  readonly connectWalletButton: Locator;
  readonly networkIndicator: Locator;

  // Order Form
  readonly orderTypeSelector: Locator;
  readonly sideToggle: Locator;
  readonly priceInput: Locator;
  readonly sizeInput: Locator;
  readonly submitOrderButton: Locator;

  // Order Book
  readonly orderBookContainer: Locator;
  readonly bidRows: Locator;
  readonly askRows: Locator;
  readonly spreadDisplay: Locator;

  // Positions
  readonly positionsTab: Locator;
  readonly openOrdersTab: Locator;
  readonly tradeHistoryTab: Locator;

  // Notifications
  readonly toastContainer: Locator;

  constructor(page: Page) {
    this.page = page;

    // Navigation locators
    this.connectWalletButton = page.getByRole('button', { name: /connect wallet/i });
    this.networkIndicator = page.getByTestId('network-indicator');

    // Order form locators
    this.orderTypeSelector = page.getByTestId('order-type-selector');
    this.sideToggle = page.getByTestId('side-toggle');
    this.priceInput = page.getByTestId('price-input');
    this.sizeInput = page.getByTestId('size-input');
    this.submitOrderButton = page.getByTestId('submit-order-button');

    // Order book locators
    this.orderBookContainer = page.getByTestId('order-book');
    this.bidRows = page.getByTestId('bid-row');
    this.askRows = page.getByTestId('ask-row');
    this.spreadDisplay = page.getByTestId('spread-display');

    // Tab locators
    this.positionsTab = page.getByRole('tab', { name: /positions/i });
    this.openOrdersTab = page.getByRole('tab', { name: /open orders/i });
    this.tradeHistoryTab = page.getByRole('tab', { name: /trade history/i });

    // Notification locators
    this.toastContainer = page.locator('[data-sonner-toast]');
  }

  async goto() {
    await this.page.goto('/trade');
    // Wait for DOM content loaded instead of networkidle (trading page has continuous WS connections)
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for the order book or trading panel to be visible
    await this.page.waitForSelector('[data-testid="order-book"], [data-testid="size-input"]', {
      state: 'visible',
      timeout: 15000,
    });
  }

  async selectOrderType(type: 'limit' | 'market') {
    await this.orderTypeSelector.click();
    await this.page.getByRole('option', { name: new RegExp(type, 'i') }).click();
  }

  async selectSide(side: 'buy' | 'sell') {
    const button = this.page.getByRole('button', { name: new RegExp(side, 'i') });
    await button.click();
  }

  async enterPrice(price: string) {
    await this.priceInput.fill(price);
  }

  async enterSize(size: string) {
    await this.sizeInput.fill(size);
  }

  async submitOrder() {
    await this.submitOrderButton.click();
  }

  async placeLimitOrder(side: 'buy' | 'sell', price: string, size: string) {
    await this.selectOrderType('limit');
    await this.selectSide(side);
    await this.enterPrice(price);
    await this.enterSize(size);
    await this.submitOrder();
  }

  async expectToastMessage(message: string | RegExp) {
    await expect(this.toastContainer.filter({ hasText: message })).toBeVisible({
      timeout: 10000,
    });
  }

  async expectOrderBookLoaded() {
    await expect(this.orderBookContainer).toBeVisible();
    // Wait for either real data or "No orders" message - use first() to avoid strict mode violation
    await expect(
      this.page.locator('[data-testid="order-book"] :text-matches("(Bid|Ask|No orders)", "i")').first()
    ).toBeVisible({ timeout: 15000 });
  }

  async getSpread(): Promise<string | null> {
    const spreadText = await this.spreadDisplay.textContent();
    return spreadText;
  }

  async waitForOrderConfirmation() {
    // Wait for success toast or order appearing in open orders
    await Promise.race([
      this.expectToastMessage(/order (placed|submitted)/i),
      this.page.waitForSelector('[data-testid="open-order-row"]', { timeout: 30000 }),
    ]);
  }
}
