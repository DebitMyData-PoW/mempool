# Server files

What a DebitMyData Explorer server needs besides the code. [INSTALL.md](../../INSTALL.md) explains
each step.

| File | |
| --- | --- |
| `mempool-config.example.json` | The backend's settings, with placeholders (`__…__`) where your own values go. Copy it to `backend/mempool-config.json` |
| `mempool-frontend-config.example.json` | The website's settings. Copy it to `frontend/mempool-frontend-config.json` |
| `mempool-backend.service` | The backend, as a systemd service (code in `/opt/mempool`) |
| `richlist-indexer.service` | The rich list indexer, as a systemd service |
