import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ApiError, Bookmark } from "../shared/bookmarks";
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

type FormState = {
  url: string;
  tags: string;
  memo: string;
};

const emptyForm: FormState = {
  url: "",
  tags: "",
  memo: ""
};

const splitTags = (tags: string) =>
  tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

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
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBookmarks = useCallback(async (targetPage = page) => {
    setIsLoading(true);
    setError(null);

    try {
      // Relative URLs call the same Worker that serves this React app.
      const response = await fetch(`/api/bookmarks?page=${targetPage}`);
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
  }, [page]);

  useEffect(() => {
    // useEffect cannot be async directly, so we start the async function here.
    void loadBookmarks(1);
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
      // Creation starts with only a URL. Tags and memo are added later from Edit.
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url: form.url })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      await response.json() as CreateBookmarkResponse;
      setForm(emptyForm);
      setEditingId(null);
      await loadBookmarks(1);
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
      memo: bookmark.memo
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
        body: JSON.stringify(editForm)
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setEditingId(null);
      setEditForm(emptyForm);
      await loadBookmarks(page);
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
      await loadBookmarks(targetPage);
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
    await loadBookmarks(targetPage);
  };

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

      <section className="bookmark-list" aria-label="Bookmarks">
        <div className="list-summary">
          <span>{totalCount} bookmarks</span>
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
                <div className="bookmark-content">
                  <a href={bookmark.url} target="_blank" rel="noreferrer">
                    {bookmark.title}
                  </a>
                  <span className="bookmark-url">{bookmark.url}</span>
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
