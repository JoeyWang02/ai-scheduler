# Self-hosting on your own machine + Cloudflare Tunnel

For a home/lab machine with **no public IP**. You run the app locally with
Docker Compose, and a Cloudflare Tunnel gives testers a public HTTPS URL —
**no port forwarding, works behind home/campus NAT**.

```
[testers] --HTTPS--> Cloudflare --tunnel--> your machine :8081 (app + frontend + API)
                                                 └── Postgres (docker)
```

> **The machine must stay on** while people are testing. A sleeping laptop = app
> offline. Use a desktop/mini-PC you can leave running.

## 1. Install prerequisites (once)
- **Docker Desktop** (you already have it).
- **cloudflared**: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  (Windows: download the `.exe` or `winget install --id Cloudflare.cloudflared`).

## 2. Configure secrets
Copy `.env.example` → `.env` and fill in (or add the new keys to your existing
`.env`). At minimum set `POSTGRES_PASSWORD` and `LLM_API_KEY`. Leave `PUBLIC_URL`
for step 4. `.env` is gitignored.

## 3. Start the app
```bash
docker compose up --build -d
```
- Builds the image (bundles the frontend into the backend), starts Postgres +
  the app, runs Flyway migrations automatically.
- Verify locally: open http://localhost:8081 — the app should load.
- Logs: `docker compose logs -f app`

## 4. Expose it with a tunnel

### Option A — Quick tunnel (fastest, no account/domain)
```bash
cloudflared tunnel --url http://localhost:8081
```
It prints a URL like `https://random-words.trycloudflare.com`. Then:
1. Put that URL in `.env` as `PUBLIC_URL=https://random-words.trycloudflare.com`
2. `docker compose up -d` again (so the app picks up FRONTEND_ORIGIN).
3. Share the URL. **Email/password signup works immediately.**

Caveat: the URL changes each time you restart the quick tunnel, and you must
re-set `PUBLIC_URL` + re-up when it does. Fine for a short test session; for a
stable link use Option B.

### Option B — Named tunnel (stable URL, needs a domain on Cloudflare)
```bash
cloudflared tunnel login
cloudflared tunnel create nexus
cloudflared tunnel route dns nexus study.yourdomain.com
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: nexus
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: study.yourdomain.com
    service: http://localhost:8081
  - service: http_status:404
```
Run it (or `cloudflared service install` to keep it running):
```bash
cloudflared tunnel run nexus
```
Then set `PUBLIC_URL=https://study.yourdomain.com` in `.env` and `docker compose up -d`.

## 5. Google login (optional)
Only if you want Google sign-in. In Google Cloud Console → Credentials → your
OAuth client, add:
- Authorized redirect URI: `${PUBLIC_URL}/api/auth/oauth/google/callback`
- Authorized JavaScript origin: `${PUBLIC_URL}`

(Skip this to start — email/password works without it.)

## Updating after code changes
```bash
git pull        # if changes are on GitHub
docker compose up --build -d
```

## Stopping
```bash
docker compose down          # keep data
docker compose down -v       # also wipe the database volume
```
