import { strict as assert } from "node:assert";

if (typeof btoa === "undefined") {
  // @ts-ignore
  globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  // @ts-ignore
  globalThis.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}
if (typeof crypto === "undefined") {
  // @ts-ignore
  globalThis.crypto = require("node:crypto").webcrypto;
}

function createMockKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts: { prefix?: string; limit?: number }) {
      const prefix = opts.prefix || "";
      const limit = opts.limit ?? 1000;
      const keys = Array.from(store.keys())
        .filter(k => k.startsWith(prefix))
        .sort()
        .slice(0, limit)
        .map(name => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

async function resolveResponse(maybe: Response | Promise<Response> | null): Promise<Response> {
  assert.ok(maybe);
  return await maybe;
}

async function setupEnv(email: string, plan?: { tier?: "free" | "pro1" | "pro2" | "pro3"; expiresAt?: number | null }) {
  const { signJWT } = await import("../src/lib/auth.ts");
  const env: any = {
    JWT_SECRET: "test-secret",
    DATA: createMockKV(),
  };
  const token = await signJWT({
    email,
    role: "student",
    name: "Student",
    picture: "",
    planTier: plan?.tier ?? "free",
    planExpiresAt: plan?.expiresAt ?? null,
  }, env.JWT_SECRET, 3600);
  return { env, token };
}

async function seedTalifiQuestion(env: any, overrides: Partial<{ majorId: string; courseId: string }> = {}) {
  const { createQuestion } = await import("../src/lib/dataStore.ts");
  await createQuestion(env, {
    type: "talifi",
    majorId: overrides.majorId || "m1",
    courseId: overrides.courseId || "c1",
    stem: "نمونه سؤال",
    options: [
      { label: "A", text: "گزینه ۱" },
      { label: "B", text: "گزینه ۲" },
      { label: "C", text: "گزینه ۳" },
      { label: "D", text: "گزینه ۴" },
    ],
    correctLabel: "A",
  });
}

async function run() {
  const { routeStudent } = await import("../src/routes/student.ts");

  // --- talifi exam daily limit ---
  {
    const { env, token } = await setupEnv("exam-limit@example.com");
    await seedTalifiQuestion(env);

    async function startTalifi(count: number) {
      const req = new Request("https://example.com/api/student/exam/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `sid=${token}`,
        },
        body: JSON.stringify({
          clientId: "client-1",
          mode: "talifi",
          majorId: "m1",
          courseId: "c1",
          count,
          durationMin: 10,
        }),
      });
      return resolveResponse(routeStudent(req, new URL(req.url), env) as any);
    }

    const first = await startTalifi(10);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);

    const second = await startTalifi(10);
    assert.equal(second.status, 429);
    const secondBody = await second.json();
    assert.equal(secondBody.error, "usage_limit_reached");
    assert.equal(secondBody.field, "talifiExams");
  }

  // --- talifi question count enforcement for free plan ---
  {
    const { env, token } = await setupEnv("count-limit@example.com");
    await seedTalifiQuestion(env);

    const req = new Request("https://example.com/api/student/exam/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sid=${token}`,
      },
      body: JSON.stringify({
        clientId: "client-2",
        mode: "talifi",
        majorId: "m1",
        courseId: "c1",
        count: 30,
        durationMin: 10,
      }),
    });
    const res = await resolveResponse(routeStudent(req, new URL(req.url), env));
    assert.equal(res.status, 400);
    const response = await res.json();
    assert.equal(response.error, "talifi_question_limit");
  }

  // --- expired paid plan should fall back to free limits ---
  {
    const expired = Date.now() - 1000;
    const { env, token } = await setupEnv("expired-plan@example.com", { tier: "pro1", expiresAt: expired });
    await seedTalifiQuestion(env);

    const req = new Request("https://example.com/api/student/exam/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sid=${token}`,
      },
      body: JSON.stringify({
        clientId: "client-3",
        mode: "talifi",
        majorId: "m1",
        courseId: "c1",
        count: 25,
        durationMin: 10,
      }),
    });
    const res = await resolveResponse(routeStudent(req, new URL(req.url), env));
    assert.equal(res.status, 400);
    const response = await res.json();
    assert.equal(response.error, "talifi_question_limit");
  }

  // --- talifi random usage limit ---
  {
    const { env, token } = await setupEnv("random-limit@example.com");
    await seedTalifiQuestion(env, { majorId: "m2", courseId: "c2" });

    const url = new URL("https://example.com/api/student/random");
    url.searchParams.set("type", "talifi");
    url.searchParams.set("majorId", "m2");
    url.searchParams.set("courseId", "c2");

    async function fetchRandom() {
      const req = new Request(url.toString(), {
        method: "GET",
        headers: { Cookie: `sid=${token}` },
      });
      return resolveResponse(routeStudent(req, new URL(req.url), env) as any);
    }

    for (let i = 0; i < 5; i++) {
      const res = await fetchRandom();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
    }

    const blocked = await fetchRandom();
    assert.equal(blocked.status, 429);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error, "usage_limit_reached");
    assert.equal(blockedBody.field, "randomTalifi");
  }

  console.log("usage limits tests passed");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
