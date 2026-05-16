# Bookmark Demo

A minimal personal bookmark app for Cloudflare Workers. The first version has no
authentication and supports URL registration plus a bookmark list.

## Stack

- Cloudflare Workers
- Hono API
- React + Vite client
- D1 for bookmark storage
- R2 binding for future OGP image storage

## Local Setup

Install dependencies:

```sh
npm install
```

Create Cloudflare resources:

```sh
npx wrangler d1 create bookmark-demo
npx wrangler r2 bucket create bookmark-demo-ogp
```

Replace `database_id` in `wrangler.toml` with the D1 id returned by Wrangler.

Apply the D1 migration locally:

```sh
npx wrangler d1 migrations apply bookmark-demo --local
```

Build the client, then start the local Cloudflare Worker development server:

```sh
npm run build
npm run dev
```

## Scripts

- `npm run dev` starts the local Cloudflare Worker development server.
- `npm run dev:client` starts only the Vite client dev server.
- `npm run build` type-checks, builds the client, and dry-runs the Worker bundle.
- `npm run preview` also starts the local Cloudflare Worker development server.
- `npm test` runs unit and UI tests.

## Initial Scope

Bookmarks are created from a URL only. The Worker fetches the page HTML, extracts
the `<title>`, and stores the normalized URL plus title in D1. If title fetching
fails, the bookmark is still saved with the URL as its title.

R2 is configured as `OGP_BUCKET`, but OGP image fetching and storage are reserved
for a later iteration.
