import { strict as assert } from "node:assert";

if (typeof btoa === "undefined") {
  // @ts-ignore
  globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  // @ts-ignore
  globalThis.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}

type MemoryEntry = { value: string; expiration?: number | null };

function createMemoryKV() {
  const store = new Map<string, MemoryEntry>();
  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiration && entry.expiration < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
      const expiration = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
      store.set(key, { value, expiration });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = opts?.prefix || "";
      const limit = typeof opts?.limit === "number" ? opts.limit : undefined;
      const filtered = Array.from(store.keys())
        .filter(key => key.startsWith(prefix))
        .sort();
      const startIndex = opts?.cursor ? Number(opts.cursor) : 0;
      const nextKeys = limit ? filtered.slice(startIndex, startIndex + limit) : filtered.slice(startIndex);
      const nextIndex = startIndex + nextKeys.length;
      const list_complete = !limit || nextIndex >= filtered.length;
      const cursor = list_complete ? undefined : String(nextIndex);
      const keys = nextKeys.map(name => ({ name }));
      return { keys, list_complete, cursor };
    },
  };
}

async function run() {
  const { createQuestion, DEFAULT_MIN_SCAN_SIZE } = await import("../src/lib/dataStore.ts");
  const { routeAdmin } = await import("../src/routes/admin.ts");

  const env: any = { DATA: createMemoryKV() };

  const restoreNow = Date.now;
  let tick = 0;
  Date.now = () => 1_000_000 + ++tick * 1000;

  try {
    const shared = {
      type: "konkur" as const,
      options: [
        { label: "1", text: "opt1" },
        { label: "2", text: "opt2" },
        { label: "3", text: "opt3" },
        { label: "4", text: "opt4" },
      ],
      correctLabel: "1" as const,
    };

    const q1 = await createQuestion(env, {
      ...shared,
      majorId: "maj1",
      courseId: "course-a",
      stem: "first question stem",
      sourceId: "source-a",
      chapterId: "chapter-a",
    });
    const q2 = await createQuestion(env, {
      ...shared,
      majorId: "maj1",
      courseId: "course-b",
      stem: "second question stem",
      sourceId: "source-b",
      chapterId: "chapter-b",
    });
    const q3 = await createQuestion(env, {
      ...shared,
      majorId: "maj2",
      courseId: "course-c",
      stem: "third question stem",
      sourceId: "source-c",
      chapterId: "chapter-c",
    });

    async function call(params: Record<string, string>) {
      const url = new URL("https://example.com/api/admin/questions");
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      const req = new Request(url);
      const res = await routeAdmin(req, url, env);
      assert.ok(res instanceof Response);
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body?.ok, true);
      return body;
    }

    const baseParams = { type: "konkur" };

    const page1 = await call({ ...baseParams, page: "1", pageSize: "2" });
    assert.equal(Array.isArray(page1.data), true);
    assert.equal(page1.data.length, 2);
    assert.equal(page1.data[0]?.id, q3);
    assert.equal(page1.data[1]?.id, q2);
    assert.equal(page1.meta?.total, 3);
    assert.equal(page1.meta?.page, 1);
    assert.equal(page1.meta?.pageSize, 2);
    assert.equal(page1.meta?.totalPages, 2);
    assert.equal(page1.meta?.hasMore, true);

    const page2 = await call({ ...baseParams, page: "2", pageSize: "2" });
    assert.equal(page2.data.length, 1);
    assert.equal(page2.data[0]?.id, q1);
    assert.equal(page2.meta?.page, 2);
    assert.equal(page2.meta?.hasMore, false);

    const onlyMajor = await call({ ...baseParams, majorId: "maj1" });
    assert.equal(onlyMajor.data.length, 2);
    assert.equal(onlyMajor.data[0]?.id, q2);
    assert.equal(onlyMajor.data[1]?.id, q1);
    assert.equal(onlyMajor.meta?.total, 2);

    const withCourse = await call({ ...baseParams, majorId: "maj1", courseId: "course-b" });
    assert.equal(withCourse.data.length, 1);
    assert.equal(withCourse.data[0]?.id, q2);

    const textQuery = await call({ ...baseParams, query: "second" });
    assert.equal(textQuery.data.length, 1);
    assert.equal(textQuery.data[0]?.id, q2);

    const ascOrder = await call({ ...baseParams, sort: "createdAt_asc", pageSize: "3" });
    assert.equal(ascOrder.data.length, 3);
    assert.equal(ascOrder.data[0]?.id, q1);
    assert.equal(ascOrder.data[2]?.id, q3);
    assert.equal(ascOrder.meta?.hasMore, false);

    const deepPage = await call({ ...baseParams, page: "5", pageSize: "1" });
    assert.equal(deepPage.data.length, 1);
    assert.equal(deepPage.data[0]?.id, q1);
    assert.equal(deepPage.meta?.page, 3);

    const missingId = await call({ ...baseParams, id: "not-found", page: "3", pageSize: "5" });
    assert.equal(Array.isArray(missingId.data), true);
    assert.equal(missingId.data.length, 0);
    assert.equal(missingId.meta?.total, 0);
    assert.equal(missingId.meta?.pageSize, 5);

    const fillerMajor = "maj-scan";
    const fillerCount = DEFAULT_MIN_SCAN_SIZE + 5;
    for (let i = 0; i < fillerCount; i++) {
      const id = `filler-${String(i).padStart(4, "0")}`;
      const createdAt = Date.now();
      await env.DATA.put(`q:konkur:${id}`, JSON.stringify({
        ...shared,
        id,
        type: "konkur",
        majorId: fillerMajor,
        courseId: "course-fill",
        sourceId: "source-fill",
        chapterId: "chapter-fill",
        stem: `filler question ${i}`,
        createdAt,
      }));
    }
    const targetId = `target-${String(fillerCount).padStart(4, "0")}`;
    const targetCreatedAt = Date.now();
    await env.DATA.put(`q:konkur:${targetId}`, JSON.stringify({
      ...shared,
      id: targetId,
      type: "konkur",
      majorId: "maj-scan-target",
      courseId: "course-target",
      sourceId: "source-target",
      chapterId: "chapter-target",
      stem: "needle question stem",
      createdAt: targetCreatedAt,
    }));

    const deepFiltered = await call({
      ...baseParams,
      page: "1",
      pageSize: "1",
      majorId: "maj-scan-target",
    });
    assert.equal(deepFiltered.data.length, 1);
    assert.equal(deepFiltered.data[0]?.id, targetId);
    assert.equal(deepFiltered.meta?.total, 1);
    assert.equal(deepFiltered.meta?.hasMore, false);

    const talifiUrl = new URL("https://example.com/api/admin/create?type=talifi");
    const talifiForm = new URLSearchParams();
    talifiForm.set("majorId", "talifi-major");
    talifiForm.set("courseId", "talifi-course");
    talifiForm.set("stem", "talifi question with metadata");
    talifiForm.set("opt1", "option a");
    talifiForm.set("opt2", "option b");
    talifiForm.set("opt3", "option c");
    talifiForm.set("opt4", "option d");
    talifiForm.set("correctLabel", "3");
    talifiForm.set("degreeId", "talifi-degree");
    const talifiReq = new Request(talifiUrl, { method: "POST", body: talifiForm });
    const talifiRes = await routeAdmin(talifiReq, talifiUrl, env);
    assert.ok(talifiRes instanceof Response);
    assert.equal(talifiRes.status, 200);
    const talifiBody: any = await talifiRes.json();
    assert.equal(talifiBody?.ok, true);
    const talifiId = talifiBody?.id;
    assert.ok(talifiId);

    const talifiFiltered = await call({ type: "talifi", degreeId: "talifi-degree" });
    assert.equal(talifiFiltered.data.length, 1);
    assert.equal(talifiFiltered.data[0]?.id, talifiId);

    console.log("admin manage list supports filters and pagination");
  } finally {
    Date.now = restoreNow;
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
