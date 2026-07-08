CREATE TABLE IF NOT EXISTS folders (
  -- AUTOINCREMENT gives each folder a stable local identifier.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- UNIQUE prevents creating two folders with the same name.
  name TEXT NOT NULL UNIQUE,
  -- Store timestamps as ISO-like UTC text so they are easy to return as JSON.
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- NULL means the bookmark is unfiled. Deleting a folder keeps its bookmarks
-- and moves them back to unfiled via ON DELETE SET NULL.
ALTER TABLE bookmarks ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks (folder_id);
