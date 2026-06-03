# Bookmark Demo

A minimal personal bookmark app that runs locally with a Node/Hono API, a React
+ Vite client, a SQLite database file, and local OGP image storage.

The app has no authentication and supports bookmark registration, editing,
deletion, search, pagination, page title fetching, and OGP thumbnail caching.

## Stack

- Node.js
- Hono API
- React + Vite client
- SQLite for bookmark storage
- Local filesystem storage for OGP images

## Local Setup

Use Node.js 22.5.0 or newer. This app uses `node:sqlite`, which is still marked
experimental by Node.js and may print an ExperimentalWarning at startup.

Install dependencies:

```sh
npm install
```

Start the local API server and Vite client:

```sh
npm run dev
```

Open the Vite URL, usually:

```text
http://127.0.0.1:5173
```

The API server listens on `http://127.0.0.1:8787`. Vite proxies `/api` and
`/ogp` requests to that server.

## Local Data

By default, the server creates:

- `data/bookmarks.sqlite`
- `data/ogp/`

You can override those paths:

```sh
BOOKMARK_DB_PATH=/path/to/bookmarks.sqlite OGP_STORAGE_DIR=/path/to/ogp npm run dev:server
```

Migrations in `migrations/` are applied automatically when the server starts.

## Scripts

- `npm run dev` starts the local API server and Vite client.
- `npm run dev:server` starts only the local API server.
- `npm run dev:client` starts only the Vite client dev server.
- `npm run build` type-checks and builds the client.
- `npm run preview` builds the client and serves it from the local API server.
- `npm test` runs unit and UI tests.

## Behavior

Bookmarks are created from a URL. The server fetches the page HTML, extracts the
`<title>`, and stores the normalized URL and title in SQLite. If title fetching
fails, the bookmark is still saved with the URL as its title.

Saved bookmarks can be edited to update the URL and add comma-separated tags or
a memo. They can also be deleted. Delete actions ask for browser confirmation
before removing the bookmark. The list is paginated at 10 bookmarks per page.
Search terms are split by spaces and matched as AND conditions against URL,
title, tags, and memo with SQL `LIKE`.

When a page has an `og:image`, the server downloads a safe raster image type and
stores it under `data/ogp/`. The client receives a local path like
`/ogp/<uuid>.png`.
