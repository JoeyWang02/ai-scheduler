# Deploying to Railway (single service: backend serves the frontend)

The Dockerfile builds one image that runs the Spring Boot API **and** serves the
web app from the same origin. You deploy that one service plus a Postgres
database. Total: ~15 minutes.

> I (Claude) prepared the code + this guide. The steps below are the ones only
> **you** can do — they need your accounts and secrets, which I can't enter.

## 0. Prerequisites
- The repo is pushed to GitHub (`ZoeyWang02/ai-scheduler`). Commit + push the
  new deploy files first (Dockerfile, .dockerignore, config/prop changes).
- A [Railway](https://railway.app) account (sign in with GitHub).
- Your **Groq** API key (`LLM_API_KEY`) and, if you want Google login, your
  **Google OAuth** client id + secret.

## 1. Create the project + database
1. Railway → **New Project** → **Deploy from GitHub repo** → pick
   `ZoeyWang02/ai-scheduler`. Railway detects the `Dockerfile` and builds it.
2. In the same project: **New** → **Database** → **PostgreSQL**.

## 2. Set environment variables on the app service
Open the app service → **Variables** → add:

| Variable | Value |
|---|---|
| `DB_URL` | `jdbc:postgresql://${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` |
| `LLM_API_KEY` | your Groq key |
| `GOOGLE_CLIENT_ID` | your Google OAuth client id *(skip if not using Google login)* |
| `GOOGLE_CLIENT_SECRET` | your Google OAuth client secret *(skip if not using)* |

`${{Postgres.*}}` are Railway variable references — if your DB service isn't
named `Postgres`, use its actual name. `PORT` is injected by Railway
automatically (the app already reads it). Flyway creates the schema on first boot.

## 3. Get the public URL, then set the origin vars
1. App service → **Settings → Networking → Generate Domain**. You'll get
   something like `https://ai-scheduler-production.up.railway.app`.
2. Add two more variables using that domain:

| Variable | Value |
|---|---|
| `FRONTEND_ORIGIN` | `https://<your-domain>` |
| `GOOGLE_REDIRECT_URI` | `https://<your-domain>/api/auth/oauth/google/callback` |

Railway redeploys on variable changes.

## 4. Update Google Cloud Console (only if using Google login)
Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 client:
- **Authorized redirect URIs**: add `https://<your-domain>/api/auth/oauth/google/callback`
- **Authorized JavaScript origins**: add `https://<your-domain>`

## 5. Test
Open `https://<your-domain>` → sign up / add a task / try Google login. Send that
link to your testers.

## Notes
- **Email/password signup works without any Google setup** — you can start
  testing immediately and add Google login later.
- Free-tier Postgres and the app may sleep on inactivity; the first request after
  idle can be slow (cold start).
- Reminders are still in-app only (fire while the tab is open) — the Web Push
  upgrade is separate and not part of this deploy.
- Local dev is unchanged: `run-local.ps1` for the API on :8081, the static
  preview on :8099.
