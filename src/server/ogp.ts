import { randomUUID } from "node:crypto";
import { fetchWithTimeout, readLimitedBody } from "./fetch";
import { saveFile } from "./storage";

const OGP_TIMEOUT_MS = 5000;
const MAX_OGP_HTML_BYTES = 1024 * 1024;
const MAX_OGP_IMAGE_BYTES = 5 * 1024 * 1024;

// Only raster formats that browsers render in <img> and that carry no active
// content. Accepting whatever the server claims would let us store and serve
// arbitrary files — most notably SVG, which can embed scripts — under our own
// origin, so anything outside this list is rejected.
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif"
};

const META_TAG_PATTERN = /<meta\b[^>]*>/gi;

const readAttribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
};

// og:image URLs often contain query strings, and HTML escapes "&" as "&amp;".
const decodeHtmlEntities = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");

export const extractOgImageUrl = (html: string, baseUrl: string) => {
  for (const [tag] of html.matchAll(META_TAG_PATTERN)) {
    const key = (readAttribute(tag, "property") ?? readAttribute(tag, "name"))?.toLowerCase();
    if (key !== "og:image" && key !== "og:image:url") {
      continue;
    }

    const content = readAttribute(tag, "content");
    if (!content) {
      continue;
    }

    try {
      // Relative URLs are resolved against the page so "/img/cover.png" works.
      const url = new URL(decodeHtmlEntities(content.trim()), baseUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  return null;
};

// Returns "" instead of throwing on any failure: the OGP image is a
// nice-to-have decoration, and a broken or slow external site must never stop
// the bookmark itself from being saved. "" is also what the ogp_image_url
// column stores for "no image".
export const storeOgpImage = async (
  pageUrl: string,
  storageDir: string,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  try {
    const pageResponse = await fetchWithTimeout(pageUrl, fetcher, "text/html", OGP_TIMEOUT_MS);
    if (!pageResponse) {
      return "";
    }

    const pageType = (pageResponse.headers.get("content-type") ?? "").toLowerCase();
    if (!pageType.includes("text/html")) {
      return "";
    }

    const html = await readLimitedBody(pageResponse, MAX_OGP_HTML_BYTES);
    if (!html) {
      return "";
    }

    const imageUrl = extractOgImageUrl(new TextDecoder().decode(html), pageResponse.url || pageUrl);
    if (!imageUrl) {
      return "";
    }

    const imageResponse = await fetchWithTimeout(imageUrl, fetcher, "image/*", OGP_TIMEOUT_MS);
    if (!imageResponse) {
      return "";
    }

    const imageType = (imageResponse.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
    const extension = IMAGE_EXTENSIONS[imageType];
    if (!extension) {
      return "";
    }

    // readLimitedBody returns null for empty bodies and for anything over the
    // limit, which covers the "0 bytes or larger than 5MB" rule.
    const image = await readLimitedBody(imageResponse, MAX_OGP_IMAGE_BYTES);
    if (!image) {
      return "";
    }

    // A random UUID avoids collisions and never leaks the source file name.
    const fileName = `${randomUUID()}.${extension}`;
    await saveFile(storageDir, fileName, image);
    return `/ogp/${fileName}`;
  } catch {
    return "";
  }
};
