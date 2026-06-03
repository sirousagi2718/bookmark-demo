import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const IMAGE_TYPES_BY_EXTENSION = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"]
]);

export type StoredImage = {
  body: Uint8Array;
  contentType: string;
  etag: string;
};

export class LocalOgpStorage {
  constructor(private readonly rootDir: string) {}

  async put(name: string, body: Uint8Array, contentType: string) {
    const path = this.resolveName(name);
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(path, body);

    return {
      name,
      contentType
    };
  }

  async get(name: string): Promise<StoredImage | null> {
    let path: string;
    try {
      path = this.resolveName(name);
    } catch {
      return null;
    }

    const contentType = IMAGE_TYPES_BY_EXTENSION.get(extname(name).toLowerCase());
    if (!contentType) {
      return null;
    }

    try {
      const body = await readFile(path);
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      return { body, contentType, etag };
    } catch {
      return null;
    }
  }

  private resolveName(name: string) {
    const normalized = normalize(name);
    if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalized.startsWith(sep)) {
      throw new Error("Invalid storage key.");
    }

    return join(this.rootDir, normalized);
  }
}
