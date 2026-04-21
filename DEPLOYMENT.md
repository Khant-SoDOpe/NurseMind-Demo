# VPS Deployment Guide

This app is a single Node.js service that serves its own static frontend. In production you should run it behind **nginx** with **HTTPS**, and supply secrets via environment variables.

## What changed for multi-user / VPS

- **CORS** is now configurable via `ALLOWED_ORIGINS` (comma-separated origins, or `*`). Credentials are supported.
- **Sessions** use secure, HTTP-only cookies in production and respect `X-Forwarded-*` headers (via `trust proxy`).
- **Security headers** via `helmet` + response `compression`.
- **Rate limiting** on `/auth/*` and `/api/*` to prevent abuse.
- Binds to `HOST` (default `0.0.0.0`) and performs graceful shutdown on `SIGINT`/`SIGTERM`.
- Ships with **Dockerfile**, **docker-compose.yml**, **PM2 ecosystem**, and an **nginx** example.

---

## Required environment variables

Copy `.env.example` to `.env` and fill in all values. The critical production ones:

| Var | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | Set to `production` |
| `PORT` | yes | e.g. `4000` |
| `HOST` | no | `0.0.0.0` to listen on all interfaces |
| `SESSION_SECRET` | **yes** | Long random string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ALLOWED_ORIGINS` | yes | Comma-separated list, e.g. `https://app.example.com,https://admin.example.com`. Use `*` to allow any origin (not recommended with credentials). |
| `TRUST_PROXY` | yes (behind nginx) | `1` when behind a single reverse proxy |
| `REDIS_URL` | yes | Upstash or self-hosted Redis |
| `CLOUDINARY_*` | yes | Media storage |
| `RESEND_API_KEY` | for email | |
| `AZURE_SPEECH_*` | for STT/TTS | |
| `GEMINI_API_KEY` | for AI | |
| `AVATAR_SECRET_KEY` | for avatar API | |

---

## Option A — Deploy with Docker Compose (recommended)

Prereqs on the VPS: `docker` + `docker compose`.

```bash
# 1. Clone
git clone <your-repo-url> /opt/nurse-assessment
cd /opt/nurse-assessment

# 2. Configure env
cp .env.example .env
$EDITOR .env   # fill in secrets, set NODE_ENV=production, ALLOWED_ORIGINS=...

# 3. Build & run
docker compose up -d --build

# 4. Check
docker compose ps
docker compose logs -f app
curl -fsS http://127.0.0.1:4000/health
```

Compose exposes the app only on `127.0.0.1:4000` — you then put **nginx** in front for TLS (see below).

To update:
```bash
git pull
docker compose up -d --build
```

---

## Option B — Deploy with PM2 (no Docker)

Prereqs on the VPS: Node.js 18+ and npm.

```bash
# 1. Clone and install
git clone <your-repo-url> /opt/nurse-assessment
cd /opt/nurse-assessment
npm ci --omit=dev

# 2. Configure env
cp .env.example .env
$EDITOR .env

# 3. Install PM2 globally and start
sudo npm i -g pm2
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd    # follow the printed command so PM2 restarts on reboot
```

Useful commands:
```bash
pm2 status
pm2 logs nurse-assessment
pm2 restart nurse-assessment
pm2 reload nurse-assessment   # zero-downtime
```

---

## nginx + HTTPS (Let's Encrypt)

Install nginx and certbot:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Copy the example config and enable it:

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/nurse-assessment
sudo sed -i 's/your-domain.com/REAL-DOMAIN.com/g' /etc/nginx/sites-available/nurse-assessment
sudo ln -s /etc/nginx/sites-available/nurse-assessment /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Issue TLS certificates:

```bash
sudo certbot --nginx -d REAL-DOMAIN.com -d www.REAL-DOMAIN.com
```

Certbot will patch the nginx config with the correct cert paths and set up auto-renew.

---

## Firewall

If using `ufw`:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'     # 80 + 443
sudo ufw enable
```

The app itself (`:4000`) must **not** be exposed to the public internet — only nginx should reach it on `127.0.0.1:4000`.

---

## CORS for multiple users / separate frontends

The server supports three modes, chosen by `ALLOWED_ORIGINS`:

1. **Locked-down (recommended):** list exact origins, e.g.
   ```
   ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
   ```
   Cookies with `credentials: 'include'` work from these origins.

2. **Open to any origin:** `ALLOWED_ORIGINS=*`. Allowed, but avoid when using credentials — browsers block `*` with credentials.

3. **Reflect (dev default):** leave `ALLOWED_ORIGINS` empty. The server reflects the request's `Origin`. Do **not** use this in production.

Make sure your frontend fetches the API with `credentials: 'include'` if it lives on a different origin, and that `SameSite` of the session cookie is `none` + `secure` if cookies need to cross sites. In that case, update `server.js`:

```js
// inside app.use(session({ cookie: { ... } }))
sameSite: 'none',
secure: true,
```

and serve **both** origins over HTTPS.

---

## Health check

```
GET /health
```

Used by Docker, PM2, and load balancers. Returns `200` when the process is up.

---

## Scaling notes

`express-session` currently uses the default in-memory store. For multi-instance deployments (PM2 cluster mode or multiple containers), switch to a shared store such as [`connect-redis`](https://github.com/tj/connect-redis) pointed at your existing `REDIS_URL`. Until then, keep `instances: 1` in `ecosystem.config.js`.
