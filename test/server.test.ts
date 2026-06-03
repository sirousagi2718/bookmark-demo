import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { BookmarkDatabase } from "../src/server/db";
import { LocalOgpStorage } from "../src/server/storage";

let tempDir: string;
let db: BookmarkDatabase;
let storage: LocalOgpStorage;

const createTestApp = () => createApp({ db, ogpStorage: storage });

const addBookmark = (input: { url: string; title: string; tags?: string; memo?: string; ogpImageUrl?: string }) =>
  db.createBookmark({
    url: input.url,
    title: input.title,
    tags: input.tags ?? "",
    memo: input.memo ?? "",
    ogpImageUrl: input.ogpImageUrl ?? ""
  });

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bookmark-demo-"));
  db = new BookmarkDatabase(join(tempDir, "bookmarks.sqlite"));
  db.migrate(join(process.cwd(), "migrations"));
  storage = new LocalOgpStorage(join(tempDir, "ogp"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("local server bookmarks API", () => {
  it("clamps an out-of-range page before selecting bookmarks", async () => {
    for (let index = 1; index <= 21; index += 1) {
      addBookmark({
        url: `https://example.com/${index}`,
        title: `Example ${index}`
      });
    }

    const response = await createTestApp().request("http://localhost/api/bookmarks?page=99");
    const body = await response.json() as {
      bookmarks: Array<{ id: number }>;
      page: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
    };

    expect(response.status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.pageSize).toBe(10);
    expect(body.totalCount).toBe(21);
    expect(body.totalPages).toBe(3);
    expect(body.bookmarks).toHaveLength(1);
  });

  it("uses AND search terms across bookmark fields", async () => {
    addBookmark({
      url: "https://example.com/hono",
      title: "Hono",
      tags: "typescript, database",
      memo: "Framework"
    });
    addBookmark({
      url: "https://example.com/sqlite",
      title: "SQLite",
      tags: "database",
      memo: "Local data"
    });
    addBookmark({
      url: "https://example.com/react",
      title: "React",
      tags: "ui",
      memo: "Client"
    });

    const response = await createTestApp().request("http://localhost/api/bookmarks?q=hono%20database");
    const body = await response.json() as { bookmarks: Array<{ title: string }>; totalCount: number };

    expect(response.status).toBe(200);
    expect(body.totalCount).toBe(1);
    expect(body.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Hono"]);
  });

  it("creates a bookmark and rejects duplicate normalized URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<title>Example</title>", { headers: { "content-type": "text/html" } }))
    );

    const app = createTestApp();
    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/#top" })
    };
    const created = await app.request("http://localhost/api/bookmarks", request);
    const duplicate = await app.request("http://localhost/api/bookmarks", request);

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      bookmark: {
        url: "https://example.com/",
        title: "Example"
      }
    });
    expect(duplicate.status).toBe(409);
  });

  it("updates and deletes a bookmark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<title>Updated</title>", { headers: { "content-type": "text/html" } }))
    );
    const bookmark = addBookmark({
      url: "https://example.com/old",
      title: "Old"
    });
    const app = createTestApp();

    const updated = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/new",
        tags: " local, sqlite ",
        memo: " updated "
      })
    });
    const deleted = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "DELETE"
    });
    const missing = await app.request(`http://localhost/api/bookmarks/${bookmark.id}`, {
      method: "DELETE"
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      bookmark: {
        url: "https://example.com/new",
        title: "Updated",
        tags: "local, sqlite",
        memo: "updated"
      }
    });
    expect(deleted.status).toBe(204);
    expect(missing.status).toBe(404);
  });
});

describe("local OGP image route", () => {
  it("serves stored OGP images", async () => {
    await storage.put("cover.png", new Uint8Array([1, 2, 3]), "image/png");

    const response = await createTestApp().request("http://localhost/ogp/cover.png");
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    expect([...body]).toEqual([1, 2, 3]);
  });

  it("returns 404 for missing images and path traversal attempts", async () => {
    const missing = await createTestApp().request("http://localhost/ogp/missing.png");
    const traversalPath = join(tempDir, "outside.png");
    await writeFile(traversalPath, new Uint8Array([1, 2, 3]));
    const traversal = await createTestApp().request("http://localhost/ogp/..%2Foutside.png");

    expect(missing.status).toBe(404);
    expect(traversal.status).toBe(404);
  });
});
