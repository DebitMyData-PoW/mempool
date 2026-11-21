# DebitMyData Explorer: install and switch-over guide

This branch is the mempool explorer (release v3.3.2) with the DebitMyData changes on top. This folder
holds what a server needs besides the code: config templates, systemd units, an nginx config for a
test instance, and the steps below.

The steps install the new explorer **next to** the current one, so the live site keeps running while
you test. When the new one looks right, the switch-over takes about a minute and can be undone.

Paths used below (change them if yours differ):

| What | Current explorer | New explorer |
| --- | --- | --- |
| Code | `/root/mempool` | `/root/mempool-v3` |
| Backend port | 8999 | 8998 while testing, 8999 after the switch |
| Database | `mempool` | `mempool_v3` (a copy) |
| Website files | `/var/www/mempool/browser` | `/var/www/mempool-v3/browser` while testing |
| Rich list API | port 8081 | port 8081 (after the switch) |

## What is in this branch

DebitMyData changes carried over from the current explorer:

* **Look**: DebitMyData light and dark themes (the switch in the top bar, remembered in the
  `dmd-theme-explorer` cookie), DebitMyData logo, top bar, footer, Mada font, red charts and fee colours.
* **Network**: DebitMyData addresses (`D…` and `dm1…` on mainnet, `T…` and `td1…` on test networks),
  node RPC port 18557, 150-second blocks and LWMA difficulty (`MEMPOOL.DIFFICULTY_ADJUSTMENT: "lwma"`).
* **Units**: DMD and `data` (the smallest unit), fees in `data/vB`.
* **Rich list**: the Graphs → Rich List page, the backend endpoints `/api/v1/richlist`,
  `/api/v1/richlist/summary` and `/api/v1/circulating-supply`, and the indexer service in `richlist/`.
* **Exchanges**: exchange address tags from `DebitMyData-PoW/exchanges` (`/api/v1/exchanges`).
* **Mining pools**: pool list from `DebitMyData-PoW/mining-pools`, logos from `DebitMyData-PoW/mining-pool-logos`.
* **Prices**: the DebitMyData price feed (`FIAT_PRICE.FEED_URL`), prices kept with 8 decimals.

Small fixes made while porting:

* The rich list indexer reads the node RPC settings from `backend/mempool-config.json`, so no
  credentials are written in the code. It listens on 127.0.0.1 only, and has its own folder and
  `package.json` (`richlist/`).
* The backend no longer has a second, unused rich list route with its own RPC settings.
* Updating the exchange list no longer adds duplicate rows to the `exchanges` table.
* The Rich List page asks the explorer it is served from (it used to ask mempool.debitmydata.io
  directly, which made a test instance show live data).
* No Bitcoin price history (MtGox, Kraken) is written into the DMD price table any more.
* `npm run build` runs the asset sync again (v3.3 needs it to copy the theme files). It downloads the
  pool logos from `DebitMyData-PoW/mining-pool-logos` and skips the Liquid assets and the mempool promo
  video (set `SYNC_EXTRAS=1` to get them).

New in mempool v3.3 (from the mempool project): Angular 20, fee levels below 1 data/vB, more precise
fee ranges, more API endpoints, and many fixes.

---

## Part 1: install the new explorer next to the current one

Run everything as root on the explorer server, in tmux.

### 1.1 Check Node.js and Rust

```bash
node -v      # needs v20.19 or newer (v22 works too)
cargo -V     # Rust is needed to build the block template module
```

If Node.js shows an older v20, update it within v20 (this does not change the version the
current explorer runs on):

```bash
apt update && apt install --only-upgrade -y nodejs
```

### 1.2 Get the code

```bash
cd /root
git clone -b debitmydata https://github.com/DebitMyData-PoW/mempool.git mempool-v3
```

### 1.3 Copy the database

The new backend upgrades the database tables when it starts, so it gets its own copy and the
current explorer keeps its database untouched.

```bash
sudo mysql -u root -e "CREATE DATABASE mempool_v3; GRANT ALL PRIVILEGES ON mempool_v3.* TO 'mempool'@'%'; FLUSH PRIVILEGES;"
sudo mysqldump -u root --single-transaction --routines mempool | sudo mysql -u root mempool_v3
```

The copy can be taken while the current explorer runs.

### 1.4 Backend settings

Start from your current settings file, which already has your node, Electrum server and database
details:

```bash
cp /root/mempool/backend/mempool-config.json /root/mempool-v3/backend/mempool-config.json
nano /root/mempool-v3/backend/mempool-config.json
```

Change two values:

* `MEMPOOL` → `"HTTP_PORT": 8998`
* `DATABASE` → `"DATABASE": "mempool_v3"`

And check one:

* `MEMPOOL` → `"RICHLIST_API": "http://127.0.0.1:8081"` (the current rich list service; it answers on
  127.0.0.1 as well)

`deploy/debitmydata/mempool-config.example.json` shows every setting this explorer uses, with
placeholders (`__…__`) where your own values go. One setting is new and optional:
`FIAT_PRICE.FEED_URL`, the DebitMyData price feed address (the default is the current one).

### 1.5 Build the backend

```bash
cd /root/mempool-v3/backend
npm install          # also builds the Rust module; the first time rustup downloads Rust 1.84
npm run build
```

