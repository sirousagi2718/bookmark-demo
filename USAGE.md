# Usage Guide

This guide explains how to run and use the Bookmark Demo app locally.

## What This App Does

Bookmark Demo is a small personal bookmark web app with a local Node/Hono API.

You can:

- Add a bookmark by entering a URL.
- Edit a saved bookmark's URL, tags, and memo.
- Delete a saved bookmark after a confirmation dialog.
- Search bookmarks by URL, title, tags, or memo.
- See saved bookmarks in a newest-first paginated list.
- Store bookmark data in a local SQLite file.
- Cache OGP images in local filesystem storage.

## Install Dependencies

Run this once after cloning the repository:

```sh
npm install
```

## Run Locally

Start the API server and Vite client:

```sh
npm run dev
```

Open the Vite URL, usually:

```text
http://127.0.0.1:5173
```

The API server listens on:

```text
http://127.0.0.1:8787
```

## Local Storage

The server creates local data automatically:

```text
data/bookmarks.sqlite
data/ogp/
```

Override those paths when needed:

```sh
BOOKMARK_DB_PATH=/tmp/bookmarks.sqlite OGP_STORAGE_DIR=/tmp/bookmark-ogp npm run dev:server
```

SQL migrations in `migrations/` are applied automatically on server startup.

## Use the App

1. Open the app in your browser.
2. Enter a URL such as `https://example.com`.
3. Click `Add`.
4. The server fetches the page HTML and tries to read its `<title>`.
5. The bookmark is saved in SQLite and appears in the list.

Each page shows up to 10 bookmarks. Use `Previous` and `Next` to move through
pages.

Use the search box to filter bookmarks. Multiple words are split by spaces and
matched as OR search terms, so `sqlite hono` returns bookmarks containing either
`sqlite` or `hono` in the URL, title, tags, or memo.

To add tags or a memo, click `Edit`, update the fields, and click `Save`. To
remove a bookmark, click `Delete` and confirm the browser dialog.

If title fetching fails, the bookmark is still saved. In that case, the URL is
used as the title.

If the page exposes an `og:image`, the server downloads a safe raster image type
and stores it locally under `data/ogp/`.

## API Endpoints

List bookmarks:

```sh
curl "http://localhost:8787/api/bookmarks?page=1&q=bookmark%20social"
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

Build the client:

```sh
npm run build
```

Start only the local API server:

```sh
npm run dev:server
```

Start only the Vite client:

```sh
npm run dev:client
```

## Notes for Beginners

- `src/client` contains the React browser UI.
- `src/server` contains the local Hono API.
- `src/shared` contains TypeScript types used by both client and server code.
- `migrations` contains SQL files applied to the local SQLite database.
