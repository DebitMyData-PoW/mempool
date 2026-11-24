# Installing the DebitMyData Explorer

These steps install the explorer on an Ubuntu 24.04 server of your own: its backend, the rich list
indexer and the website behind nginx. Below, `explorer.example.com` stands for your own name. Run
everything as root.

## What you need

- **An Ubuntu 24.04 server** (x86_64): 4 vCPU, 8 GB of memory, 80 GB of SSD. Root access with an
  SSH key.
- **A DebitMyData node** with its transaction index (`txindex=1`) and RPC, on the same server or
  one the explorer can reach: DebitMyData Core's Linux release is on
  [GitHub](https://github.com/DebitMyData-PoW/DebitMyData-PoW-Core/releases).
- **An Electrum server** for DebitMyData, which the explorer asks for addresses' histories:
  [ElectrumX for DebitMyData](https://github.com/DebitMyData-PoW/electrumx), whose INSTALL.md sets
  up the node too.
- **A name** for the website (for example `explorer.example.com`).

## Install

1. **The tools**: Node.js 22, Rust (for the block template module), MariaDB, nginx and the build
   tools:

   ```bash
   apt-get update && apt-get install -y git curl build-essential mariadb-server nginx
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
   . "$HOME/.cargo/env"
   ```

2. **The code**, from the `debitmydata` branch:

   ```bash
   git clone -b debitmydata https://github.com/DebitMyData-PoW/mempool.git /opt/mempool
   ```

3. **The database**, with a password of your own:

   ```bash
   mysql -u root -e "CREATE DATABASE mempool; CREATE USER 'mempool'@'localhost' IDENTIFIED BY '<a long random password>'; GRANT ALL PRIVILEGES ON mempool.* TO 'mempool'@'localhost'; FLUSH PRIVILEGES;"
   ```

4. **The backend's settings.** Start from the example, which shows every setting this explorer
   uses:

   ```bash
   cp /opt/mempool/deploy/debitmydata/mempool-config.example.json /opt/mempool/backend/mempool-config.json
   chmod 600 /opt/mempool/backend/mempool-config.json
   nano /opt/mempool/backend/mempool-config.json
   ```

   Put your own values where the placeholders (`__…__`) are: in `CORE_RPC`, the node's address,
   RPC user and password; in `ELECTRUM`, the Electrum server's address (port 50002, with TLS); in
   `DATABASE`, the user and password from step 3. Also:

   - `MEMPOOL.GITHUB_TOKEN` (optional): a GitHub token with no permissions, so that reading the
     pool and exchange lists from GitHub is not slowed down by GitHub's limits.
   - `FIAT_PRICE.FEED_URL`: the price feed. It starts on the DebitMyData network's.
   - `MEMPOOL.POOLS_JSON_URL` and `MEMPOOL.EXCHANGES_JSON_URL`: the pool and exchange lists, from
     DebitMyData's public repositories.

5. **Build the backend and start it as a service:**

   ```bash
   cd /opt/mempool/backend
   npm install          # also builds the Rust module; the first time, rustup downloads Rust
   npm run build
   cp /opt/mempool/deploy/debitmydata/mempool-backend.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now mempool-backend
   journalctl -fu mempool-backend
   ```

   In the log, the backend creates its tables, then reads the chain's blocks (a few minutes the
   first time). Ctrl+C leaves the log; the service keeps running.

6. **The rich list indexer.** It reads the node's settings from the backend's settings file, keeps
   every address's balance in its own database, and answers the backend on 127.0.0.1:8081 only.
   The first time, it reads the whole chain:

   ```bash
   cd /opt/mempool/richlist
   npm install
   cp /opt/mempool/deploy/debitmydata/richlist-indexer.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now richlist-indexer
   tail -f /var/log/richlist-indexer.log
   ```

7. **The website.** Its settings, from the example: set `MEMPOOL_WEBSITE_URL` to your site's
   address (`https://explorer.example.com`) and `SERVICES_API` to the same address followed by
   `/api/v1/services`. Then build it and put it in nginx's folder:

   ```bash
   cd /opt/mempool/frontend
   cp /opt/mempool/deploy/debitmydata/mempool-frontend-config.example.json mempool-frontend-config.json
   nano mempool-frontend-config.json
   npm install
   npm run build        # also downloads the pool logos
   mkdir -p /var/www/mempool
   cp -r dist/mempool/browser /var/www/mempool/
   chown -R www-data:www-data /var/www/mempool
   ```

8. **nginx.** The repository's `nginx.conf` and `nginx-mempool.conf` serve the website and pass
   the API to the backend. They listen on 127.0.0.1 only and run as `nobody`; make them answer
   the website's name, as Ubuntu's web user:

   ```bash
   cp /opt/mempool/nginx.conf /etc/nginx/nginx.conf
   cp /opt/mempool/nginx-mempool.conf /etc/nginx/nginx-mempool.conf
   sed -i 's/listen 127.0.0.1:80;/listen 80;\n\t\tserver_name explorer.example.com;/' /etc/nginx/nginx.conf
   sed -i 's/^user nobody;/user www-data;/' /etc/nginx/nginx.conf
   nginx -t && systemctl reload nginx
   ```

   For HTTPS, put the site behind Cloudflare (proxied), or get a certificate from Let's Encrypt
   (`apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d explorer.example.com`).

9. **Check** `https://explorer.example.com`: new blocks appear on the dashboard; a block, a
   transaction and an address (`D…` and `dm1…`) open; the mining pages show the pools with their
   logos; Graphs → Rich List shows the top holders once the indexer has caught up.

## Commands

```bash
systemctl status mempool-backend richlist-indexer nginx
journalctl -fu mempool-backend           # the backend's log
tail -f /var/log/richlist-indexer.log    # the rich list indexer's log
curl -s http://127.0.0.1:8999/api/v1/backend-info
```

## Updating

The DebitMyData changes live on the `debitmydata` branch, on top of a mempool release. To move them
to a newer release, merge it on a computer of your own, not on the server:

```bash
git clone -b debitmydata https://github.com/DebitMyData-PoW/mempool.git && cd mempool
git remote add upstream https://github.com/mempool/mempool.git
git fetch upstream --tags
git merge v3.3.3          # the new release tag
git push
```

Then, on the server:

```bash
cd /opt/mempool && git pull
cd backend && npm install && npm run build && systemctl restart mempool-backend
cd ../richlist && npm install && systemctl restart richlist-indexer
cd ../frontend && npm install && npm run build && rm -rf /var/www/mempool/browser && cp -r dist/mempool/browser /var/www/mempool/ && chown -R www-data:www-data /var/www/mempool
```