### 1.6 Start the backend as a service

```bash
cp /root/mempool-v3/deploy/debitmydata/mempool-backend-v3.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mempool-backend-v3
journalctl -fu mempool-backend-v3
```

In the log you should see the database upgrade, then the backend following new blocks. Leave it a
few minutes to catch up (Ctrl+C leaves the log; the service keeps running).

### 1.7 Build the website

```bash
cd /root/mempool-v3/frontend
cp /root/mempool/frontend/mempool-frontend-config.json .
npm install
npm run build

rm -rf /var/www/mempool-v3
mkdir -p /var/www/mempool-v3
cp -r dist/mempool/browser /var/www/mempool-v3/
# pool logos that are only on this server, kept as a fallback (existing files are not overwritten)
cp -n /root/mempool/frontend/src/resources/mining-pools/*.svg /var/www/mempool-v3/browser/resources/mining-pools/
chown -R www-data:www-data /var/www/mempool-v3
chmod -R 755 /var/www/mempool-v3
```

The build already copies `src/resources` into `dist`, so the separate `cp -r src/resources` step
from before is not needed any more.

### 1.8 Open the test site on port 8090

```bash
cp /root/mempool-v3/deploy/debitmydata/nginx-mempool-v3-test.conf /etc/nginx/
nano /etc/nginx/nginx.conf
```

Inside the `http { … }` block, next to the existing `server { … }` block, add:

```nginx
	server {
		listen 8090;
		include /etc/nginx/nginx-mempool-v3-test.conf;
	}
```

Then:

```bash
nginx -t && systemctl reload nginx
ufw allow 8090/tcp
```

Open `http://<your-server-address>:8090` in a browser.

### 1.9 What to check

* Dashboard: new blocks and mempool blocks appear, the fee boxes and the difficulty box show values.
* A block, a transaction, an address (`dm1…` and `D…`), and the search box.
* Mining dashboard and pool pages, with the pool logos.
* Graphs, including Rich List (top 10 to 500, owner names for exchanges and pools).
* Docs → API, and Tools → Calculator.
* The light/dark switch in the top bar, and the site on a phone.

Nothing here changes the live explorer. To remove the test install, see Part 3.

---

## Part 2: switch the live site to the new explorer

About a minute of downtime.

```bash
# 1. stop the current backend and rich list service
systemctl stop mempool-backend richlist-indexer
systemctl disable mempool-backend richlist-indexer

# 2. new backend on the live port
nano /root/mempool-v3/backend/mempool-config.json      # MEMPOOL → "HTTP_PORT": 8999
systemctl restart mempool-backend-v3

# 3. new rich list service, with the current balances so it does not index from block 0
cd /root/mempool-v3/richlist
npm install
cp /root/mempool/richlist.db /root/mempool-v3/richlist/richlist.db
cp /root/mempool-v3/deploy/debitmydata/richlist-indexer-v3.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now richlist-indexer-v3

# 4. new website in the live folder (the current one is kept as a backup)
mv /var/www/mempool /var/www/mempool-v2-backup
mkdir -p /var/www/mempool
cp -r /var/www/mempool-v3/browser /var/www/mempool/
chown -R www-data:www-data /var/www/mempool
chmod -R 755 /var/www/mempool
systemctl reload nginx
```

Check the live site, then:

```bash
journalctl -fu mempool-backend-v3
tail -f /var/log/richlist-indexer.log
```

When everything is fine, remove the test server block from `/etc/nginx/nginx.conf`, then:

```bash
nginx -t && systemctl reload nginx
ufw delete allow 8090/tcp
```

The rich list service now answers on 127.0.0.1 only. If nothing outside this server calls port 8081,
you can also close it: `ufw delete allow 8081/tcp`.

### Undo the switch

```bash
systemctl stop mempool-backend-v3 richlist-indexer-v3
systemctl disable mempool-backend-v3 richlist-indexer-v3
rm -rf /var/www/mempool && mv /var/www/mempool-v2-backup /var/www/mempool
systemctl enable --now mempool-backend richlist-indexer
systemctl reload nginx
```

The old explorer still has its own database (`mempool`), so it starts where it stopped.

---

## Part 3: housekeeping

Remove the test install without switching:

```bash
systemctl disable --now mempool-backend-v3
rm /etc/systemd/system/mempool-backend-v3.service && systemctl daemon-reload
# remove the 8090 server block from /etc/nginx/nginx.conf, then:
nginx -t && systemctl reload nginx && ufw delete allow 8090/tcp
rm -rf /var/www/mempool-v3
sudo mysql -u root -e "DROP DATABASE mempool_v3;"
```

Later, once the new explorer has run for a while, the old code, database and website backup can go:
`/root/mempool`, the `mempool` database, `/var/www/mempool-v2-backup`, and the two old service files.

## Updating to a newer mempool release later

Merge the new release where you keep the code, not on the server:

```bash
cd ~/debitmydata-mempool                                          # your clone of DebitMyData-PoW/mempool
git remote add upstream https://github.com/mempool/mempool.git   # once
git fetch upstream --tags
git checkout debitmydata
git merge v3.3.3                                                  # the new release tag
git push
```

Then on the server: `cd /root/mempool-v3 && git pull`, rebuild the backend (1.5) and the website
(1.7), and restart `mempool-backend-v3`.
