const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

// This is intentionally small. It covers common titles without adding a full
// HTML parser dependency to the demo app.
const decodeHtmlEntities = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");

export const normalizeUrl = (value: string) => {
  const input = value.trim();

  if (!input) {
    throw new Error("URL is required.");
  }

  const url = new URL(input);

  // Workers can fetch many URL schemes, but this app only stores web pages.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  // Fragments are page-local anchors. Removing them helps avoid duplicate rows
  // such as https://example.com/#top and https://example.com/#footer.
  url.hash = "";
  return url.toString();
};

export const extractTitle = (html: string) => {
  // For this demo, a simple regex is enough because we only need <title>.
  // A production crawler would usually use a real HTML parser.
  const match = html.match(TITLE_PATTERN);

  if (!match?.[1]) {
    return null;
  }

  const title = decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim());
  return title.length > 0 ? title : null;
};

export const fetchPageTitle = async (url: string, fetcher: typeof fetch = fetch) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    // The optional fetcher parameter makes this function easy to unit test.
    const response = await fetcher(url, {
      headers: {
        "user-agent": "bookmark-demo/0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    // Avoid reading large non-HTML files such as images, PDFs, or archives.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      return null;
    }

    const html = await response.text();
    return extractTitle(html);
  } catch {
    // Network failures should not stop bookmark creation. The caller can fall
    // back to using the URL as the title.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
