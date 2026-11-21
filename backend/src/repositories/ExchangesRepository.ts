import DB from '../database';
import logger from '../logger';
import config from '../config';

export interface ExchangeTag {
  id: number;
  name: string;
  addresses: string[];
  link: string;
  created_at: string;
  updated_at: string;
}

class ExchangesRepository {
  /**
   * Get all exchange tagging info
   */
  public async $getExchanges(): Promise<ExchangeTag[]> {
    try {
      const [rows]: any[] = await DB.query('SELECT * FROM exchanges');
      return rows.map((row) => ({
        ...row,
        addresses: JSON.parse(row.addresses),
      }));
    } catch (e) {
      logger.err('Cannot fetch exchanges from db. Reason: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }

  /**
   * Get a specific exchange by name
   */
  public async $getExchangeByName(name: string): Promise<ExchangeTag | null> {
    try {
      const [rows]: any[] = await DB.query('SELECT * FROM exchanges WHERE name = ?', [name]);
      if (!rows.length) return null;
      rows[0].addresses = JSON.parse(rows[0].addresses);
      return rows[0];
    } catch (e) {
      logger.err('Cannot fetch exchange from db. Reason: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }

  /**
   * Get a specific exchange by address
   */
  public async $getExchangeByAddress(address: string): Promise<ExchangeTag | null> {
    try {
      const [rows]: any[] = await DB.query('SELECT * FROM exchanges');
      for (const row of rows) {
        const addresses: string[] = JSON.parse(row.addresses || '[]');
        if (addresses.includes(address)) {
          return {
            ...row,
            addresses,
          };
        }
      }
      return null;
    } catch (e) {
      logger.err('Cannot fetch exchange by address from db. Reason: ' + (e instanceof Error ? e.message : e));
      throw e;
    }
  }

  /**
   * Insert new exchange
   */
  public async $insertExchange(exchange: { name: string; addresses: string[]; link?: string }): Promise<void> {
    try {
      await DB.query(
        'INSERT INTO exchanges (name, addresses, link) VALUES (?, ?, ?)',
        [exchange.name, JSON.stringify(exchange.addresses), exchange.link || null]
      );
    } catch (e) {
      logger.err('Cannot insert exchange into db. Reason: ' + (e instanceof Error ? e.message : e));
    }
  }

  /**
   * Update exchange addresses
   */
  public async $updateExchangeAddresses(id: number, addresses: string[]): Promise<void> {
    try {
      await DB.query(
        'UPDATE exchanges SET addresses = ? WHERE id = ?',
        [JSON.stringify(addresses), id]
      );
    } catch (e) {
      logger.err(`Cannot update addresses for exchange id ${id}. Reason: ` + (e instanceof Error ? e.message : e));
    }
  }
}

export default new ExchangesRepository();
