# Usage Guide

This guide explains how to run and use the Bookmark Demo app.

## What This App Does

Bookmark Demo is a small personal bookmark web app that runs on Cloudflare
Workers.

In the initial version, you can:

- Add a bookmark by entering a URL.
- See saved bookmarks in a newest-first list.
- Store bookmark data in Cloudflare D1.

The app also has an R2 binding named `OGP_BUCKET`, but OGP image storage is not
implemented yet.

## Install Dependencies

Run this once after cloning the repository:

```sh
npm install
```

## Create Cloudflare Resources

Create a D1 database:

```sh
npx wrangler d1 create bookmark-demo
```

Wrangler will print a `database_id`. Copy that value into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "bookmark-demo"
database_id = "paste-your-database-id-here"
```

Create an R2 bucket:

```sh
npx wrangler r2 bucket create bookmark-demo-ogp
```

The bucket is configured in `wrangler.toml` as:

```toml
[[r2_buckets]]
binding = "OGP_BUCKET"
bucket_name = "bookmark-demo-ogp"
```

## Apply the D1 Migration

For local development, apply migrations to the local D1 database:

```sh
npx wrangler d1 migrations apply bookmark-demo --local
```

For a real Cloudflare D1 database, apply migrations remotely:

```sh
npx wrangler d1 migrations apply bookmark-demo --remote
```

The migration creates the `bookmarks` table used by the app.

## Run Locally

Build the client, then start the local Cloudflare Worker development server:

```sh
npm run build
npm run dev
```

Open the local URL printed by Wrangler, usually:

```text
http://localhost:8787
```

## Use the App

1. Open the app in your browser.
2. Enter a URL such as `https://example.com`.
3. Click `Add`.
4. The Worker fetches the page HTML and tries to read its `<title>`.
5. The bookmark is saved in D1 and appears at the top of the list.

If title fetching fails, the bookmark is still saved. In that case, the URL is
used as the title.

## API Endpoints

List bookmarks:

```sh
curl http://localhost:8787/api/bookmarks
```

Create a bookmark:

```sh
curl -X POST http://localhost:8787/api/bookmarks \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

The app rejects duplicate normalized URLs with a `409` response.

## Useful Scripts

Run tests:

```sh
npm test
```

Build and dry-run the Worker bundle:

```sh
npm run build
```

Deploy the Worker to Cloudflare:

```sh
npx wrangler d1 migrations apply bookmark-demo --remote
npm run deploy
```

Start the local Worker development server:

```sh
npm run dev
```

## Notes for Beginners

- `src/client` contains the React browser UI.
- `src/worker` contains the Cloudflare Worker API.
- `src/shared` contains TypeScript types used by both client and Worker code.
- `migrations` contains SQL files for D1.
- `wrangler.toml` connects the code to Cloudflare bindings like D1, R2, and
  static assets.
