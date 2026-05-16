// Open Graph images are advertised with a <meta property="og:image"> tag. This
// module fetches that image (when present) and stores it in R2 so the list
// screen can show a thumbnail from our own origin instead of hot-linking.

// R2 keys live under this prefix. The scheduled demo reset deletes every object
// in the bucket, so thumbnails are cleaned up automatically with the rest.
const OGP_KEY_PREFIX = "ogp";

// Only store real raster images. Anything else (HTML error pages, SVG with
// scripts, oversized files) is skipped so the bucket stays predictable.
const ALLOWED_IMAGE_TYPES = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"]
]);

// A generous cap for a demo. og:image files are usually well under this.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 5000;

export const extractOgImageUrl = (html: string, baseUrl: string): string | null => {
  // A small regex scan is enough for the demo. We look at every <meta> tag and
  // keep the first one that declares og:image, regardless of attribute order.
  const metaTags = html.match(/<meta\b[^>]*>/gi);
  if (!metaTags) {
    return null;
  }

  for (const tag of metaTags) {
    // Open Graph uses property=, but some sites mistakenly use name=. Accept
    // both so more pages get a thumbnail.
    if (!/\b(?:property|name)\s*=\s*["']og:image(?::url)?["']/i.test(tag)) {
      continue;
    }

    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
    const rawUrl = contentMatch?.[1]?.trim();
    if (!rawUrl) {
      continue;
    }

    try {
      // og:image can be relative. Resolve it against the page URL so it works
      // no matter how the site wrote it.
      const resolved = new URL(rawUrl, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        return null;
      }

      return resolved.toString();
    } catch {
      return null;
    }
  }

  return null;
};

const fetchWithTimeout = async (
  url: string,
  fetcher: typeof fetch,
  accept: string
): Promise<Response | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      headers: {
        "user-agent": "bookmark-demo/0.1",
        accept
      },
      signal: controller.signal
    });

    return response.ok ? response : null;
  } catch {
    // A failed OGP lookup must never block saving the bookmark itself.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const storeOgpImage = async (
  pageUrl: string,
  bucket: R2Bucket,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  // Returning "" everywhere means "no thumbnail" so the caller never has to
  // special-case OGP failures.
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

  const body = await imageResponse.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
    return "";
  }

  // crypto.randomUUID() avoids collisions and hides the source URL from the
  // public R2 path.
  const key = `${OGP_KEY_PREFIX}/${crypto.randomUUID()}.${extension}`;

  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType: imageType }
    });
  } catch {
    return "";
  }

  // The Worker serves this path from R2; see the GET /ogp/:name route.
  return `/${key}`;
};
