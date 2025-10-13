import { strict as assert } from "node:assert";

if (typeof btoa === "undefined") {
  globalThis.btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  globalThis.atob = (data: string) => Buffer.from(data, "base64").toString("binary");
}

async function run() {
  const { hasRequiredRole, signJWT, requireRole } = await import("../src/lib/auth.ts");

  assert.equal(hasRequiredRole("student", "student"), true);
  assert.equal(hasRequiredRole("manager", "admin"), true);
  assert.equal(hasRequiredRole("admin", "manager"), false);

  const env = { JWT_SECRET: "test-secret" };

  const baseSession = {
    email: "user@example.com",
    planTier: "free" as const,
    planExpiresAt: null,
  };

  const adminToken = await signJWT({
    ...baseSession,
    email: "admin@example.com",
    role: "admin",
  }, env.JWT_SECRET, 60);

  const managerToken = await signJWT({
    ...baseSession,
    email: "manager@example.com",
    role: "manager",
  }, env.JWT_SECRET, 60);

  function requestFor(path: string, token: string) {
    return new Request(`https://example.com${path}`, {
      headers: { Cookie: `sid=${token}` },
    });
  }

  const adminAdminGuard = await requireRole(requestFor("/admin", adminToken), env, "admin");
  assert.ok(!(adminAdminGuard instanceof Response));
  assert.equal((adminAdminGuard as any).role, "admin");

  const managerAdminGuard = await requireRole(requestFor("/admin", managerToken), env, "admin");
  assert.ok(!(managerAdminGuard instanceof Response));
  assert.equal((managerAdminGuard as any).role, "manager");

  const adminManagementGuard = await requireRole(requestFor("/management", adminToken), env, "manager");
  assert.ok(adminManagementGuard instanceof Response);
  assert.equal(adminManagementGuard.status, 302);
  assert.ok(adminManagementGuard.headers.get("Location")?.startsWith("/login"));

  const managerManagementGuard = await requireRole(requestFor("/management", managerToken), env, "manager");
  assert.ok(!(managerManagementGuard instanceof Response));
  assert.equal((managerManagementGuard as any).role, "manager");

  console.log("role access scenarios passed");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
