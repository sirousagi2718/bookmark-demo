import { FormEvent, useEffect, useState } from "react";
import type { ApiError, Bookmark } from "../shared/bookmarks";

type BookmarksResponse = {
  bookmarks: Bookmark[];
};

type CreateBookmarkResponse = {
  bookmark: Bookmark;
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
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // This flag prevents React state updates after the component unmounts.
    // It is a common defensive pattern for async effects.
    let isMounted = true;

    const loadBookmarks = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Relative URLs call the same Worker that serves this React app.
        const response = await fetch("/api/bookmarks");
        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const data = (await response.json()) as BookmarksResponse;
        if (isMounted) {
          setBookmarks(data.bookmarks);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load bookmarks.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    // useEffect cannot be async directly, so we start the async function here.
    void loadBookmarks();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    // Keep the browser from doing a full page reload when the form submits.
    event.preventDefault();

    setIsSaving(true);
    setError(null);

    try {
      // The backend only needs the URL. It will fetch the page title itself.
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as CreateBookmarkResponse;
      // Put the new bookmark at the top to match the API's newest-first order.
      setBookmarks((current) => [data.bookmark, ...current]);
      setUrl("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save bookmark.");
    } finally {
      setIsSaving(false);
    }
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
            value={url}
            onChange={(event) => setUrl(event.target.value)}
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
        {isLoading ? <div className="status">Loading bookmarks...</div> : null}

        {!isLoading && bookmarks.length === 0 ? (
          <div className="empty-state">No bookmarks yet.</div>
        ) : null}

        {bookmarks.map((bookmark) => (
          <article className="bookmark-item" key={bookmark.id}>
            <a href={bookmark.url} target="_blank" rel="noreferrer">
              {bookmark.title}
            </a>
            <span>{bookmark.url}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
