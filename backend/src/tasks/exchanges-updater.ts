import axios, { AxiosResponse } from 'axios';
import exchangesParser from '../api/exchanges-parser';
import config from '../config';
import DB from '../database';
import backendInfo from '../api/backend-info';
import logger from '../logger';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as https from 'https';
import { Common } from '../api/common';

/**
 * Maintain the most recent version of exchanges.json
 */
class ExchangesUpdater {
  tag = 'ExchangesUpdater';

  lastRun: number = 0;
  currentSha: string | null = null;
  exchangesUrl: string = config.MEMPOOL.EXCHANGES_JSON_URL;
  treeUrl: string = config.MEMPOOL.EXCHANGES_JSON_TREE_URL;

  /** @asyncSafe */
  public async $startService(): Promise<void> {
    while ('Bitcoin is still alive') {
      try {
        await this.updateExchangesJson();
      } catch (e: any) {
        logger.info(`Exception ${e} in ExchangesUpdater::$startService. Code: ${e.code}. Message: ${e.message}`, this.tag);
      }
      await Common.sleep$(10000);
    }
  }

  /** @asyncSafe */
  public async updateExchangesJson(): Promise<void> {
    if (['mainnet', 'testnet', 'signet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK) === false ||
      config.MEMPOOL.ENABLED === false
    ) {
      return;
    }

    const now = new Date().getTime() / 1000;
    if (now - this.lastRun < config.MEMPOOL.EXCHANGES_UPDATE_DELAY) { // Execute the ExchangesUpdate only once per delay, or upon restart
      return;
    }

    this.lastRun = now;

    try {
      if (config.DATABASE.ENABLED === true) {
        this.currentSha = await this.getShaFromDb();
      }

      const githubSha = await this.fetchExchangesSha(); // Fetch exchanges.json sha from github
      if (githubSha === null) {
        return;
      }

      logger.debug(`exchanges.json sha | Current: ${this.currentSha} | Github: ${githubSha}`, this.tag);
      if (this.currentSha !== null && this.currentSha === githubSha) {
        return;
      }

      // See backend README for more details about the update process
      if (this.currentSha !== null && // If we don't have any exchange list yet, download it at least once
        config.MEMPOOL.AUTOMATIC_EXCHANGES_UPDATE !== true && // Automatic exchanges update is disabled
        !process.env.npm_config_update_exchanges // We're not manually updating exchanges
      ) {
        logger.warn(`Updated exchanges data is available (${githubSha}) but AUTOMATIC_EXCHANGES_UPDATE is disabled`, this.tag);
        logger.info(`You can update your exchanges using the --update-exchanges command flag. You may want to clear your nginx cache as well if applicable`, this.tag);
        return;
      }

      const network = config.SOCKS5PROXY.ENABLED ? 'tor' : 'clearnet';
      if (this.currentSha === null) {
        logger.info(`Downloading exchanges.json for the first time from ${this.exchangesUrl} over ${network}`, this.tag);
      } else {
        logger.warn(`exchanges.json is outdated, fetching latest from ${this.exchangesUrl} over ${network}`, this.tag);
      }
      const exchangesJson = await this.query(this.exchangesUrl);
      if (exchangesJson === undefined) {
        return;
      }
      exchangesParser.setExchanges(exchangesJson);

      if (config.DATABASE.ENABLED === false) { // Don't run db operations
        logger.info(`exchanges.json (${githubSha}) import completed (no database)`, this.tag);
        return;
      }

      try {
        await DB.query('START TRANSACTION;');
        await this.updateDBSha(githubSha);
        await exchangesParser.migrateExchangesJson();
        await DB.query('COMMIT;');
      } catch (e) {
        logger.err(`Could not migrate exchanges, rolling back. Exception: ${JSON.stringify(e)}`, this.tag);
        await DB.query('ROLLBACK;');
      }
      logger.info(`exchanges.json (${githubSha}) import completed`, this.tag);

    } catch (e) {
      // fast-forward lastRun to 10 minutes before the next scheduled update
      this.lastRun = now - Math.max(config.MEMPOOL.EXCHANGES_UPDATE_DELAY - 600, 600);
      logger.err(`ExchangesUpdater failed. Will try again in 10 minutes. Exception: ${JSON.stringify(e)}`, this.tag);
    }
  }

  /**
   * Fetch our latest exchanges.json sha from the db
   */
  private async updateDBSha(githubSha: string): Promise<void> {
    this.currentSha = githubSha;
    if (config.DATABASE.ENABLED === true) {
      try {
        await DB.query('DELETE FROM state where name="exchanges_json_sha"');
        await DB.query(`INSERT INTO state VALUES('exchanges_json_sha', NULL, '${githubSha}')`);
      } catch (e) {
        logger.err('Cannot save github exchanges.json sha into the db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
      }
    }
  }

  /**
   * Fetch our latest exchanges.json sha from the db
   */
  public async getShaFromDb(): Promise<string | null> {
    try {
      const [rows]: any[] = await DB.query('SELECT string FROM state WHERE name="exchanges_json_sha"');
      return (rows.length > 0 ? rows[0].string : null);
    } catch (e) {
      logger.err('Cannot fetch exchanges.json sha from db. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
      return null;
    }
  }

  /**
   * Fetch our latest exchanges.json sha from github
   * @asyncUnsafe
   */
  private async fetchExchangesSha(): Promise<string | null> {
    const response = await this.query(this.treeUrl);

    if (response !== undefined) {
      for (const file of response['tree']) {
        if (file['path'] === 'exchanges.json') {
          return file['sha'];
        }
      }
    }

    logger.err(`Cannot find "exchanges.json" in git tree (${this.treeUrl})`, this.tag);
    return null;
  }

  /**
   * Http request wrapper
   * @asyncUnsafe
   */
  private async query(path): Promise<any[] | undefined> {
    type axiosOptions = {
      headers: {
        'User-Agent': string
      };
      timeout: number;
      httpsAgent?: https.Agent;
    };
    const setDelay = (secs: number = 1): Promise<void> => new Promise(resolve => setTimeout(() => resolve(), secs * 1000));

    const headers: any = {
      'User-Agent': (config.MEMPOOL.USER_AGENT === 'mempool')
        ? `mempool/v${backendInfo.getBackendInfo().version}`
        : `${config.MEMPOOL.USER_AGENT}`
    };
    if (config.MEMPOOL.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${config.MEMPOOL.GITHUB_TOKEN}`;
    }
    const axiosOptions: axiosOptions = {
      headers,
      timeout: config.SOCKS5PROXY.ENABLED ? 30000 : 10000
    };

    let retry = 0;

    while (retry < config.MEMPOOL.EXTERNAL_MAX_RETRY) {
      try {
        if (config.SOCKS5PROXY.ENABLED) {
          const socksOptions: any = {
            agentOptions: {
              keepAlive: true,
            },
            hostname: config.SOCKS5PROXY.HOST,
            port: config.SOCKS5PROXY.PORT
          };

          if (config.SOCKS5PROXY.USERNAME && config.SOCKS5PROXY.PASSWORD) {
            socksOptions.username = config.SOCKS5PROXY.USERNAME;
            socksOptions.password = config.SOCKS5PROXY.PASSWORD;
          } else {
            // Retry with different tor circuits https://stackoverflow.com/a/64960234
            socksOptions.username = `circuit${retry}`;
          }

          axiosOptions.httpsAgent = new SocksProxyAgent(socksOptions);
        }

        const data: AxiosResponse = await axios.get(path, axiosOptions);
        if (data.statusText === 'error' || !data.data) {
          throw new Error(`Could not fetch data from ${path}, Error: ${data.status}`);
        }
        return data.data;
      } catch (e) {
        logger.err('Could not connect to Github. Reason: ' + (e instanceof Error ? e.message : e), this.tag);
        retry++;
      }
      await setDelay(config.MEMPOOL.EXTERNAL_RETRY_INTERVAL);
    }
    return undefined;
  }
}

export default new ExchangesUpdater();
