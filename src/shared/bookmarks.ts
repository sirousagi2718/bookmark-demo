export type Bookmark = {
  id: number;
  url: string;
  title: string;
  tags: string;
  memo: string;
  // Omitted or null means the bookmark is unfiled. The server always returns it.
  folderId?: number | null;
  // Path to the locally stored og:image ("/ogp/<name>"), or "" when there is none.
  ogpImageUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
  folderId?: number | null;
};

export type UpdateBookmarkRequest = {
  url: string;
  tags?: string;
  memo?: string;
  folderId?: number | null;
};

export type ApiError = {
  error: string;
};
