import { fetchWithTimeout, readLimitedBody } from "./fetch";

export type OgpStorage = {
  put: (name: string, body: Uint8Array, contentType: string) => Promise<unknown>;
  get: (name: string) => Promise<{ body: Uint8Array; contentType: string; etag: string } | null>;
};

const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const extractOgImageUrl = (html: string, baseUrl: string): string | null => {
  const metaTags = html.match(/<meta\b[^>]*>/gi);
  if (!metaTags) {
    return null;
  }

  for (const tag of metaTags) {
    if (!/\b(?:property|name)\s*=\s*["']og:image(?::url)?["']/i.test(tag)) {
      continue;
    }

    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
    const rawUrl = contentMatch?.[1]?.trim();
    if (!rawUrl) {
      continue;
    }

    try {
      const resolved = new URL(rawUrl, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        continue;
      }

      return resolved.toString();
    } catch {
      continue;
    }
  }

  return null;
};

export const storeOgpImage = async (
  pageUrl: string,
  storage: OgpStorage,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  const pageResponse = await fetchWithTimeout(pageUrl, fetcher, "text/html");
  if (!pageResponse) {
    return "";
  }

  const contentType = pageResponse.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().includes("text/html")) {
    return "";
  }

  const html = await pageResponse.text();
  const imageUrl = extractOgImageUrl(html, pageUrl);
  if (!imageUrl) {
    return "";
  }

  const imageResponse = await fetchWithTimeout(imageUrl, fetcher, "image/*");
  if (!imageResponse) {
    return "";
  }

  const imageType = (imageResponse.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = ALLOWED_IMAGE_TYPES.get(imageType);
  if (!extension) {
    return "";
  }

  const body = await readLimitedBody(imageResponse, MAX_IMAGE_BYTES);
  if (!body) {
    return "";
  }

  const name = `${crypto.randomUUID()}.${extension}`;

  try {
    await storage.put(name, body, imageType);
  } catch {
    return "";
  }

  return `/ogp/${name}`;
};
