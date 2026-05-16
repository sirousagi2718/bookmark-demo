import { Hono } from "hono";
import type { Bookmark, CreateBookmarkRequest, UpdateBookmarkRequest } from "../shared/bookmarks";
import seedBookmarks from "./seed-bookmarks.json";
import { storeOgpImage } from "./ogp";
import { fetchPageTitle, normalizeUrl } from "./title";

type Bindings = {
  // These names must match the bindings in wrangler.toml.
  DB: D1Database;
  // Stores OGP thumbnail images fetched when a bookmark is created or updated.
  OGP_BUCKET: R2Bucket;
  // ASSETS lets the Worker serve the built React app from dist/client.
  ASSETS: Fetcher;
  // Set DEMO=true to enable the hourly data reset for public demo deployments.
  DEMO?: string;
};

type BookmarkRow = {
  id: number;
  url: string;
  title: string;
  tags: string;
  memo: string;
  ogp_image_url: string;
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
  // Older rows (and the seed data) have no thumbnail; default to "".
  ogpImageUrl: row.ogp_image_url ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const app = new Hono<{ Bindings: Bindings }>();

// The product requirement is fixed at 10 bookmarks per page.
const PAGE_SIZE = 10;

// Keep empty or missing optional text fields as an empty string in D1. That makes
// the API response predictable for the React UI.
const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// Tags are entered as one comma-separated string. Store them in a normalized
// comma+space format so "bookmark,social" and "bookmark, social" display the same.
const cleanTags = (value: unknown) =>
  cleanText(value)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");

const getUrlFromPayload = (payload: unknown) => {
  // JSON can be null, an array, or a primitive value. Check the shape before
  // reading .url so invalid request bodies return 400 instead of crashing.
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
  // Route params are strings. Convert to a positive integer before using it in SQL.
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const escapeLikeTerm = (term: string) =>
  // In SQL LIKE, "%" and "_" are wildcards. Escape them so a search for "100%"
  // means the literal text "100%" instead of "100 plus anything".
  term.replace(/[\\%_]/g, (character) => `\\${character}`);

const parseSearchTerms = (value: string | undefined) =>
  cleanText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

const buildSearchFilter = (terms: string[]) => {
  if (terms.length === 0) {
    return {
      sql: "",
      bindings: [] as string[]
    };
  }

  // Each word becomes one OR group across the searchable fields. For example,
  // "cloudflare hono" matches rows containing either word in URL, title, tags,
  // or memo.
  const sql = terms
    .map(() => "(url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\')")
    .join(" OR ");
  const bindings = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern, pattern, pattern];
  });

  return {
    sql: `WHERE ${sql}`,
    bindings
  };
};

type SeedBookmark = {
  url: string;
  title: string;
  tags: string;
  memo: string;
};

const seedBookmarkRows = seedBookmarks satisfies SeedBookmark[];

