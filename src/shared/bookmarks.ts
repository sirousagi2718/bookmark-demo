export type Bookmark = {
  id: number;
  url: string;
  title: string;
  tags: string;
  memo: string;
  // Omitted or null means the bookmark is unfiled. The server always returns it.
  folderId?: number | null;
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
