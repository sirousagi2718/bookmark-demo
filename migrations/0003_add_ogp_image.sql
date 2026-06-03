-- Store the served path of the OGP image saved locally (for example
-- "/ogp/<uuid>.png"). Empty string means the page had no og:image or the
-- image could not be fetched, so the list screen simply shows no thumbnail.
ALTER TABLE bookmarks ADD COLUMN ogp_image_url TEXT NOT NULL DEFAULT '';
