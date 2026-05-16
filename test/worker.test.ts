import { describe, expect, it, vi } from "vitest";
import worker, { resetDemoData } from "../src/worker";

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

    const response = await worker.fetch(
      new Request("https://example.com/api/bookmarks?page=99"),
      env as unknown as Parameters<typeof worker.fetch>[1]
    );
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

    const response = await worker.fetch(
      new Request("https://example.com/api/bookmarks?page=1&q=bookmark%20social"),
      env as unknown as Parameters<typeof worker.fetch>[1]
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

  it("clears R2 and seeds D1 during the scheduled reset", async () => {
    const deleteObjects = vi.fn();
    const batch = vi.fn();
    const bind = vi.fn(() => ({}));
    const prepare = vi.fn(() => ({ bind }));
    const env = {
      DB: {
        prepare,
        batch
      },
      OGP_BUCKET: {
        list: vi
          .fn()
          .mockResolvedValueOnce({
            objects: [{ key: "ogp/one.png" }, { key: "ogp/two.png" }],
            truncated: true,
            cursor: "next-page"
          })
          .mockResolvedValueOnce({
            objects: [{ key: "ogp/three.png" }],
            truncated: false
          }),
        delete: deleteObjects
      },
      ASSETS: {
        fetch: vi.fn()
      }
    };

    await resetDemoData(env as unknown as Parameters<typeof resetDemoData>[0]);

    expect(env.OGP_BUCKET.list).toHaveBeenNthCalledWith(1, { cursor: undefined });
    expect(env.OGP_BUCKET.list).toHaveBeenNthCalledWith(2, { cursor: "next-page" });
    expect(deleteObjects).toHaveBeenNthCalledWith(1, ["ogp/one.png", "ogp/two.png"]);
    expect(deleteObjects).toHaveBeenNthCalledWith(2, ["ogp/three.png"]);
    expect(prepare).toHaveBeenCalledTimes(17);
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
  });

  it("only runs the scheduled reset when DEMO is true", async () => {
    const bind = vi.fn(() => ({}));
    const env = {
      DB: {
        prepare: vi.fn(() => ({ bind })),
        batch: vi.fn()
      },
      OGP_BUCKET: {
        list: vi.fn(),
        delete: vi.fn()
      },
      ASSETS: {
        fetch: vi.fn()
      }
    };

    await worker.scheduled?.(
      {} as ScheduledController,
      env as unknown as Parameters<NonNullable<typeof worker.scheduled>>[1]
    );

    expect(env.OGP_BUCKET.list).not.toHaveBeenCalled();
    expect(env.DB.batch).not.toHaveBeenCalled();

    env.OGP_BUCKET.list.mockResolvedValueOnce({ objects: [], truncated: false });

    await worker.scheduled?.(
      {} as ScheduledController,
      { ...env, DEMO: "true" } as unknown as Parameters<NonNullable<typeof worker.scheduled>>[1]
    );

    expect(env.OGP_BUCKET.list).toHaveBeenCalledWith({ cursor: undefined });
    expect(env.DB.batch).toHaveBeenCalled();
  });
});
