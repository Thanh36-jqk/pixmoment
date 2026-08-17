# Pixmoment

Share full-quality photos with someone via a link — no compression, no resize,
no account required. Upload a batch, get a shareable album URL, and the
recipient downloads the untouched originals (individually or as a ZIP).

Built for phones first: adaptive upload concurrency, HEIC/RAW handling, in-app
browser (Zalo/Messenger/…) detection, and a screen wake-lock so long mobile
uploads don't get suspended mid-batch.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19**
- **Tailwind CSS 4**, **framer-motion**, **lucide-react**
- **Vercel Blob** for storage, **Upstash Redis** for rate limiting
- **client-zip** for streaming ZIP downloads in the browser

## How it works

- **Photos** upload straight from the browser to a **public** Blob store via
  short-lived client tokens (`/api/upload`), so bytes never round-trip through a
  serverless function.
- **Album + owner metadata** (which includes password hashes) lives in a
  **separate private** Blob store — Vercel Blob stores are all-public or
  all-private, so the two can't share one token. See `.env.example`.
- **Passwords** are salted-scrypt hashed (`src/lib/password.ts`). The album
  `GET` never returns photos for a protected album — it only reports that a
  password is required; photos come back solely from the `POST` verify path.
- **Ownership** is a per-browser id in `localStorage` (`src/lib/ownerToken.ts`),
  not a real account. It powers "My albums" and authorizes deletion. Clearing
  storage or switching device loses that history — the accepted cost of no auth.
- **Expiry** is enforced at read time (410) *and* swept for real by a daily cron
  (`/api/cron/cleanup`, scheduled in `vercel.json`) that hard-deletes expired
  albums and their photos.
- **Rate limiting** is per-IP (`src/lib/rateLimit.ts`). Without Upstash env vars
  it fails open and logs a warning.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the tokens (see comments in the file)
npm run dev                  # http://localhost:3000
```

The app runs without any env vars, but uploads/albums need the Blob tokens;
rate limiting needs Upstash; the cleanup cron needs `CRON_SECRET`.

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Dev server (Turbopack)                        |
| `npm run build`     | Production build                              |
| `npm run lint`      | ESLint                                        |
| `npx tsc --noEmit`  | Typecheck                                     |
| `npm test`          | Unit tests (Vitest, run once)                 |
| `npm run test:watch`| Unit tests in watch mode                      |

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on every
push and pull request.

## Deploy

Deploy on Vercel. Create the two Blob stores and connect them (public token as
`BLOB_READ_WRITE_TOKEN`, private token as `PRIVATE_READ_WRITE_TOKEN`), add the
Upstash and `CRON_SECRET` env vars, and the cron in `vercel.json` is picked up
automatically.
