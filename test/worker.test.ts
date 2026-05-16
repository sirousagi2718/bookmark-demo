import { describe, expect, it, vi } from "vitest";
import app from "../src/worker";

type MockStatement = {
  bind: ReturnType<typeof vi.fn>;
  all?: ReturnType<typeof vi.fn>;
  first?: ReturnType<typeof vi.fn>;
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
        bind: vi.fn(),
        first: vi.fn(async () => ({ total: 21 }))
      },
      selectStatement
    ]);

    const response = await app.fetch(new Request("https://example.com/api/bookmarks?page=99"), env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      page: 3,
      pageSize: 10,
      totalCount: 21,
      totalPages: 3
    });
    expect(selectStatement.bind).toHaveBeenCalledWith(10, 20);
  });
});
