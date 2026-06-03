const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

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

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  url.hash = "";
  return url.toString();
};

export const extractTitle = (html: string) => {
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
    const response = await fetcher(url, {
      headers: {
        "user-agent": "bookmark-demo/0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      return null;
    }

    const html = await response.text();
    return extractTitle(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
