#!/usr/bin/env node
/**
 * DebitMyData rich list indexer
 *
 * Walks the chain block by block over the node's RPC, keeps every address balance in a SQLite
 * file and serves the top addresses to the mempool backend (MEMPOOL.RICHLIST_API).
 *
 * Settings
 *   The node RPC (host, port, username/password or cookie) is read from the CORE_RPC section of
 *   backend/mempool-config.json, so no credentials live in this file. Optional environment
 *   variables:
 *     RICHLIST_CONFIG  path of mempool-config.json      (default: ../backend/mempool-config.json)
 *     RICHLIST_DB      path of the SQLite file          (default: ./richlist.db next to this file)
 *     RICHLIST_BIND    address the API listens on       (default: 127.0.0.1)
 *     RICHLIST_PORT    port the API listens on          (default: 8081)
 *
 * API
 *   GET /api/richlist?limit=100        top addresses (max 500) with their share of the supply
 *   GET /api/richlist/summary          supply held by the top 10/25/50/100/250/500 addresses
 *   GET /api/richlist/distribution     top 10/100/250/500 and the rest, as a list
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const express = require('express');

const CONFIG_FILE = process.env.RICHLIST_CONFIG || path.join(__dirname, '..', 'backend', 'mempool-config.json');
const DB_FILE = process.env.RICHLIST_DB || path.join(__dirname, 'richlist.db');
const BIND = process.env.RICHLIST_BIND || '127.0.0.1';
const PORT = parseInt(process.env.RICHLIST_PORT || '8081', 10);

// --- RPC settings, from the backend's mempool-config.json ---
function readRpcSettings() {
  let rpc = {};
  try {
    rpc = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).CORE_RPC || {};
  } catch (e) {
    console.error(`Cannot read ${CONFIG_FILE}: ${e.message}`);
    process.exit(1);
  }
  const settings = {
    host: rpc.HOST || '127.0.0.1',
    port: rpc.PORT || 18557, // DebitMyData RPC port
    username: rpc.USERNAME,
    password: rpc.PASSWORD,
    timeout: rpc.TIMEOUT || 60000,
  };
  if (rpc.COOKIE) {
    try {
      const [username, password] = fs.readFileSync(rpc.COOKIE_PATH, 'utf8').trim().split(':');
      settings.username = username;
      settings.password = password;
    } catch (e) {
      console.error(`Cannot read the RPC cookie file: ${e.message}`);
      process.exit(1);
    }
  }
  return settings;
}

const RPC = readRpcSettings();

async function rpcCall(method, params = []) {
  const { data } = await axios.post(
    `http://${RPC.host}:${RPC.port}/`,
    { jsonrpc: '1.0', id: 'richlist', method, params },
    {
      headers: { 'Content-Type': 'application/json' },
      auth: { username: RPC.username, password: RPC.password },
      timeout: RPC.timeout,
    }
  );
  return data.result;
}

// gettxoutsetinfo walks the whole UTXO set, so its answer is kept for 10 minutes
let supplyCache = { time: 0, value: 0 };
async function getTotalSupply() {
  if (Date.now() - supplyCache.time < 10 * 60 * 1000 && supplyCache.value > 0) {
    return supplyCache.value;
  }
  const info = await rpcCall('gettxoutsetinfo');
  supplyCache = { time: Date.now(), value: info?.total_amount || 0 };
  return supplyCache.value;
}

// ---------------------
// Database Setup
// ---------------------
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS balances (
    address TEXT PRIMARY KEY,
    balance REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

function getLastIndexed() {
  return new Promise((resolve) =>
    db.get("SELECT value FROM meta WHERE key='lastIndexed'", (err, row) =>
      resolve(row ? parseInt(row.value, 10) : -1)
    )
  );
}

function scriptAddresses(scriptPubKey) {
  let addresses = [];
  if (scriptPubKey) {
    if (scriptPubKey.address) {
      addresses.push(scriptPubKey.address);
    }
    if (Array.isArray(scriptPubKey.addresses)) {
      addresses = addresses.concat(scriptPubKey.addresses);
    }
  }
  return addresses;
}

// ---------------------
// Index Blockchain
// ---------------------
async function updateRichList(batchSize = 500) {
  const tip = await rpcCall('getblockcount');
  let lastIndexed = await getLastIndexed();
  let processed = 0;

  return new Promise((resolve) => {
    db.run('BEGIN TRANSACTION', async (err) => {
      if (err) {
        console.error('Transaction begin error:', err.message);
        return resolve();
      }

      try {
        while (processed < batchSize && lastIndexed < tip) {
          const nextHeight = lastIndexed + 1;
          const blockHash = await rpcCall('getblockhash', [nextHeight]);
          const block = await rpcCall('getblock', [blockHash, 2]);

          for (const tx of block.tx) {
            // outputs credit their addresses
            for (const vout of tx.vout) {
              for (const addr of scriptAddresses(vout.scriptPubKey)) {
                db.run(
                  'INSERT INTO balances(address, balance) VALUES(?, ?) ' +
                    'ON CONFLICT(address) DO UPDATE SET balance=balance+excluded.balance',
                  [addr, vout.value]
                );
              }
            }

            // inputs debit the addresses of the outputs they spend
            for (const vin of tx.vin || []) {
              if (!vin.txid) {
                continue; // coinbase
              }
              try {
                const prevTx = await rpcCall('getrawtransaction', [vin.txid, true]);
                const prevOut = prevTx.vout[vin.vout];
                for (const addr of scriptAddresses(prevOut.scriptPubKey)) {
                  db.run('UPDATE balances SET balance=balance-? WHERE address=?', [prevOut.value, addr]);
                }
              } catch (e) {
                console.error(`Failed prev tx ${vin.txid}:`, e.message);
              }
            }
          }

          db.run("INSERT OR REPLACE INTO meta(key,value) VALUES('lastIndexed',?)", [nextHeight]);
          lastIndexed = nextHeight;
          processed++;
          if (nextHeight % 100 === 0) {
            console.log(`Indexed block ${nextHeight}/${tip}`);
          }
        }
      } catch (e) {
        console.error('Indexing error:', e.message);
      }

      db.run('COMMIT', (err2) => {
        if (err2) {
          console.error('Commit error:', err2.message);
        }
        resolve();
      });
    });
  });
}

// ---------------------
// API Server
// ---------------------
const sumTop = (limit) => new Promise((resolve, reject) => {
  db.get(
    'SELECT SUM(balance) as total FROM (SELECT balance FROM balances ORDER BY balance DESC LIMIT ?)',
    [limit],
    (err, row) => (err ? reject(err) : resolve(row?.total || 0))
  );
});

const app = express();

app.get('/api/richlist', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500); // default 100, max 500
    const totalSupply = await getTotalSupply();
    if (totalSupply <= 0) {
      console.warn('Warning: totalSupply is 0, every share will be 0');
    }

    db.all(
      'SELECT address, balance FROM balances WHERE balance > 0 ORDER BY balance DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const richlist = rows.map((row, i) => ({
          rank: i + 1,
          address: row.address,
          balance: row.balance,
          percent: totalSupply > 0 ? parseFloat(((row.balance / totalSupply) * 100).toFixed(8)) : 0,
        }));
        res.json({ totalSupply, count: richlist.length, richlist });
      }
    );
  } catch (e) {
    console.error('Richlist error:', e.message);
    res.status(500).json({ error: 'Failed to fetch richlist: ' + e.message });
  }
});

app.get('/api/richlist/summary', async (req, res) => {
  try {
    const totalSupply = await getTotalSupply();
    const [top10, top25, top50, top100, top250, top500] = await Promise.all([10, 25, 50, 100, 250, 500].map(sumTop));
    const rest = Math.max(totalSupply - top500, 0);
    const pct = (value) => (totalSupply > 0 ? (value / totalSupply) * 100 : 0);
    res.json({
      totalSupply,
      top10, top25, top50, top100, top250, top500, rest,
      top10Percent: pct(top10),
      top25Percent: pct(top25),
      top50Percent: pct(top50),
      top100Percent: pct(top100),
      top250Percent: pct(top250),
      top500Percent: pct(top500),
      restPercent: pct(rest),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch rich list summary: ' + e.message });
  }
});

app.get('/api/richlist/distribution', async (req, res) => {
  try {
    const totalSupply = await new Promise((resolve, reject) =>
      db.get('SELECT SUM(balance) as totalSupply FROM balances', (err, row) => (err ? reject(err) : resolve(row?.totalSupply || 0)))
    );
    const [top10, top100, top250, top500] = await Promise.all([10, 100, 250, 500].map(sumTop));
    const rest = totalSupply - top500;
    const pct = (value) => (totalSupply > 0 ? (value / totalSupply) * 100 : 0);
    res.json({
      totalSupply,
      distribution: [
        { label: 'Top 10', amount: top10, percent: pct(top10) },
        { label: 'Top 100', amount: top100, percent: pct(top100) },
        { label: 'Top 250', amount: top250, percent: pct(top250) },
        { label: 'Top 500', amount: top500, percent: pct(top500) },
        { label: 'Others', amount: rest, percent: pct(rest) },
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------
// Run
// ---------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  app.listen(PORT, BIND, () => console.log(`Richlist API running at http://${BIND}:${PORT}`));

  while (true) {
    const start = Date.now();
    try {
      const tip = await rpcCall('getblockcount');
      const lastIndexed = await getLastIndexed();
      const behind = tip - lastIndexed;
      const progress = ((lastIndexed / tip) * 100).toFixed(2);
      console.log(`\n[Cycle start] Height=${lastIndexed}, Tip=${tip}, Behind=${behind}, Progress=${progress}%`);

      if (behind > 1000) {
        console.log('Mode: FAST (1000 blocks at a time)');
        await updateRichList(1000);
        await sleep(1000);
      } else if (behind > 50) {
        console.log('Mode: CATCH-UP (200 blocks at a time)');
        await updateRichList(200);
        await sleep(2000);
      } else if (behind > 0) {
        console.log('Mode: NEAR-TIP (10 blocks at a time)');
        await updateRichList(Math.min(behind, 10));
        await sleep(5000);
      } else {
        console.log('Mode: LIVE (1 block every 15s)');
        await updateRichList(1);
        await sleep(15000);
      }
    } catch (e) {
      console.error('[Cycle] node not reachable:', e.message);
      await sleep(15000);
    }
    console.log(`[Cycle end] Duration: ${((Date.now() - start) / 1000).toFixed(2)}s`);

    // Sanity check: the sum of the balances should match the node's UTXO set
    try {
      const nodeTotal = await getTotalSupply();
      db.get('SELECT SUM(balance) as total FROM balances', (err, row) => {
        const dbTotal = row?.total || 0;
        console.log(`[SanityCheck] Node=${nodeTotal}, DB=${dbTotal}, Δ=${Math.abs(nodeTotal - dbTotal)}`);
      });
    } catch (e) {
      console.warn('[SanityCheck] gettxoutsetinfo failed:', e.message);
    }
  }
})();
