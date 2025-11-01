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
      const filtered = Array.from(store.keys())
        .filter(key => key.startsWith(prefix))
        .sort();
      const limit = typeof opts?.limit === "number" ? opts.limit : undefined;
      const keys = (limit ? filtered.slice(0, limit) : filtered).map(name => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

async function run() {
  const { createQuestion, getQuestion } = await import("../src/lib/dataStore.ts");
  const { routeAdmin } = await import("../src/routes/admin.ts");

  const env: any = { DATA: createMemoryKV() };

  const baseQuestion = {
    type: "konkur" as const,
    majorId: "maj1",
    courseId: "course1",
    stem: "initial stem",
    options: [
      { label: "1", text: "old A" },
      { label: "2", text: "old B" },
      { label: "3", text: "old C" },
      { label: "4", text: "old D" },
    ],
    correctLabel: "1" as const,
  };

  const id = await createQuestion(env, baseQuestion);

  const getUrl = new URL("https://example.com/api/admin/question");
  getUrl.searchParams.set("type", "konkur");
  getUrl.searchParams.set("id", id);
  const getRes = await routeAdmin(new Request(getUrl), getUrl, env);
  assert.ok(getRes instanceof Response);
  assert.equal(getRes.status, 200);
  const getBody: any = await getRes.json();
  assert.equal(getBody?.ok, true);
  assert.equal(getBody?.data?.id, id);

  const updateUrl = new URL("https://example.com/api/admin/question/update");
  updateUrl.searchParams.set("type", "konkur");
  updateUrl.searchParams.set("id", id);
  const form = new URLSearchParams();
  form.set("majorId", "maj2");
  form.set("courseId", "course2");
  form.set("stem", "updated stem");
  form.set("optA", "new A");
  form.set("optB", "new B");
  form.set("optC", "new C");
  form.set("optD", "new D");
  form.set("correctLabel", "2");
  form.set("expl", "new explanation");

  const updateReq = new Request(updateUrl, { method: "POST", body: form });
  const updateRes = await routeAdmin(updateReq, updateUrl, env);
  assert.ok(updateRes instanceof Response);
  assert.equal(updateRes.status, 200);
  const updateBody: any = await updateRes.json();
  assert.equal(updateBody?.ok, true);
  assert.equal(updateBody?.data?.stem, "updated stem");
  assert.equal(updateBody?.data?.correctLabel, "2");
  assert.equal(updateBody?.data?.majorId, "maj2");

  const stored = await getQuestion(env, "konkur", id);
  assert.ok(stored);
  assert.equal(stored?.stem, "updated stem");
  assert.equal(stored?.correctLabel, "2");
  assert.equal(stored?.options?.[0]?.text, "new A");
  assert.equal(stored?.expl, "new explanation");

  const missingUrl = new URL("https://example.com/api/admin/question/update");
  missingUrl.searchParams.set("type", "konkur");
  const missingRes = await routeAdmin(new Request(missingUrl, { method: "POST", body: new URLSearchParams() }), missingUrl, env);
  assert.ok(missingRes instanceof Response);
  assert.equal(missingRes.status, 400);

  const missingGetUrl = new URL("https://example.com/api/admin/question");
  missingGetUrl.searchParams.set("type", "konkur");
  missingGetUrl.searchParams.set("id", "missing-id");
  const missingGetRes = await routeAdmin(new Request(missingGetUrl), missingGetUrl, env);
  assert.ok(missingGetRes instanceof Response);
  assert.equal(missingGetRes.status, 404);

  console.log("admin question update flow works");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
