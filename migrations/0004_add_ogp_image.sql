-- Stores the page's og:image URL so the client can show a preview image.
-- NOT NULL with an empty-string default is safe here: existing rows and the
-- seed data were saved without an og:image, so '' simply means "no image",
-- the same convention tags and memo already use.
ALTER TABLE bookmarks ADD COLUMN ogp_image_url TEXT NOT NULL DEFAULT '';
