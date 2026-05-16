import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/client/App";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("App", () => {
  it("loads and renders bookmarks", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        bookmarks: [
          {
            id: 1,
            url: "https://example.com/",
            title: "Example",
            createdAt: "2026-05-16T00:00:00.000Z",
            updatedAt: "2026-05-16T00:00:00.000Z"
          }
        ]
      })
    );

    render(<App />);

    expect(await screen.findByRole("link", { name: "Example" })).toHaveAttribute(
      "href",
      "https://example.com/"
    );
  });

  it("adds a bookmark from the form", async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ bookmarks: [] }))
      .mockResolvedValueOnce(
        Response.json(
          {
            bookmark: {
              id: 2,
              url: "https://example.com/",
              title: "Example",
              createdAt: "2026-05-16T00:00:00.000Z",
              updatedAt: "2026-05-16T00:00:00.000Z"
            }
          },
          { status: 201 }
        )
      );

    render(<App />);

    await screen.findByText("No bookmarks yet.");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith("/api/bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ url: "https://example.com" })
      });
    });

    expect(await screen.findByRole("link", { name: "Example" })).toBeInTheDocument();
  });
});
