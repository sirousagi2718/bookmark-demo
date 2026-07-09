import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Creates the directory on demand so callers do not need to prepare it, the
// same way BookmarkDatabase creates the folder for its SQLite file.
export const saveFile = async (storageDir: string, fileName: string, data: Uint8Array) => {
  await mkdir(storageDir, { recursive: true });
  const filePath = join(storageDir, fileName);
  await writeFile(filePath, data);
  return filePath;
};