export const deleteAllR2Objects = async (bucket: R2Bucket) => {
  let cursor: string | undefined;

  do {
    // R2 list() returns one page at a time. Keep asking for the next cursor until
    // every object has been seen.
    const page = await bucket.list({ cursor });
    const keys = page.objects.map((object) => object.key);

    if (keys.length > 0) {
      // delete() accepts an array, so one call can remove the whole listed page.
      await bucket.delete(keys);
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
};

export const resetBookmarks = async (db: D1Database) => {
  const now = new Date().toISOString();
  const statements = [
    // Start from a blank table so the demo always returns to the same state.
    db.prepare("DELETE FROM bookmarks"),
    // Reset the AUTOINCREMENT counter. This keeps demo IDs predictable after
    // each hourly reset.
    db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").bind("bookmarks"),
    ...seedBookmarkRows.map((bookmark) =>
      db
        .prepare(
          "INSERT INTO bookmarks (url, title, tags, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(bookmark.url, bookmark.title, cleanTags(bookmark.tags), cleanText(bookmark.memo), now, now)
    )
  ];

  // batch() sends the reset statements together. For a tiny demo seed set this
  // is simpler than managing a transaction by hand.
  await db.batch(statements);
};

export const resetDemoData = async (env: Bindings) => {
  await deleteAllR2Objects(env.OGP_BUCKET);
  await resetBookmarks(env.DB);
};

app.get("/api/bookmarks", async (c) => {
  const pageParam = Number(c.req.query("page") ?? "1");
  const requestedPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const searchTerms = parseSearchTerms(c.req.query("q"));
  const searchFilter = buildSearchFilter(searchTerms);

  // Count first so we know the real last page. Without this, asking for a page
  // past the end would calculate an offset that returns an empty list.
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM bookmarks ${searchFilter.sql}`)
    .bind(...searchFilter.bindings)
    .first<{ total: number }>();
  const totalCount = count?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  // LIMIT controls how many rows are returned. OFFSET skips rows from earlier
  // pages, so page 2 starts after the first 10 bookmarks.
  const result = await c.env.DB.prepare(
    `SELECT id, url, title, tags, memo, ogp_image_url, created_at, updated_at FROM bookmarks ${searchFilter.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  )
    .bind(...searchFilter.bindings, PAGE_SIZE, offset)
    .all<BookmarkRow>();

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
  // Fetching the OGP image is best-effort: storeOgpImage returns "" when the
  // page has no og:image or the image cannot be fetched, so saving still works.
  const ogpImageUrl = await storeOgpImage(url, c.env.OGP_BUCKET);
  const now = new Date().toISOString();

  try {
    // RETURNING gives us the inserted row in one round trip, so the UI can update
    // immediately without making a second GET request.
    const result = await c.env.DB.prepare(
      "INSERT INTO bookmarks (url, title, tags, memo, ogp_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, url, title, tags, memo, ogp_image_url, created_at, updated_at"
    )
      .bind(url, title, tags, memo, ogpImageUrl, now, now)
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
  // Editing updates URL, tags, and memo together. The title is fetched again
  // because changing the URL may point to a different page.
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
  // The URL may now point to a different page, so refresh the thumbnail too.
  const ogpImageUrl = await storeOgpImage(url, c.env.OGP_BUCKET);
  const now = new Date().toISOString();

  try {
    const result = await c.env.DB.prepare(
      "UPDATE bookmarks SET url = ?, title = ?, tags = ?, memo = ?, ogp_image_url = ?, updated_at = ? WHERE id = ? RETURNING id, url, title, tags, memo, ogp_image_url, created_at, updated_at"
    )
      .bind(url, title, tags, memo, ogpImageUrl, now, id)
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
  // Deletion is intentionally simple: the browser confirms first, then the API
  // removes the row by id.
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

app.get("/ogp/:name", async (c) => {
  // The R2 bucket is private, so thumbnails are streamed back through the
  // Worker. Stored paths look like "/ogp/<uuid>.png"; the object key is the
  // same minus the leading slash.
  const name = c.req.param("name");
  const object = await c.env.OGP_BUCKET.get(`ogp/${name}`);

  if (!object) {
    return c.json({ error: "Image not found." }, 404);
  }

  const headers = new Headers();
  // writeHttpMetadata copies the stored content-type back onto the response.
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Thumbnails never change for a given key, so they are safe to cache hard.
  headers.set("cache-control", "public, max-age=86400, immutable");

  return new Response(object.body, { headers });
});

// Any non-API request falls through to the static React app. This is what makes
// the Worker serve both the backend API and frontend from the same deployment.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: (request: Request, env: Bindings, ctx?: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: async (_event, env) => {
    if (env.DEMO !== "true") {
      return;
    }

    // Wrangler runs this from the cron trigger in wrangler.toml. It keeps the
    // public demo clean by removing uploaded R2 objects and restoring D1 rows.
    await resetDemoData(env);
  }
} satisfies ExportedHandler<Bindings>;
