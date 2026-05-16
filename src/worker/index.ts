import { Hono } from "hono";
import type { Bookmark, CreateBookmarkRequest, UpdateBookmarkRequest } from "../shared/bookmarks";
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
  tags: string;
  memo: string;
  created_at: string;
  updated_at: string;
};

// D1 returns snake_case column names. The API returns camelCase because that is
// the style most TypeScript/React code uses.
const toBookmark = (row: BookmarkRow): Bookmark => ({
  id: row.id,
  url: row.url,
  title: row.title,
  tags: row.tags,
  memo: row.memo,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const app = new Hono<{ Bindings: Bindings }>();

const PAGE_SIZE = 10;

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const cleanTags = (value: unknown) =>
  cleanText(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");

const getUrlFromPayload = (payload: unknown) => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as CreateBookmarkRequest | UpdateBookmarkRequest).url !== "string"
  ) {
    return null;
  }

  return (payload as CreateBookmarkRequest | UpdateBookmarkRequest).url;
};

const parseBookmarkId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

app.get("/api/bookmarks", async (c) => {
  const pageParam = Number(c.req.query("page") ?? "1");
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  // Prepared statements keep SQL and user data separate. Even though this query
  // has no user input, using prepare() everywhere keeps the pattern consistent.
  const [result, count] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, url, title, tags, memo, created_at, updated_at FROM bookmarks ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    )
      .bind(PAGE_SIZE, offset)
      .all<BookmarkRow>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM bookmarks").first<{ total: number }>()
  ]);

  const totalCount = count?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return c.json({
    bookmarks: result.results.map(toBookmark),
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages
  });
});

app.post("/api/bookmarks", async (c) => {
  let payload: unknown;

  try {
    // c.req.json() reads the request body and parses JSON sent by the browser.
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const payloadUrl = getUrlFromPayload(payload);
  if (payloadUrl === null) {
    return c.json({ error: "URL is required." }, 400);
  }

  let url: string;
  try {
    // Normalize before saving so small differences like fragments do not create
    // duplicate-looking bookmarks.
    url = normalizeUrl(payloadUrl);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid URL." }, 400);
  }

  const tags = cleanTags((payload as CreateBookmarkRequest).tags);
  const memo = cleanText((payload as CreateBookmarkRequest).memo);
  // Title fetching is helpful but not required. If the target site is down,
  // blocks requests, or has no <title>, we still save the bookmark.
  const title = (await fetchPageTitle(url)) ?? url;
  const now = new Date().toISOString();

  try {
    // RETURNING gives us the inserted row in one round trip, so the UI can update
    // immediately without making a second GET request.
    const result = await c.env.DB.prepare(
      "INSERT INTO bookmarks (url, title, tags, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, url, title, tags, memo, created_at, updated_at"
    )
      .bind(url, title, tags, memo, now, now)
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

app.put("/api/bookmarks/:id", async (c) => {
  const id = parseBookmarkId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Bookmark not found." }, 404);
  }

  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const payloadUrl = getUrlFromPayload(payload);
  if (payloadUrl === null) {
    return c.json({ error: "URL is required." }, 400);
  }

  let url: string;
  try {
    url = normalizeUrl(payloadUrl);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid URL." }, 400);
  }

  const tags = cleanTags((payload as UpdateBookmarkRequest).tags);
  const memo = cleanText((payload as UpdateBookmarkRequest).memo);
  const title = (await fetchPageTitle(url)) ?? url;
  const now = new Date().toISOString();

  try {
    const result = await c.env.DB.prepare(
      "UPDATE bookmarks SET url = ?, title = ?, tags = ?, memo = ?, updated_at = ? WHERE id = ? RETURNING id, url, title, tags, memo, created_at, updated_at"
    )
      .bind(url, title, tags, memo, now, id)
      .first<BookmarkRow>();

    if (!result) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    return c.json({ bookmark: toBookmark(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unique")) {
      return c.json({ error: "This URL is already bookmarked." }, 409);
    }

    return c.json({ error: "Failed to update bookmark." }, 500);
  }
});

app.delete("/api/bookmarks/:id", async (c) => {
  const id = parseBookmarkId(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Bookmark not found." }, 404);
  }

  const result = await c.env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Bookmark not found." }, 404);
  }

  return c.body(null, 204);
});

// Any non-API request falls through to the static React app. This is what makes
// the Worker serve both the backend API and frontend from the same deployment.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
