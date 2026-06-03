import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);

const parseIPv4 = (value: string) => {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts;
};

const isBlockedIPv4 = (value: string) => {
  const parts = parseIPv4(value);
  if (!parts) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isBlockedIPv6 = (value: string) => {
  const normalized = value.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
};

const isBlockedAddress = (address: string) => {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    return isBlockedIPv4(address);
  }

  if (ipVersion === 6) {
    return isBlockedIPv6(address);
  }

  return true;
};

export const validatePublicHttpUrl = async (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http and https URLs are supported.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Private hostnames are not supported.");
  }

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error("Private IP addresses are not supported.");
    }
    return;
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Private resolved addresses are not supported.");
  }
};

export const fetchWithTimeout = async (
  url: string,
  fetcher: typeof fetch,
  accept: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = url;

  try {
    for (let redirectCount = 0; redirectCount <= DEFAULT_MAX_REDIRECTS; redirectCount += 1) {
      await validatePublicHttpUrl(currentUrl);
      const response = await fetcher(currentUrl, {
        headers: {
          "user-agent": "bookmark-demo/0.1",
          accept
        },
        redirect: "manual",
        signal: controller.signal
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === DEFAULT_MAX_REDIRECTS) {
          return null;
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      await validatePublicHttpUrl(response.url || currentUrl);
      return response.ok ? response : null;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const readLimitedBody = async (response: Response, maxBytes: number): Promise<Uint8Array | null> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return null;
    }
  }

  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
};
