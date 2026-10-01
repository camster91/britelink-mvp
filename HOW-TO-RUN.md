# BriteLink MVP — How to Run

This document describes how to run the BriteLink MVP locally for development, testing, and demo purposes.

## Quick Start

### Prerequisites

- **Node.js**: Version 22.12 or newer. This is not a preference — it is the intersection of what
  the dependencies declare: `@supabase/supabase-js@2.112.4` requires `>=22.0.0`, and
  `@vitejs/plugin-react@5.0.4` requires `^20.19.0 || >=22.12.0`. Node 18 is not merely
  untested, it is outside every one of their ranges, and CI runs Node 22.
- **npm**: Installed with Node.js

### Install and Run

```bash
# Install dependencies
npm ci

# Run development server
npm run dev
```

The app will be available at `http://localhost:5173` (or the port shown in the terminal).

## Self-host on vps.ashbi.ca (no cloud vendors)

> **Current (2026-09-30):** production runs a **self-hosted Supabase** stack on this VPS
> (`supabase/selfhosted/`, project `britelink-production`, API at `britelink-api.ashbi.ca`). The
> earlier hosted-Supabase plan is in `docs/archive/SUPABASE_PROVISIONING.md` for history. The web
> build takes the API URL, anon key, privacy notice version and commit stamp as build args
> (`Dockerfile`, `docker-compose.yml`), and the CSP origin is derived from the same value. With no
> `.env` on the host, the build still produces the honest demo.

The intended web runtime is this VPS, not Stripe or OpenAI Sites. Unconfigured builds stay in interactive demo mode (device-only sample data). A local Postgres 16 container already runs on the VPS at `/docker/britelink-postgres` with nightly dumps under `/opt/backups/britelink`.

```bash
npm ci
npm run build
docker compose up --build -d
```

The image serves `dist/client` with nginx on `127.0.0.1:8088`. Point Coolify/Traefik at that container when you are ready to publish a hostname. Do not set `VITE_SUPABASE_*` unless a backend actually exists to point them at — until then the unconfigured demo is the honest state.

## Available Commands

### Development

```bash
# Start local development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

### Testing

```bash
# Run all domain and integration tests
npm test

# Run Sites deployment tests
npm run test:sites

# Run accessibility audit
npm run test:a11y

# Run authenticated workspace tests
npm run test:authenticated

# Run staff workspace tests
npm run test:staff

# Run multi-household tests
npm run test:households

# Run local database restore drill
npm run test:restore
```

### Operations (requires configuration)

```bash
# Check hosted environment health
npm run health:hosted

# Verify hosted isolation
npm run verify:hosted-isolation
```

## Configuration

### Browser-Only Demo Mode (Default)

By default, the app runs as an **interactive browser-only demo** with:
- Fictional sample data
- Local browser storage persistence
- No authentication required
- No backend connection

**No configuration needed** — just run `npm run dev`.

### Authenticated Mode (Optional)

To enable the authenticated workspace with real Supabase backend:

1. Copy `.env.example` to `.env`
2. Add your Supabase project credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

3. Set the privacy notice version (only after counsel approval):

```env
VITE_PRIVACY_NOTICE_VERSION=2026-09-01
```

**Important**: Never commit real credentials or service-role keys to the repository.

## What Gets Built

- **Client bundle**: `dist/client/` — Static assets for browser
- **Server entry**: `dist/server/index.js` — Sites deployment worker
- **Hosting config**: `dist/.openai/hosting.json` — Sites routing configuration

## Project Structure

- `src/` — React application source code
- `tests/` — Test suites (domain, integration, accessibility)
- `scripts/` — Build, audit, and operations scripts
- `supabase/` — Database migrations and RLS policies
- `docs/` — `TODO.md` (what is left), `PROJECT-STATUS.md` (what is verified) and the operations runbooks

## Important Notes

### Current Status

Production (`britelink.ashbi.ca`) is live on a self-hosted backend with the approved privacy notice. Local runs with no `.env` produce the interactive demo, which needs no third-party accounts. What is still needed before real families is listed in `docs/TODO.md`.

See `docs/PROJECT-STATUS.md` for verified status.

### Browser-Only Demo Limitations

- Data persists only in browser `localStorage`
- No multi-device sync
- Clearing browser data loses all changes
- No authentication or user accounts

### Security

- Never expose `service_role` keys
- Never commit real credentials
- Use separate staging/production environments
- Follow principle of least privilege

## Troubleshooting

### Port Already in Use

If port 5173 is busy, Vite will try the next available port. Check the terminal output for the actual URL.

### Build Fails

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Tests Timeout

Some tests (especially restore drill) can take 30+ seconds. This is expected.

## Next Steps

- Review `docs/TODO.md` for what is left
- Review `REAL_WORLD_REVIEW.md` for known gaps and blockers
- Review `docs/RELEASE_READINESS.md` for launch gates

## Support

For issues related to this MVP prototype, see the GitHub repository issues.
