import { query } from '../../utils/axios-query';
import logger from '../../logger';
import { PriceFeed, PriceHistory } from '../price-updater';

/**
 * DebitMyData price feed: one JSON document with the DMD price in every currency mempool expects,
 * for example { "USD": 0.0123, "EUR": { "value": "0.0114" }, ... }.
 * The URL is set with FIAT_PRICE.FEED_URL in mempool-config.json.
 */
class WorkerApi implements PriceFeed {
  public name = 'WorkerAPI';

  public currencies: string[] = [
    'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY',
    'BGN', 'BRL', 'CNY', 'CZK', 'DKK', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR',
    'ISK', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'RUB', 'SEK',
    'SGD', 'THB', 'TRY', 'ZAR'
  ];

  public url: string;
  public urlHist = ''; // required by the PriceFeed interface, the worker has no history

  private lastResponse: { time: number; data: any } | null = null;

  constructor(url: string) {
    this.url = url;
  }

  public async $fetchPrice(currency: string): Promise<number> {
    try {
      const data = await this.$fetchAll();
      const raw = data?.[currency];
      if (raw !== undefined && raw !== null) {
        const value = typeof raw === 'object' ? parseFloat(raw.value) : parseFloat(raw);
        if (!isNaN(value)) {
          return parseFloat(value.toFixed(8));
        }
      }
    } catch (e) {
      logger.debug(`WorkerApi: cannot fetch DMD/${currency} price. Reason: ${e instanceof Error ? e.message : e}`);
    }
    return -1;
  }

  public async $fetchRecentPrice(currencies: string[], type: 'hour' | 'day'): Promise<PriceHistory> {
    return {}; // no historical prices
  }

  // One request per price update instead of one per currency
  /** @asyncUnsafe */
  private async $fetchAll(): Promise<any> {
    const now = Date.now();
    if (this.lastResponse && now - this.lastResponse.time < 30_000) {
      return this.lastResponse.data;
    }
    const response: any = await query(this.url);
    const data = response?.data ?? response;
    if (data && typeof data === 'object') {
      this.lastResponse = { time: now, data };
    }
    return data;
  }
}

export default WorkerApi;
