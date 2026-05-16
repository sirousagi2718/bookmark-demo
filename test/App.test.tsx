import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/App";
import type { Bookmark } from "../src/shared/bookmarks";

const mockFetch = vi.fn<typeof fetch>();

const makeBookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
  id: 1,
  url: "https://example.com/",
  title: "Example",
  tags: "docs, demo",
  memo: "Useful reference",
  createdAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  ...overrides
});

const bookmarksResponse = (
  bookmarks: Bookmark[],
  pagination: Partial<{ page: number; pageSize: number; totalCount: number; totalPages: number }> = {}
) =>
  Response.json({
    bookmarks,
    page: pagination.page ?? 1,
    pageSize: pagination.pageSize ?? 10,
    totalCount: pagination.totalCount ?? bookmarks.length,
    totalPages: pagination.totalPages ?? 1
  });

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("App", () => {
  it("loads and renders bookmarks with tags and memo", async () => {
    mockFetch.mockResolvedValueOnce(bookmarksResponse([makeBookmark()]));

    render(<App />);

    expect(await screen.findByRole("link", { name: "Example" })).toHaveAttribute(
      "href",
      "https://example.com/"
    );
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("Useful reference")).toBeInTheDocument();
  });

  it("adds a bookmark from the URL-only form and refreshes the first page", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([]))
      .mockResolvedValueOnce(Response.json({ bookmark: makeBookmark({ id: 2 }) }, { status: 201 }))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ id: 2 })]));

    render(<App />);

    await screen.findByText("No bookmarks yet.");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          url: "https://example.com"
        })
      });
    });

    expect(await screen.findByRole("link", { name: "Example" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1");
  });

  it("edits a bookmark and refreshes the current page", async () => {
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()]))
      .mockResolvedValueOnce(Response.json({ bookmark: makeBookmark({ tags: "updated" }) }))
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark({ tags: "updated" })]));

    render(<App />);

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Edit Example" }));
    const editTagsInput = screen.getByLabelText("Tags");
    await userEvent.clear(editTagsInput);
    await userEvent.type(editTagsInput, "updated");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks/1", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          url: "https://example.com/",
          tags: "updated",
          memo: "Useful reference"
        })
      });
    });

    expect(await screen.findByText("updated")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1");
  });

  it("confirms deletion before deleting and refreshing the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    mockFetch
      .mockResolvedValueOnce(bookmarksResponse([makeBookmark()]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(bookmarksResponse([]));

    render(<App />);

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Delete Example" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Example"?');
    await waitFor(() => {
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/bookmarks/1", {
        method: "DELETE"
      });
    });
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=1");
  });

  it("loads the next page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark()], { page: 1, totalCount: 11, totalPages: 2 })
      )
      .mockResolvedValueOnce(
        bookmarksResponse([makeBookmark({ id: 2, title: "Next page" })], {
          page: 2,
          totalCount: 11,
          totalPages: 2
        })
      );

    render(<App />);

    await screen.findByRole("link", { name: "Example" });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("link", { name: "Next page" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks?page=2");
  });
});
