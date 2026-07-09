import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { BookmarkDatabase } from "./db";
import type { CreateBookmarkRequest, UpdateBookmarkRequest } from "../shared/bookmarks";
import type { CreateFolderRequest, UpdateFolderRequest } from "../shared/folders";
import { ogpFileContentType, storeOgpImage } from "./ogp";
import { fetchPageTitle, normalizeUrl } from "./title";

export type AppDependencies = {
  db: BookmarkDatabase;
  // Where storeOgpImage keeps downloaded images. Optional so existing callers
  // and tests keep working with the same default the server uses.
  ogpStorageDir?: string;
};

const DEFAULT_OGP_STORAGE_DIR = join(process.cwd(), "data", "ogp");

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

const parseId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// null means unfiled; "invalid" signals a malformed folderId in the payload.
const getFolderIdFromPayload = (payload: unknown): number | null | "invalid" => {
  const { folderId } = payload as CreateBookmarkRequest | UpdateBookmarkRequest;
  if (folderId === undefined || folderId === null) {
    return null;
  }

  return typeof folderId === "number" && Number.isInteger(folderId) && folderId > 0 ? folderId : "invalid";
};

const getFolderNameFromPayload = (payload: unknown) =>
  typeof payload === "object" && payload !== null
    ? cleanText((payload as CreateFolderRequest | UpdateFolderRequest).name)
    : "";

const escapeLikeTerm = (term: string) => term.replace(/[\\%_]/g, (character) => `\\${character}`);

const parseSearchTerms = (value: string | undefined) =>
  cleanText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

// "none" limits the list to unfiled bookmarks; null applies no folder filter.
type FolderFilter = number | "none" | null;

const parseFolderFilter = (value: string | undefined): FolderFilter => {
  if (value === undefined || value === "") {
    return null;
  }

  if (value === "none") {
    return "none";
  }

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const buildListFilter = (terms: string[], folder: FolderFilter) => {
  const conditions = terms.map(
    () => "(url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\')"
  );
  const bindings: Array<string | number> = terms.flatMap((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return [pattern, pattern, pattern, pattern];
  });

  if (folder === "none") {
    conditions.push("folder_id IS NULL");
  } else if (folder !== null) {
    conditions.push("folder_id = ?");
    bindings.push(folder);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    bindings
  };
};

const isUniqueError = (error: unknown) =>
  error instanceof Error && error.message.toLowerCase().includes("unique");

export const createApp = ({ db, ogpStorageDir = DEFAULT_OGP_STORAGE_DIR }: AppDependencies) => {
  const app = new Hono();

  app.get("/api/bookmarks", (c) => {
    const pageParam = Number(c.req.query("page") ?? "1");
    const requestedPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
    const searchTerms = parseSearchTerms(c.req.query("q"));
    const folderFilter = parseFolderFilter(c.req.query("folderId"));
    const listFilter = buildListFilter(searchTerms, folderFilter);

    return c.json(db.listBookmarks(listFilter, requestedPage, PAGE_SIZE));
  });

  app.post("/api/bookmarks", async (c) => {
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

    const folderId = getFolderIdFromPayload(payload);
    if (folderId === "invalid" || (folderId !== null && !db.folderExists(folderId))) {
      return c.json({ error: "Folder not found." }, 400);
    }

    const tags = cleanTags((payload as CreateBookmarkRequest).tags);
    const memo = cleanText((payload as CreateBookmarkRequest).memo);
    const title = (await fetchPageTitle(url)) ?? url;
    // storeOgpImage returns "" instead of throwing on any failure, so a broken
    // or slow external site never prevents the bookmark from being saved.
    const ogpImageUrl = await storeOgpImage(url, ogpStorageDir);

    try {
      const bookmark = db.createBookmark({ url, title, tags, memo, folderId, ogpImageUrl });
      return c.json({ bookmark }, 201);
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This URL is already bookmarked." }, 409);
      }

      return c.json({ error: "Failed to create bookmark." }, 500);
    }
  });

  app.put("/api/bookmarks/:id", async (c) => {
    const id = parseId(c.req.param("id"));
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

    const folderId = getFolderIdFromPayload(payload);
    if (folderId === "invalid" || (folderId !== null && !db.folderExists(folderId))) {
      return c.json({ error: "Folder not found." }, 400);
    }

    const tags = cleanTags((payload as UpdateBookmarkRequest).tags);
    const memo = cleanText((payload as UpdateBookmarkRequest).memo);
    const title = (await fetchPageTitle(url)) ?? url;
    // Same as creation: "" on failure keeps the update itself successful.
    const ogpImageUrl = await storeOgpImage(url, ogpStorageDir);

    try {
      const bookmark = db.updateBookmark(id, { url, title, tags, memo, folderId, ogpImageUrl });
      if (!bookmark) {
        return c.json({ error: "Bookmark not found." }, 404);
      }

      return c.json({ bookmark });
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This URL is already bookmarked." }, 409);
      }

      return c.json({ error: "Failed to update bookmark." }, 500);
    }
  });

  app.delete("/api/bookmarks/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    if (!db.deleteBookmark(id)) {
      return c.json({ error: "Bookmark not found." }, 404);
    }

    return c.body(null, 204);
  });

  app.get("/ogp/:name", async (c) => {
    const name = c.req.param("name");
    // The strict "<uuid>.<ext>" check also rejects path traversal like "../".
    const contentType = ogpFileContentType(name);
    if (!contentType) {
      return c.json({ error: "Image not found." }, 404);
    }

    try {
      const image = await readFile(join(ogpStorageDir, name));
      return c.body(new Uint8Array(image), 200, {
        "content-type": contentType,
        // Stored names are random UUIDs and the files never change, so
        // browsers can cache them aggressively.
        "cache-control": "public, max-age=86400, immutable"
      });
    } catch {
      return c.json({ error: "Image not found." }, 404);
    }
  });

  app.get("/api/folders", (c) => {
    return c.json({ folders: db.listFolders() });
  });

  app.post("/api/folders", async (c) => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const name = getFolderNameFromPayload(payload);
    if (!name) {
      return c.json({ error: "Folder name is required." }, 400);
    }

    try {
      const folder = db.createFolder(name);
      return c.json({ folder }, 201);
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This folder name is already used." }, 409);
      }

      return c.json({ error: "Failed to create folder." }, 500);
    }
  });

  app.put("/api/folders/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Folder not found." }, 404);
    }

    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const name = getFolderNameFromPayload(payload);
    if (!name) {
      return c.json({ error: "Folder name is required." }, 400);
    }

    try {
      const folder = db.renameFolder(id, name);
      if (!folder) {
        return c.json({ error: "Folder not found." }, 404);
      }

      return c.json({ folder });
    } catch (error) {
      if (isUniqueError(error)) {
        return c.json({ error: "This folder name is already used." }, 409);
      }

      return c.json({ error: "Failed to rename folder." }, 500);
    }
  });

  app.delete("/api/folders/:id", (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) {
      return c.json({ error: "Folder not found." }, 404);
    }

    if (!db.deleteFolder(id)) {
      return c.json({ error: "Folder not found." }, 404);
    }

    return c.body(null, 204);
  });

  return app;
};
