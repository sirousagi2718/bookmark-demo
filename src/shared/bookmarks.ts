export type Bookmark = {
  id: number;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateBookmarkRequest = {
  url: string;
};

export type ApiError = {
  error: string;
};
