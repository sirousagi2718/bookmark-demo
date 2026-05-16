CREATE TABLE IF NOT EXISTS bookmarks (
  -- AUTOINCREMENT gives each bookmark a stable local identifier.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- UNIQUE prevents saving the same normalized URL more than once.
  url TEXT NOT NULL UNIQUE,
  -- The Worker fetches this from the page <title>; it falls back to the URL.
  title TEXT NOT NULL,
  -- Store timestamps as ISO-like UTC text so they are easy to return as JSON.
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The list screen shows newest bookmarks first, so index that ordering.
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks (created_at DESC);
