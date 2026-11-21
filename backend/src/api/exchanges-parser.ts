import DB from '../database';

interface ExchangeJson {
  name: string;
  link?: string;
  addresses?: string[];
}

class ExchangesParser {
  exchanges: ExchangeJson[] = [];

  setExchanges(exchangesJson: ExchangeJson[]): void {
    // Skip the empty placeholder entries of a new exchanges.json
    this.exchanges = (Array.isArray(exchangesJson) ? exchangesJson : []).filter(exchange => exchange?.name);
  }

  /**
   * exchanges.json is the source of truth: replace the table with its content.
   * Runs inside the transaction opened by the exchanges updater.
   *
   * @asyncUnsafe
   */
  async migrateExchangesJson(): Promise<void> {
    await DB.query('DELETE FROM exchanges');
    for (const { name, link, addresses } of this.exchanges) {
      await DB.query(
        'INSERT INTO exchanges (name, link, addresses) VALUES (?, ?, ?)',
        [name, link || null, JSON.stringify(addresses || [])]
      );
    }
  }
}

export default new ExchangesParser();
