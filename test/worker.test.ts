import { describe, expect, it, vi } from "vitest";
import app from "../src/worker";

type MockStatement = {
  bind: ReturnType<typeof vi.fn>;
  all?: ReturnType<typeof vi.fn>;
  first?: ReturnType<typeof vi.fn>;
};

type BookmarksBody = {
  bookmarks: unknown[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

const makeEnv = (statements: MockStatement[]) => ({
  DB: {
    prepare: vi.fn(() => {
      const statement = statements.shift();
      if (!statement) {
        throw new Error("Unexpected SQL statement");
      }

      return statement;
    })
  },
  OGP_BUCKET: {},
  ASSETS: {
    fetch: vi.fn()
  }
});

describe("worker bookmarks API", () => {
  it("clamps an out-of-range page before selecting bookmarks", async () => {
    const selectStatement = {
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({
          results: [
            {
              id: 21,
              url: "https://example.com/",
              title: "Example",
              tags: "bookmark, social",
              memo: "Last page",
              created_at: "2026-05-16T00:00:00.000Z",
              updated_at: "2026-05-16T00:00:00.000Z"
            }
          ]
        }))
      }))
    };
    const env = makeEnv([
      {
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ total: 21 }))
        })),
      },
      selectStatement
    ]);

    const response = await app.fetch(new Request("https://example.com/api/bookmarks?page=99"), env);
    const body = await response.json() as BookmarksBody;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      page: 3,
      pageSize: 10,
      totalCount: 21,
      totalPages: 3
    });
    expect(selectStatement.bind).toHaveBeenCalledWith(10, 20);
  });

  it("uses OR search terms across bookmark fields", async () => {
    const countBind = vi.fn(() => ({
      first: vi.fn(async () => ({ total: 1 }))
    }));
    const selectBind = vi.fn(() => ({
      all: vi.fn(async () => ({
        results: [
          {
            id: 1,
            url: "https://example.com/",
            title: "Example",
            tags: "bookmark, social",
            memo: "Searchable note",
            created_at: "2026-05-16T00:00:00.000Z",
            updated_at: "2026-05-16T00:00:00.000Z"
          }
        ]
      }))
    }));
    const env = makeEnv([
      {
        bind: countBind
      },
      {
        bind: selectBind
      }
    ]);

    const response = await app.fetch(
      new Request("https://example.com/api/bookmarks?page=1&q=bookmark%20social"),
      env
    );
    const body = await response.json() as BookmarksBody;

    expect(response.status).toBe(200);
    expect(body.bookmarks).toHaveLength(1);
    expect(countBind).toHaveBeenCalledWith(
      "%bookmark%",
      "%bookmark%",
      "%bookmark%",
      "%bookmark%",
      "%social%",
      "%social%",
      "%social%",
      "%social%"
    );
    expect(selectBind).toHaveBeenCalledWith(
      "%bookmark%",
      "%bookmark%",
      "%bookmark%",
      "%bookmark%",
      "%social%",
      "%social%",
      "%social%",
      "%social%",
      10,
      0
    );
  });
});
