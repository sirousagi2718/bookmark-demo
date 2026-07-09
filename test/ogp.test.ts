import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractOgImageUrl, storeOgpImage } from "../src/server/ogp";

describe("extractOgImageUrl", () => {
  it("extracts an absolute og:image URL", () => {
    expect(
      extractOgImageUrl('<meta property="og:image" content="https://cdn.example.com/a.png">', "https://example.com/")
    ).toBe("https://cdn.example.com/a.png");
  });

  it("resolves relative URLs against the page URL", () => {
    expect(
      extractOgImageUrl('<meta property="og:image" content="/img/cover.png">', "https://example.com/post/1")
    ).toBe("https://example.com/img/cover.png");
  });

  it("returns null when no og:image exists", () => {
    expect(extractOgImageUrl("<html><title>No image</title></html>", "https://example.com/")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(
      extractOgImageUrl('<meta property="og:image" content="data:image/png;base64,AAAA">', "https://example.com/")
    ).toBeNull();
  });
});

describe("storeOgpImage", () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "bookmark-demo-ogp-"));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  const pageHtml = '<html><head><meta property="og:image" content="/cover.png"></head></html>';

  // Routes the page URL to HTML and the image URL to bytes, so no test ever
  // touches the network.
  const routedFetcher = (imageType: string) =>
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/cover.png")
        ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": imageType } })
        : new Response(pageHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
    );

  it("stores the image and returns its public path", async () => {
    const fetcher = routedFetcher("image/png");

    const stored = await storeOgpImage("https://example.com/post", storageDir, fetcher as typeof fetch);

    expect(stored).toMatch(/^\/ogp\/[0-9a-f-]{36}\.png$/);
    await expect(readdir(storageDir)).resolves.toHaveLength(1);
  });

  it("returns an empty string when the page has no og:image", async () => {
    const fetcher = vi.fn(async () => new Response("<html><title>No image</title></html>", {
      headers: { "content-type": "text/html" }
    }));

    await expect(storeOgpImage("https://example.com/post", storageDir, fetcher as typeof fetch)).resolves.toBe("");
    await expect(readdir(storageDir)).resolves.toHaveLength(0);
  });

  it("returns an empty string for disallowed image content types", async () => {
    const fetcher = routedFetcher("image/svg+xml");

    await expect(storeOgpImage("https://example.com/post", storageDir, fetcher as typeof fetch)).resolves.toBe("");
    await expect(readdir(storageDir)).resolves.toHaveLength(0);
  });

  it("returns an empty string when fetching the page fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network failed");
    });

    await expect(storeOgpImage("https://example.com/post", storageDir, fetcher as typeof fetch)).resolves.toBe("");
  });
});
