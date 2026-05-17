# Notes App — Backend API

A multi-user notes service backend, modelled after Google Keep / Apple Notes. Built with **Node.js + Express**, runs on **SQLite** for local development and **PostgreSQL** in production, with **JWT authentication**, **sharing**, and several thoughtful product features.

> ### 🚀 Live deployment
>
> **Base URL:** **https://notes-app-backend-tmvd.onrender.com**
>
> | Endpoint | URL |
> | --- | --- |
> | Interactive docs (Swagger UI) | https://notes-app-backend-tmvd.onrender.com/docs |
> | OpenAPI 3.0 spec | https://notes-app-backend-tmvd.onrender.com/openapi.json |
> | About | https://notes-app-backend-tmvd.onrender.com/about |
> | Web UI (try the app) | https://notes-app-backend-tmvd.onrender.com/ui |
> | Health check | https://notes-app-backend-tmvd.onrender.com/healthz |
>
> _Hosted on Render free tier with managed PostgreSQL — the service spins down after 15 min of idle and cold-starts in ~30 s on the first hit. The 49-step end-to-end test suite (`scripts/smoke-test.ps1`) passes against this URL._

---

## Table of contents

1. [Feature checklist](#feature-checklist)
2. [Quick start (local)](#quick-start-local)
3. [Configuration](#configuration)
4. [API reference (summary)](#api-reference-summary)
5. [Custom features (deep dive)](#custom-features-deep-dive)
6. [Architecture](#architecture)
7. [Security](#security)
8. [Run with Docker](#run-with-docker)
9. [Deploy to Render](#deploy-to-render)
10. [Project structure](#project-structure)

---

## Feature checklist

### Required

- [x] `POST /register` — register a new user (email + password)
- [x] `POST /login` — issue a JWT
- [x] `GET /notes` — list notes for the authenticated user
- [x] `GET /notes/{id}` — get a single note
- [x] `POST /notes` — create a note
- [x] `PUT /notes/{id}` — update a note
- [x] `DELETE /notes/{id}` — delete a note
- [x] `POST /notes/{id}/share` — share a note with another user
- [x] `GET /openapi.json` — OpenAPI 3.0 specification
- [x] `GET /about` — author + custom features description
- [x] **My own meaningful feature(s)** — see [below](#custom-features-deep-dive)

### Stretch goals (all completed)

- [x] Pagination on `GET /notes` (`?page=&limit=`)
- [x] Full-text search at `GET /search?q=keyword`
- [x] Dockerized (`Dockerfile` + `docker-compose.yml` with PostgreSQL)
- [x] Basic frontend at `/ui`

---

## Quick start (local)

Prerequisites: **Node 18+** (Node 22 used during development), npm.

```bash
git clone <your-repo-url>
cd notes-app
cp .env.example .env        # optional; sensible defaults are used otherwise
npm install
npm start
```

Server is now at `http://localhost:3000`. By default it uses a local SQLite file at `./data/notes.db`.

Try it:

```bash
# 1. Register
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongP@ssw0rd"}'

# 2. Login (capture the token)
TOKEN=$(curl -s -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongP@ssw0rd"}' \
  | jq -r .access_token)

# 3. Create a note
curl -X POST http://localhost:3000/notes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First note","content":"Hello world","tags":["intro"],"pinned":true}'

# 4. List notes
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/notes
```

Open `http://localhost:3000/docs` for the interactive Swagger UI, or `http://localhost:3000/ui` for the web UI.

---

## Configuration

All settings come from environment variables. See `.env.example` for the full list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port to listen on |
| `NODE_ENV` | `development` | `production` enables stricter warnings |
| `JWT_SECRET` | _insecure dev string_ | **Required in production.** HMAC secret for JWT |
| `JWT_EXPIRES_IN` | `7d` | JWT lifetime (jsonwebtoken syntax) |
| `BCRYPT_ROUNDS` | `10` | bcrypt cost factor for password hashing |
| `DATABASE_URL` | _(unset)_ | Postgres connection string. If unset, SQLite is used. |
| `SQLITE_PATH` | `./data/notes.db` | SQLite file path (used when `DATABASE_URL` is unset) |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Global rate-limit window (15 min) |
| `RATE_LIMIT_MAX` | `300` | Max requests per IP per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Auth-endpoint rate-limit window |
| `AUTH_RATE_LIMIT_MAX` | `20` | Max login/register attempts per window |
| `OWNER_NAME` | `Your Name` | Returned by `GET /about` |
| `OWNER_EMAIL` | `you@example.com` | Returned by `GET /about` |

---

## API reference (summary)

The **authoritative reference is the OpenAPI spec** at `GET /openapi.json` (rendered visually at `/docs`). Here is a high-level summary of every endpoint:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/register` | – | Create user. `201` on success, `409` if email exists |
| `POST` | `/login` | – | Returns `{ access_token }`. `401` on bad creds |
| `GET` | `/notes` | JWT | Paginated list. Filters: `?page=&limit=&archived=&tag=&shared=&sort=&order=` |
| `POST` | `/notes` | JWT | Create note. Body: `{ title, content?, tags?, pinned? }` |
| `GET` | `/notes/{id}` | JWT | Read note (owner **or** anyone it's been shared with) |
| `PUT` | `/notes/{id}` | JWT | Update note (owner **or** users with `write` share). Body fields are all optional |
| `DELETE` | `/notes/{id}` | JWT | Delete note (owner only). `204` |
| `POST` | `/notes/{id}/share` | JWT | Share with `share_with_email`, optional `permission: "read" \| "write"` |
| `DELETE` | `/notes/{id}/share` | JWT | Revoke a share. Body: `{ revoke_email }` |
| `GET` | `/notes/{id}/shares` | JWT | List users this note is shared with (owner only) |
| `GET` | `/notes/{id}/versions` | JWT | Version history for the note |
| `GET` | `/search?q=...` | JWT | Full-text search across owned + shared notes |
| `GET` | `/about` | – | Author + custom-features metadata |
| `GET` | `/openapi.json` | – | The OpenAPI 3.0 document |
| `GET` | `/docs` | – | Swagger UI |
| `GET` | `/ui` | – | Web frontend |
| `GET` | `/healthz` | – | Liveness probe |

### Note object shape

```json
{
  "id": "f08b1a5c-...-...",
  "owner_id": "5c98...",
  "title": "Grocery list",
  "content": "milk, eggs",
  "pinned": true,
  "archived": false,
  "tags": ["personal", "shopping"],
  "created_at": "2026-05-17T10:00:00.000Z",
  "updated_at": "2026-05-17T10:05:00.000Z"
}
```

### List response shape (with pagination)

```json
{
  "items": [ /* notes */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

### Error response shape

```json
{ "message": "Validation failed", "errors": [{ "path": "email", "message": "...", "code": "..." }] }
```

---

## Custom features (deep dive)

These go beyond the spec to make the product feel _real_:

1. **Tagging & tag filtering.** Each note can carry up to 20 short, lowercase tags (`/^[a-z0-9][a-z0-9\-_]{0,31}$/`). List with `?tag=work` to filter. Why: tagging is the lightest possible organization scheme — no hierarchy, easy to add/remove.
2. **Pin / unpin.** A boolean `pinned` flag bubbles important notes to the top of every list response. Why: matches Google Keep's most-used UX; dramatically improves daily retrieval.
3. **Archive.** Notes can be archived (soft-hidden) without deletion. Default list hides them; pass `?archived=all` or `?archived=true` to see them. Why: encourages decluttering without destructive deletes.
4. **Note version history.** Every `PUT /notes/{id}` snapshots the previous state into `note_versions` before mutating. `GET /notes/{id}/versions` returns the audit trail with editor + timestamp. Why: critical safety net for collaborative editing.
5. **Read vs write sharing.** `POST /notes/{id}/share` accepts `permission: "read"` (default) or `"write"`. Write-permission shares can update content/title but cannot pin, archive, change tags, delete, or re-share. Why: real collaboration needs more than a flat ACL.
6. **Revoke share.** `DELETE /notes/{id}/share` with `{ revoke_email }` removes a user's access. List shares with `GET /notes/{id}/shares`.
7. **Full-text search** at `GET /search?q=keyword`, paginated, scoped to owned + shared notes. LIKE-escaped to prevent injection.
8. **Comprehensive validation and rate limiting.** All bodies/params/queries validated with `zod`. Login uses a constant-time compare against a dummy hash when the user is missing — prevents user-enumeration via response timing. Auth endpoints are rate-limited separately from the global limiter.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Express App                            │
│  helmet → cors → express.json(256kb) → global rate limit        │
│                          ↓                                      │
│  /register, /login  →  authRoutes (auth-specific rate limit)    │
│  /notes/*           →  notesRoutes (authRequired)               │
│  /search            →  searchRoutes (authRequired)              │
│  /about             →  aboutRoutes                              │
│  /openapi.json      →  buildOpenApiSpec()                       │
│  /docs              →  Swagger UI (swagger-ui-dist)             │
│  /ui                →  static frontend (public/index.html)      │
│                          ↓                                      │
│             errorHandler (HttpError → JSON)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
            ┌─────────────────────────────────────┐
            │  Thin DB driver (src/db/index.js)   │
            │  • SQLite (better-sqlite3)  [dev]   │
            │  • PostgreSQL (pg)         [prod]   │
            │  Uniform async API; ? placeholders  │
            │  auto-translated to $1, $2... for pg│
            └─────────────────────────────────────┘
```

**Why this design?**

- **Single uniform query API** for both DBs lets the same routes file work locally (zero-setup SQLite) and in production (Postgres). No ORM overhead.
- **Idempotent schema** (`CREATE TABLE IF NOT EXISTS …`) runs on every boot so deploys self-bootstrap.
- **Routes are thin handlers**; validation lives in `zod` schemas, errors in `HttpError`, response shapes in a few small helpers.

---

## Security

- **Passwords hashed with bcrypt** (cost 10 by default; tune via `BCRYPT_ROUNDS`).
- **JWT signed with HMAC-SHA256**, secret in `JWT_SECRET`. App warns if a default secret is used in production.
- **Constant-time login**: even when the user does not exist, bcrypt is run against a dummy hash so attackers cannot enumerate accounts via response timing.
- **`helmet`** sets sensible security headers.
- **`express-rate-limit`** with a stricter limit on `/register` and `/login`.
- **Strict body size limit** (`256kb`) on JSON bodies.
- **All input validated** with `zod` (`.strict()` rejects unknown keys).
- **Ownership / permission checks** on every notes route.
- **Parameterized queries everywhere** — no string interpolation into SQL.
- **`?` placeholders auto-translated** to `$N` for Postgres to avoid hand-written `$1, $2, ...` mistakes.

---

## Run with Docker

```bash
# Build & run API + Postgres together
docker compose up --build

# In another terminal:
curl http://localhost:3000/healthz
```

The compose file provisions PostgreSQL 16 with `DATABASE_URL=postgres://notes:notes@db:5432/notes`. Persistent volumes keep your data across restarts.

To run **just the API** with SQLite:

```bash
docker build -t notes-api .
docker run --rm -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 64) \
  -v $(pwd)/data:/app/data \
  notes-api
```

---

## Deploy to Render

This repo includes a `render.yaml` blueprint that provisions both the **web service** and a **free Postgres database**, wires them together, and auto-generates a secure `JWT_SECRET`.

### Steps

1. Push this repo to GitHub.
2. Sign in to [Render](https://dashboard.render.com).
3. Click **New → Blueprint**, point it at this repo, and Render reads `render.yaml`.
4. When prompted, set the `OWNER_NAME` and `OWNER_EMAIL` env vars (used by `/about`).
5. Click **Apply**. Render builds, provisions Postgres, and deploys the API.
6. Once green, the URL appears as something like `https://notes-app-api.onrender.com`.

Sanity-check the deploy:

```bash
curl https://<your-app>.onrender.com/about
curl https://<your-app>.onrender.com/openapi.json | head
```

> **Free tier note:** Render free web services spin down after 15 min of idle and cold-start in ~30 s on the first hit. Free Postgres has a 90-day lifetime; rotate or upgrade before then. SQLite is **not** recommended on Render free (the filesystem is ephemeral on redeploy) — the blueprint uses Postgres for this reason.

---

## Project structure

```
.
├── src/
│   ├── server.js              # boot + graceful shutdown
│   ├── app.js                 # express app composition
│   ├── config.js              # env loading
│   ├── openapi.js             # OpenAPI 3.0 spec builder
│   ├── db/
│   │   ├── index.js           # uniform SQLite/Postgres driver
│   │   └── schema.js          # idempotent schema init
│   ├── middleware/
│   │   ├── auth.js            # JWT sign + require
│   │   ├── errorHandler.js    # HttpError → JSON response
│   │   └── validate.js        # zod request validation
│   ├── routes/
│   │   ├── auth.js            # /register, /login
│   │   ├── notes.js           # /notes CRUD + share + versions
│   │   ├── search.js          # /search
│   │   └── about.js           # /about
│   └── utils/
│       ├── async.js           # asyncHandler
│       └── errors.js          # HttpError constructors
├── public/
│   └── index.html             # standalone frontend (no build step)
├── Dockerfile
├── docker-compose.yml
├── render.yaml
├── package.json
├── .env.example
└── README.md
```

---

## License

MIT
