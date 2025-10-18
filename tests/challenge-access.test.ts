import { strict as assert } from "node:assert";

if (typeof btoa === "undefined") {
  globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  globalThis.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}

async function run() {
  const { signJWT } = await import("../src/lib/auth.ts");
  const { routeStudent } = await import("../src/routes/student.ts");

  const env = { JWT_SECRET: "test-secret", DATA: {} };

  const token = await signJWT({
    email: "level1@example.com",
    role: "student",
    planTier: "level1",
    planExpiresAt: null,
  }, env.JWT_SECRET, 60);

  const url = new URL("https://example.com/api/student/challenge-next?clientId=tester&majorId=maj1");
  const req = new Request(url, { headers: { Cookie: `sid=${token}` } });

  const res = await routeStudent(req, url, env);
  assert.ok(res instanceof Response);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body?.error, "feature_locked");

  console.log("level1 challenge access denied as expected");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
