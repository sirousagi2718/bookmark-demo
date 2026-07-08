export type Folder = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateFolderRequest = {
  name: string;
};

export type UpdateFolderRequest = {
  name: string;
};
