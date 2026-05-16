export type Bookmark = {
  id: number;
  url: string;
  title: string;
  tags: string;
  memo: string;
  // Served path of the OGP thumbnail stored in R2 (e.g. "/ogp/<uuid>.png").
  // Empty string when the page had no og:image.
  ogpImageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
};

export type UpdateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
};

export type ApiError = {
  error: string;
};
