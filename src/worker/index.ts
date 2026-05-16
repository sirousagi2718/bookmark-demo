import { Hono } from "hono";
import type { Bookmark, CreateBookmarkRequest } from "../shared/bookmarks";
import { fetchPageTitle, normalizeUrl } from "./title";

type Bindings = {
  // These names must match the bindings in wrangler.toml.
  DB: D1Database;
  // R2 is not used yet, but the binding is ready for future OGP image storage.
  OGP_BUCKET: R2Bucket;
  // ASSETS lets the Worker serve the built React app from dist/client.
  ASSETS: Fetcher;
};

type BookmarkRow = {
  id: number;
  url: string;
  title: string;
  created_at: string;
  updated_at: string;
};

// D1 returns snake_case column names. The API returns camelCase because that is
// the style most TypeScript/React code uses.
const toBookmark = (row: BookmarkRow): Bookmark => ({
  id: row.id,
  url: row.url,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/bookmarks", async (c) => {
  // Prepared statements keep SQL and user data separate. Even though this query
  // has no user input, using prepare() everywhere keeps the pattern consistent.
  const result = await c.env.DB.prepare(
    "SELECT id, url, title, created_at, updated_at FROM bookmarks ORDER BY created_at DESC, id DESC"
  ).all<BookmarkRow>();

  return c.json({ bookmarks: result.results.map(toBookmark) });
});

app.post("/api/bookmarks", async (c) => {
  let payload: CreateBookmarkRequest;

  try {
    // c.req.json() reads the request body and parses JSON sent by the browser.
    payload = await c.req.json<CreateBookmarkRequest>();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  if (typeof payload.url !== "string") {
    return c.json({ error: "URL is required." }, 400);
  }

  let url: string;
  try {
    // Normalize before saving so small differences like fragments do not create
    // duplicate-looking bookmarks.
    url = normalizeUrl(payload.url);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid URL." }, 400);
  }

  // Title fetching is helpful but not required. If the target site is down,
  // blocks requests, or has no <title>, we still save the bookmark.
  const title = (await fetchPageTitle(url)) ?? url;
  const now = new Date().toISOString();

  try {
    // RETURNING gives us the inserted row in one round trip, so the UI can update
    // immediately without making a second GET request.
    const result = await c.env.DB.prepare(
      "INSERT INTO bookmarks (url, title, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id, url, title, created_at, updated_at"
    )
      .bind(url, title, now, now)
      .first<BookmarkRow>();

    if (!result) {
      return c.json({ error: "Failed to create bookmark." }, 500);
    }

    return c.json({ bookmark: toBookmark(result) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // The database has a UNIQUE constraint on url. Turning that into a 409 makes
    // the API error clearer for the client.
    if (message.toLowerCase().includes("unique")) {
      return c.json({ error: "This URL is already bookmarked." }, 409);
    }

    return c.json({ error: "Failed to create bookmark." }, 500);
  }
});

// Any non-API request falls through to the static React app. This is what makes
// the Worker serve both the backend API and frontend from the same deployment.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
