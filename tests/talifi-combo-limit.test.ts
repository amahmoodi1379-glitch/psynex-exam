import { strict as assert } from "node:assert";

if (typeof btoa === "undefined") {
  globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof atob === "undefined") {
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
  const { createQuestion, recordAnswer } = await import("../src/lib/dataStore.ts");
  const { routeStudent } = await import("../src/routes/student.ts");

  const memoryKV = createMemoryKV();
  const env: any = { JWT_SECRET: "combo-secret", DATA: memoryKV };

  const baseQuestion = {
    type: "talifi" as const,
    majorId: "maj1",
    courseId: "course1",
    options: [
      { label: "1", text: "opt1" },
      { label: "2", text: "opt2" },
      { label: "3", text: "opt3" },
      { label: "4", text: "opt4" },
    ],
    correctLabel: "1" as const,
    stem: "sample question",
  };

  const qid1 = await createQuestion(env, baseQuestion);
  const qid2 = await createQuestion(env, { ...baseQuestion, stem: "sample question 2" });

  const challengeClientId = "combo-client";
  const now = Date.now();
  await recordAnswer(env, {
    clientId: challengeClientId,
    qid: qid1,
    type: "talifi",
    choice: "2",
    correct: false,
    at: now - 2000,
    filters: { majorId: baseQuestion.majorId },
  });
  await recordAnswer(env, {
    clientId: challengeClientId,
    qid: qid2,
    type: "talifi",
    choice: "2",
    correct: false,
    at: now - 1000,
    filters: { majorId: baseQuestion.majorId },
  });

  const token = await signJWT({
    email: "level2@example.com",
    role: "student",
    planTier: "level2",
    planExpiresAt: null,
  }, env.JWT_SECRET, 3600);

  async function callRandom() {
    const url = new URL("https://example.com/api/student/random");
    url.searchParams.set("type", "talifi");
    url.searchParams.set("majorId", baseQuestion.majorId);
    const req = new Request(url, { headers: { Cookie: `sid=${token}` } });
    const res = await routeStudent(req, url, env);
    assert.ok(res instanceof Response, "random response should be a Response");
    return res;
  }

  async function callChallenge() {
    const url = new URL("https://example.com/api/student/challenge-next");
    url.searchParams.set("clientId", challengeClientId);
    url.searchParams.set("majorId", baseQuestion.majorId);
    url.searchParams.set("type", "talifi");
    const req = new Request(url, { headers: { Cookie: `sid=${token}` } });
    const res = await routeStudent(req, url, env);
    assert.ok(res instanceof Response, "challenge response should be a Response");
    return res;
  }

  for (let i = 0; i < 190; i++) {
    const res = await callRandom();
    assert.equal(res.status, 200, `random request ${i + 1} should succeed`);
  }

  for (let i = 0; i < 10; i++) {
    const res = await callChallenge();
    assert.equal(res.status, 200, `challenge request ${i + 1} should succeed`);
  }

  const quotaCheckRes = await callRandom();
  assert.equal(quotaCheckRes.status, 429, "201st combined talifi request should hit quota");
  const quotaBody: any = await quotaCheckRes.json();
  assert.equal(quotaBody?.error, "quota_exceeded");
  assert.equal(quotaBody?.quota?.action, "combo:talifi_challenge");

  console.log("talifi combo usage cap enforced at 200 requests");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
