import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ApiError, Bookmark } from "../shared/bookmarks";
import type { Folder } from "../shared/folders";
import deleteIcon from "./assets/icons/delete.svg";
import editIcon from "./assets/icons/edit.svg";

type BookmarksResponse = {
  bookmarks: Bookmark[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

type CreateBookmarkResponse = {
  bookmark: Bookmark;
};

type FoldersResponse = {
  folders: Folder[];
};

type FormState = {
  url: string;
  tags: string;
  memo: string;
  // Select values are strings: "" means no folder, otherwise a folder id.
  folderId: string;
};

const emptyForm: FormState = {
  url: "",
  tags: "",
  memo: "",
  folderId: ""
};

// The folder filter mirrors the API's folderId parameter:
// "" shows every bookmark, "none" shows unfiled ones, an id shows one folder.
const isValidFolderFilter = (value: string) => value === "" || value === "none" || /^[1-9]\d*$/.test(value);

const toFolderIdPayload = (value: string) => (value === "" ? null : Number(value));

// Adding while a folder is open most likely means adding into that folder, so
// the create form's select follows the filter ("none" and "all" mean no folder).
const folderFilterToFormValue = (value: string) => (value && value !== "none" ? value : "");

const splitTags = (tags: string) =>
  tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const readUrlState = () => {
  const params = new URLSearchParams(window.location.search);
  const pageParam = Number(params.get("page") ?? "1");
  const folderParam = params.get("folderId") ?? "";

  return {
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
    query: params.get("q")?.trim() ?? "",
    folderId: isValidFolderFilter(folderParam) ? folderParam : ""
  };
};

const pushUrlState = (targetPage: number, targetQuery: string, targetFolder: string) => {
  const params = new URLSearchParams();
  const trimmedQuery = targetQuery.trim();

  if (targetPage > 1) {
    params.set("page", String(targetPage));
  }

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }

  if (targetFolder) {
    params.set("folderId", targetFolder);
  }

  // pushState updates the address bar and browser history without reloading the
  // React app. Beginners can think of it as "change the URL for this screen".
  const nextUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
  window.history.pushState({ page: targetPage, query: trimmedQuery, folderId: targetFolder }, "", nextUrl);
};

const readError = async (response: Response) => {
  try {
    // The API returns errors as JSON: { "error": "message" }.
    const body = (await response.json()) as ApiError;
    return body.error || "Request failed.";
  } catch {
    // If the server returns something unexpected, show a generic message instead
    // of breaking the UI with another exception.
    return "Request failed.";
  }
};

export function App() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManagingFolders, setIsManagingFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders");
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as FoldersResponse;
      setFolders(data.folders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load folders.");
    }
  }, []);

  const loadBookmarks = useCallback(
    async (targetPage = page, targetQuery = query, targetFolder = folderFilter) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ page: String(targetPage) });
        const trimmedQuery = targetQuery.trim();
        if (trimmedQuery) {
          // The API splits this value by spaces and OR-searches each word.
          params.set("q", trimmedQuery);
        }

        if (targetFolder) {
          // "none" asks the API for unfiled bookmarks, an id for one folder.
          params.set("folderId", targetFolder);
        }

        // Relative URLs call the same API origin in production.
        const response = await fetch(`/api/bookmarks?${params.toString()}`);
        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const data = (await response.json()) as BookmarksResponse;
        setBookmarks(data.bookmarks);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load bookmarks.");
      } finally {
        setIsLoading(false);
      }
    },
    [page, query, folderFilter]
  );

  useEffect(() => {
    const syncFromUrl = () => {
      const nextState = readUrlState();
      setSearchInput(nextState.query);
      setQuery(nextState.query);
      setFolderFilter(nextState.folderId);
      setForm((current) => ({ ...current, folderId: folderFilterToFormValue(nextState.folderId) }));
      // Back/forward navigation should show the same data as the URL.
      void loadBookmarks(nextState.page, nextState.query, nextState.folderId);
    };

    const initialState = readUrlState();
    setSearchInput(initialState.query);
    setQuery(initialState.query);
    setFolderFilter(initialState.folderId);
    setForm((current) => ({ ...current, folderId: folderFilterToFormValue(initialState.folderId) }));
    // useEffect cannot be async directly, so we start the async functions here.
    void loadFolders();
    void loadBookmarks(initialState.page, initialState.query, initialState.folderId);

    window.addEventListener("popstate", syncFromUrl);

    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  const updateForm = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateEditForm = (field: keyof FormState, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    // Keep the browser from doing a full page reload when the form submits.
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      // Creation starts with a URL and an optional folder. Tags and memo are
      // added later from Edit.
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url: form.url, folderId: toFolderIdPayload(form.folderId) })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      await response.json() as CreateBookmarkResponse;
      setForm((current) => ({ ...emptyForm, folderId: current.folderId }));
      setEditingId(null);
      pushUrlState(1, query, folderFilter);
      await loadBookmarks(1, query, folderFilter);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save bookmark.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditForm({
      url: bookmark.url,
      tags: bookmark.tags,
      memo: bookmark.memo,
      folderId: bookmark.folderId ? String(bookmark.folderId) : ""
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/bookmarks/${id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          url: editForm.url,
          tags: editForm.tags,
          memo: editForm.memo,
          folderId: toFolderIdPayload(editForm.folderId)
        })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setEditingId(null);
      setEditForm(emptyForm);
      await loadBookmarks(page, query, folderFilter);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update bookmark.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (bookmark: Bookmark) => {
    if (!window.confirm(`Delete "${bookmark.title}"?`)) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/bookmarks/${bookmark.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setEditingId(null);
      const targetPage = bookmarks.length === 1 && page > 1 ? page - 1 : page;
      pushUrlState(targetPage, query, folderFilter);
      await loadBookmarks(targetPage, query, folderFilter);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete bookmark.");
    } finally {
      setIsSaving(false);
    }
  };

  const goToPage = async (targetPage: number) => {
    if (targetPage < 1 || targetPage > totalPages || targetPage === page) {
      return;
    }

    setEditingId(null);
    pushUrlState(targetPage, query, folderFilter);
    await loadBookmarks(targetPage, query, folderFilter);
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextQuery = searchInput.trim();
    // Store the active query separately from what the user is typing. This keeps
    // pagination stable until the user submits the search form.
    setQuery(nextQuery);
    setEditingId(null);
    pushUrlState(1, nextQuery, folderFilter);
    await loadBookmarks(1, nextQuery, folderFilter);
  };

  const clearSearch = async () => {
    setSearchInput("");
    setQuery("");
    setEditingId(null);
    pushUrlState(1, "", folderFilter);
    await loadBookmarks(1, "", folderFilter);
  };

  const selectFolder = async (nextFolder: string) => {
    if (nextFolder === folderFilter) {
      return;
    }

    setFolderFilter(nextFolder);
    setEditingId(null);
    setForm((current) => ({ ...current, folderId: folderFilterToFormValue(nextFolder) }));
    pushUrlState(1, query, nextFolder);
    await loadBookmarks(1, query, nextFolder);
  };

  const handleCreateFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: newFolderName })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setNewFolderName("");
      await loadFolders();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create folder.");
    } finally {
      setIsSaving(false);
    }
  };

  const startRenamingFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setFolderNameDraft(folder.name);
  };

  const cancelRenamingFolder = () => {
    setEditingFolderId(null);
    setFolderNameDraft("");
  };

  const handleRenameFolder = async (event: FormEvent<HTMLFormElement>, id: number) => {
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/folders/${id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: folderNameDraft })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      cancelRenamingFolder();
      await loadFolders();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename folder.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Its bookmarks stay and become unfiled.`)) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/folders/${folder.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const folderValue = String(folder.id);
      // Forget the deleted folder everywhere it could still be selected.
      setForm((current) => (current.folderId === folderValue ? { ...current, folderId: "" } : current));
      setEditForm((current) => (current.folderId === folderValue ? { ...current, folderId: "" } : current));
      const nextFilter = folderFilter === folderValue ? "" : folderFilter;
      if (nextFilter !== folderFilter) {
        setFolderFilter(nextFilter);
        pushUrlState(1, query, nextFilter);
      }

      await loadFolders();
      await loadBookmarks(nextFilter === folderFilter ? page : 1, query, nextFilter);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete folder.");
    } finally {
      setIsSaving(false);
    }
  };

  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const activeFolderLabel =
    folderFilter === "none"
      ? " (unfiled)"
      : folderFilter
        ? ` in "${folderNameById.get(Number(folderFilter)) ?? "?"}"`
        : "";

  const folderChipClass = (value: string) =>
    folderFilter === value ? "folder-chip is-active" : "folder-chip";

  return (
    <main className="app-shell">
      <section className="toolbar" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Personal bookmarks</p>
          <h1 id="app-title">Bookmark Demo</h1>
        </div>
        <form className="bookmark-form" onSubmit={handleSubmit}>
          {/* The label is visually hidden but still available to screen readers. */}
          <label className="sr-only" htmlFor="bookmark-url">
            URL
          </label>
          <input
            id="bookmark-url"
            type="url"
            value={form.url}
            onChange={(event) => updateForm("url", event.target.value)}
            placeholder="https://example.com"
            required
          />
          <label className="sr-only" htmlFor="bookmark-folder">
            Folder
          </label>
          <select
            id="bookmark-folder"
            value={form.folderId}
            onChange={(event) => updateForm("folderId", event.target.value)}
          >
            <option value="">No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={String(folder.id)}>
                {folder.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving" : "Add"}
          </button>
        </form>
      </section>

      {error ? (
        <div className="status status-error" role="alert">
          {error}
        </div>
      ) : null}

      <form className="search-form" onSubmit={handleSearch}>
        <label className="sr-only" htmlFor="bookmark-search">
          Search bookmarks
        </label>
        <input
          id="bookmark-search"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search URL, title, tags, or memo"
        />
        <button type="submit" disabled={isLoading}>
          Search
        </button>
        {query ? (
          <button type="button" className="secondary-button" onClick={clearSearch}>
            Clear
          </button>
        ) : null}
      </form>

      <section className="folder-bar" aria-label="Folders">
        <div className="folder-chips">
          <button
            type="button"
            className={folderChipClass("")}
            aria-pressed={folderFilter === ""}
            onClick={() => void selectFolder("")}
          >
            All
          </button>
          <button
            type="button"
            className={folderChipClass("none")}
            aria-pressed={folderFilter === "none"}
            onClick={() => void selectFolder("none")}
          >
            Unfiled
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={folderChipClass(String(folder.id))}
              aria-pressed={folderFilter === String(folder.id)}
              onClick={() => void selectFolder(String(folder.id))}
            >
              {folder.name}
            </button>
          ))}
          <button
            type="button"
            className="folder-manage-toggle"
            aria-expanded={isManagingFolders}
            aria-controls="folder-manage-panel"
            onClick={() => setIsManagingFolders((current) => !current)}
          >
            {isManagingFolders ? "Done" : "Manage folders"}
          </button>
        </div>

        {isManagingFolders ? (
          <div className="folder-manage" id="folder-manage-panel">
            <form className="folder-create-form" onSubmit={handleCreateFolder}>
              <label className="sr-only" htmlFor="new-folder-name">
                New folder name
              </label>
              <input
                id="new-folder-name"
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="New folder name"
                required
              />
              <button type="submit" disabled={isSaving}>
                Add folder
              </button>
            </form>

            {folders.length === 0 ? (
              <p className="folder-manage-empty">No folders yet.</p>
            ) : (
              <ul className="folder-manage-list">
                {folders.map((folder) => (
                  <li key={folder.id}>
                    {editingFolderId === folder.id ? (
                      <form
                        className="folder-rename-form"
                        onSubmit={(event) => handleRenameFolder(event, folder.id)}
                      >
                        <label className="sr-only" htmlFor={`folder-name-${folder.id}`}>
                          Folder name
                        </label>
                        <input
                          id={`folder-name-${folder.id}`}
                          type="text"
                          value={folderNameDraft}
                          onChange={(event) => setFolderNameDraft(event.target.value)}
                          required
                        />
                        <button type="submit" disabled={isSaving}>
                          Save
                        </button>
                        <button type="button" className="secondary-button" onClick={cancelRenamingFolder}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="folder-manage-name">{folder.name}</span>
                        <div className="item-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => startRenamingFolder(folder)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void handleDeleteFolder(folder)}
                            disabled={isSaving}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      <section className="bookmark-list" aria-label="Bookmarks">
        <div className="list-summary">
          <span>
            {totalCount} bookmarks{query ? ` matching "${query}"` : ""}{activeFolderLabel}
          </span>
          <span>
            Page {page} of {totalPages}
          </span>
        </div>

        {isLoading ? <div className="status">Loading bookmarks...</div> : null}

        {!isLoading && bookmarks.length === 0 ? (
          <div className="empty-state">No bookmarks yet.</div>
        ) : null}

        {bookmarks.map((bookmark) => (
          <article className="bookmark-item" key={bookmark.id}>
            {editingId === bookmark.id ? (
              <form className="edit-form" onSubmit={(event) => handleUpdate(event, bookmark.id)}>
                <label>
                  URL
                  <input
                    type="url"
                    value={editForm.url}
                    onChange={(event) => updateEditForm("url", event.target.value)}
                    required
                  />
                </label>
                <label>
                  Folder
                  <select
                    value={editForm.folderId}
                    onChange={(event) => updateEditForm("folderId", event.target.value)}
                  >
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={String(folder.id)}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tags
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={(event) => updateEditForm("tags", event.target.value)}
                    placeholder="work, docs, ideas"
                  />
                </label>
                <label>
                  Memo
                  <textarea
                    value={editForm.memo}
                    onChange={(event) => updateEditForm("memo", event.target.value)}
                    placeholder="Notes"
                  />
                </label>
                <div className="item-actions">
                  <button type="submit" disabled={isSaving}>
                    Save
                  </button>
                  <button type="button" className="secondary-button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/* Decorative preview only, so it is hidden from screen readers. */}
                {bookmark.ogpImageUrl ? (
                  <img
                    className="bookmark-thumb"
                    src={bookmark.ogpImageUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                  />
                ) : null}
                <div className="bookmark-content">
                  <a href={bookmark.url} target="_blank" rel="noreferrer">
                    {bookmark.title}
                  </a>
                  <span className="bookmark-url">{bookmark.url}</span>
                  {bookmark.folderId && folderNameById.has(bookmark.folderId) ? (
                    <div className="bookmark-tags" aria-label="Folder">
                      <span className="bookmark-folder">{folderNameById.get(bookmark.folderId)}</span>
                    </div>
                  ) : null}
                  {bookmark.tags ? (
                    <div className="bookmark-tags" aria-label="Tags">
                      {splitTags(bookmark.tags).map((tag) => (
                        <span className="bookmark-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {bookmark.memo ? <p className="bookmark-memo">{bookmark.memo}</p> : null}
                </div>
                <div className="item-actions icon-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => startEditing(bookmark)}
                    aria-label={`Edit ${bookmark.title}`}
                    title="Edit"
                  >
                    <img src={editIcon} alt="" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-icon-button"
                    onClick={() => handleDelete(bookmark)}
                    disabled={isSaving}
                    aria-label={`Delete ${bookmark.title}`}
                    title="Delete"
                  >
                    <img src={deleteIcon} alt="" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>

      <nav className="pagination" aria-label="Pagination">
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1 || isLoading}>
          Previous
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages || isLoading}
        >
          Next
        </button>
      </nav>
    </main>
  );
}
