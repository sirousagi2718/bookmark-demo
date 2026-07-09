import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app";
import { BookmarkDatabase } from "../src/server/db";

let tempDir: string;
let db: BookmarkDatabase;

const createTestApp = () => createApp({ db });

const addBookmark = (input: {
  url: string;
  title: string;
  tags?: string;
  memo?: string;
  folderId?: number | null;
}) =>
  db.createBookmark({
    url: input.url,
    title: input.title,
    tags: input.tags ?? "",
    memo: input.memo ?? "",
    folderId: input.folderId ?? null
  });

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bookmark-demo-"));
  db = new BookmarkDatabase(join(tempDir, "bookmarks.sqlite"));
  db.migrate(join(process.cwd(), "migrations"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("local server bookmarks API", () => {
  it("returns 404 for the removed OGP image endpoint", async () => {
    const response = await createTestApp().request("http://localhost/api/ogp/some-name");

    expect(response.status).toBe(404);
  });

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

describe("local server folders API", () => {
  it("creates, lists, renames, and deletes folders", async () => {
    const app = createTestApp();
    const request = (name: string) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });

    const created = await app.request("http://localhost/api/folders", request(" Tech "));
    const createdBody = await created.json() as { folder: { id: number; name: string } };
    const duplicate = await app.request("http://localhost/api/folders", request("Tech"));
    const blank = await app.request("http://localhost/api/folders", request("   "));

    expect(created.status).toBe(201);
    expect(createdBody.folder.name).toBe("Tech");
    expect(duplicate.status).toBe(409);
    expect(blank.status).toBe(400);

    const listed = await app.request("http://localhost/api/folders");
    const listedBody = await listed.json() as { folders: Array<{ name: string }> };

    expect(listed.status).toBe(200);
    expect(listedBody.folders.map((folder) => folder.name)).toEqual(["Tech"]);

    const renamed = await app.request(`http://localhost/api/folders/${createdBody.folder.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Reading" })
    });

    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ folder: { name: "Reading" } });

    const deleted = await app.request(`http://localhost/api/folders/${createdBody.folder.id}`, {
      method: "DELETE"
    });
    const missing = await app.request(`http://localhost/api/folders/${createdBody.folder.id}`, {
      method: "DELETE"
    });

    expect(deleted.status).toBe(204);
    expect(missing.status).toBe(404);
  });

  it("assigns a folder to a bookmark on create and update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<title>Example</title>", { headers: { "content-type": "text/html" } }))
    );
    const folder = db.createFolder("Tech");
    const app = createTestApp();

    const created = await app.request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/filed", folderId: folder.id })
    });
    const createdBody = await created.json() as { bookmark: { id: number; folderId: number | null } };

    expect(created.status).toBe(201);
    expect(createdBody.bookmark.folderId).toBe(folder.id);

    const unknownFolder = await app.request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/other", folderId: 999 })
    });

    expect(unknownFolder.status).toBe(400);

    const updated = await app.request(`http://localhost/api/bookmarks/${createdBody.bookmark.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/filed", folderId: null })
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ bookmark: { folderId: null } });
  });

  it("filters bookmarks by folder", async () => {
    const folder = db.createFolder("Tech");
    addBookmark({ url: "https://example.com/filed", title: "Filed", folderId: folder.id });
    addBookmark({ url: "https://example.com/unfiled", title: "Unfiled" });
    const app = createTestApp();

    const filed = await app.request(`http://localhost/api/bookmarks?folderId=${folder.id}`);
    const filedBody = await filed.json() as { bookmarks: Array<{ title: string }>; totalCount: number };

    expect(filed.status).toBe(200);
    expect(filedBody.totalCount).toBe(1);
    expect(filedBody.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Filed"]);

    const unfiled = await app.request("http://localhost/api/bookmarks?folderId=none");
    const unfiledBody = await unfiled.json() as { bookmarks: Array<{ title: string }>; totalCount: number };

    expect(unfiledBody.totalCount).toBe(1);
    expect(unfiledBody.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Unfiled"]);

    const all = await app.request("http://localhost/api/bookmarks");
    const allBody = await all.json() as { totalCount: number };

    expect(allBody.totalCount).toBe(2);
  });

  it("keeps bookmarks when their folder is deleted", async () => {
    const folder = db.createFolder("Tech");
    const bookmark = addBookmark({ url: "https://example.com/kept", title: "Kept", folderId: folder.id });
    const app = createTestApp();

    const deleted = await app.request(`http://localhost/api/folders/${folder.id}`, { method: "DELETE" });
    const listed = await app.request("http://localhost/api/bookmarks");
    const listedBody = await listed.json() as { bookmarks: Array<{ id: number; folderId: number | null }> };

    expect(deleted.status).toBe(204);
    expect(listedBody.bookmarks).toHaveLength(1);
    expect(listedBody.bookmarks[0]).toMatchObject({ id: bookmark.id, folderId: null });
  });
});
