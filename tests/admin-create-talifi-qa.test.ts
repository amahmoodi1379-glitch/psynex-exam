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
      const keys = (limit ? filtered.slice(0, limit) : filtered).map(name => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

async function run() {
  const { signJWT } = await import("../src/lib/auth.ts");
  const { getQuestion } = await import("../src/lib/dataStore.ts");
  const { routeAdmin } = await import("../src/routes/admin.ts");
  const { routeStudent } = await import("../src/routes/student.ts");

  const env: any = { DATA: createMemoryKV(), JWT_SECRET: "meta-secret" };

  // Konkur question with metadata
  const konkurUrl = new URL("https://example.com/api/admin/create?type=konkur");
  const konkurForm = new URLSearchParams();
  konkurForm.set("majorId", "maj1");
  konkurForm.set("courseId", "course-konkur");
  konkurForm.set("stem", "konkur stem");
  konkurForm.set("optA", "A1");
  konkurForm.set("optB", "B1");
  konkurForm.set("optC", "C1");
  konkurForm.set("optD", "D1");
  konkurForm.set("correctLabel", "A");
  konkurForm.set("degreeId", "deg1");
  konkurForm.set("ministryId", "min1");
  konkurForm.set("examYearId", "exam1");
  const konkurReq = new Request(konkurUrl, { method: "POST", body: konkurForm });
  const konkurRes = await routeAdmin(konkurReq, konkurUrl, env);
  assert.ok(konkurRes instanceof Response);
  assert.equal(konkurRes.status, 200);
  const konkurBody: any = await konkurRes.json();
  assert.equal(konkurBody?.ok, true);
  const konkurId = konkurBody?.id;
  assert.ok(konkurId, "konkur id should be returned");

  const konkurStored = await getQuestion(env, "konkur", konkurId);
  assert.ok(konkurStored);
  assert.equal(konkurStored?.degreeId, "deg1");
  assert.equal(konkurStored?.ministryId, "min1");
  assert.equal(konkurStored?.examYearId, "exam1");

  // Talifi without Konkur-only metadata
  const talifiUrl = new URL("https://example.com/api/admin/create?type=talifi");
  const talifiForm = new URLSearchParams();
  talifiForm.set("majorId", "maj1");
  talifiForm.set("courseId", "course-talifi");
  talifiForm.set("stem", "talifi stem");
  talifiForm.set("optA", "TA");
  talifiForm.set("optB", "TB");
  talifiForm.set("optC", "TC");
  talifiForm.set("optD", "TD");
  talifiForm.set("correctLabel", "B");
  const talifiReq = new Request(talifiUrl, { method: "POST", body: talifiForm });
  const talifiRes = await routeAdmin(talifiReq, talifiUrl, env);
  assert.ok(talifiRes instanceof Response);
  assert.equal(talifiRes.status, 200);
  const talifiBody: any = await talifiRes.json();
  assert.equal(talifiBody?.ok, true);
  const talifiId = talifiBody?.id;
  assert.ok(talifiId, "talifi id should be returned");

  const talifiStored = await getQuestion(env, "talifi", talifiId);
  assert.ok(talifiStored);
  assert.equal(talifiStored?.degreeId, undefined);
  assert.equal(talifiStored?.ministryId, undefined);
  assert.equal(talifiStored?.examYearId, undefined);

  // QA without Konkur-only metadata
  const qaUrl = new URL("https://example.com/api/admin/create?type=qa");
  const qaForm = new URLSearchParams();
  qaForm.set("majorId", "maj1");
  qaForm.set("courseId", "course-qa");
  qaForm.set("stem", "qa stem");
  qaForm.set("expl", "qa explanation");
  const qaReq = new Request(qaUrl, { method: "POST", body: qaForm });
  const qaRes = await routeAdmin(qaReq, qaUrl, env);
  assert.ok(qaRes instanceof Response);
  assert.equal(qaRes.status, 200);
  const qaBody: any = await qaRes.json();
  assert.equal(qaBody?.ok, true);
  const qaId = qaBody?.id;
  assert.ok(qaId, "qa id should be returned");

  const qaStored = await getQuestion(env, "qa", qaId);
  assert.ok(qaStored);
  assert.equal(qaStored?.degreeId, undefined);
  assert.equal(qaStored?.ministryId, undefined);
  assert.equal(qaStored?.examYearId, undefined);

  const token = await signJWT({
    email: "student@example.com",
    role: "student",
    planTier: "level2",
    planExpiresAt: null,
  }, env.JWT_SECRET, 3600);

  async function callRandom(type: "konkur" | "talifi" | "qa", extra: Record<string, string> = {}) {
    const url = new URL("https://example.com/api/student/random");
    url.searchParams.set("type", type);
    url.searchParams.set("majorId", "maj1");
    for (const [key, value] of Object.entries(extra)) {
      url.searchParams.set(key, value);
    }
    const req = new Request(url, { headers: { Cookie: `sid=${token}` } });
    const res = await routeStudent(req, url, env);
    assert.ok(res instanceof Response);
    assert.equal(res.status, 200, `random fetch for ${type} should succeed`);
    const body: any = await res.json();
    assert.equal(body?.ok, true);
    return body;
  }

  await callRandom("talifi", { courseId: "course-talifi" });
  await callRandom("qa", { courseId: "course-qa" });
  await callRandom("konkur", {
    courseId: "course-konkur",
    degreeId: "deg1",
    ministryId: "min1",
    examYearId: "exam1",
  });

  console.log("talifi/qa creation works without konkur metadata");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

