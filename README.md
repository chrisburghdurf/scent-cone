# TrailCast

Operational planning UI for visualizing scent cone direction and time-aware envelope estimates.

## Runtime

- Node.js: `>=20.9.0` (see `.nvmrc`)
- Package manager: `npm`

## Local setup

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build and checks

```bash
npm run build
npm run build:webpack
npm run typecheck
npm run lint
```

## Environment variables

No environment variables are required for baseline operation.  
Wind data is fetched from the public Open-Meteo APIs in `pages/api/wind.ts`.

## Vercel

- Build command: `next build` (from `package.json`)
- Output: standard Next.js pages output
