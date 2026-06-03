import { describe, expect, it, vi } from "vitest";
import { extractOgImageUrl, storeOgpImage } from "../src/server/ogp";

describe("extractOgImageUrl", () => {
  it("extracts an absolute og:image URL", () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cover.png">';
    expect(extractOgImageUrl(html, "https://example.com/post")).toBe(
      "https://cdn.example.com/cover.png"
    );
  });

  it("resolves a relative og:image against the page URL", () => {
    const html = "<meta content='/images/hero.jpg' property='og:image' />";
    expect(extractOgImageUrl(html, "https://example.com/blog/post")).toBe(
      "https://example.com/images/hero.jpg"
    );
  });

  it("returns null when no og:image is present", () => {
    expect(extractOgImageUrl("<meta name='description' content='hi'>", "https://example.com")).toBeNull();
  });

  it("ignores non-http(s) og:image values", () => {
    const html = '<meta property="og:image" content="data:image/png;base64,AAAA">';
    expect(extractOgImageUrl(html, "https://example.com")).toBeNull();
  });
});

const htmlResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

const imageResponse = (type: string, bytes = new Uint8Array([1, 2, 3, 4])) =>
  new Response(bytes, { headers: { "content-type": type } });

describe("storeOgpImage", () => {
  it("stores the OGP image locally and returns its served path", async () => {
    const put = vi.fn(async () => undefined);
    const storage = { put, get: vi.fn() };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://example.com/article") {
        return htmlResponse(
          '<meta property="og:image" content="https://cdn.example.com/cover.png">'
        );
      }
      if (url === "https://cdn.example.com/cover.png") {
        return imageResponse("image/png");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await storeOgpImage(
      "https://example.com/article",
      storage,
      fetcher as unknown as typeof fetch
    );

    expect(result).toMatch(/^\/ogp\/[0-9a-f-]+\.png$/);
    expect(put).toHaveBeenCalledTimes(1);
    const [name, body, contentType] = put.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      string
    ];
    expect(`/ogp/${name}`).toBe(result);
    expect(body.byteLength).toBe(4);
    expect(contentType).toBe("image/png");
  });

  it("returns an empty string when the page has no og:image", async () => {
    const put = vi.fn();
    const storage = { put, get: vi.fn() };
    const fetcher = vi.fn(async () => htmlResponse("<title>No OGP here</title>"));

    const result = await storeOgpImage(
      "https://example.com",
      storage,
      fetcher as unknown as typeof fetch
    );

    expect(result).toBe("");
    expect(put).not.toHaveBeenCalled();
  });

  it("skips images with a disallowed content type", async () => {
    const put = vi.fn();
    const storage = { put, get: vi.fn() };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/page")) {
        return htmlResponse('<meta property="og:image" content="https://x.test/a.svg">');
      }
      return imageResponse("image/svg+xml");
    });

    const result = await storeOgpImage(
      "https://example.com/page",
      storage,
      fetcher as unknown as typeof fetch
    );

    expect(result).toBe("");
    expect(put).not.toHaveBeenCalled();
  });

  it("returns an empty string when the page fetch fails", async () => {
    const put = vi.fn();
    const storage = { put, get: vi.fn() };
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await storeOgpImage(
      "https://example.com",
      storage,
      fetcher as unknown as typeof fetch
    );

    expect(result).toBe("");
    expect(put).not.toHaveBeenCalled();
  });
});
