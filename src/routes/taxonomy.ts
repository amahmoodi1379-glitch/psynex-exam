import { json } from "../lib/http";
import { loadTaxonomy, saveTaxonomy } from "../lib/taxonomyStore";

export function routeTaxonomy(req: Request, url: URL, env: any): Response | null {
  const path = url.pathname;

  // --- API عمومی برای دراپ‌داون‌ها ---
  if (path === "/api/taxonomy/majors") return awaitJson(env, t => t.majors);
  if (path === "/api/taxonomy/degrees") return awaitJson(env, t => t.degrees);
  if (path === "/api/taxonomy/ministries") return awaitJson(env, t => t.ministries);
  if (path === "/api/taxonomy/exam-years") return awaitJson(env, t => t.examYears);

  if (path === "/api/taxonomy/courses") {
    const majorId = url.searchParams.get("majorId");
    return awaitJson(env, t => t.courses.filter(c => !majorId || String(c.parentId) === String(majorId)));
  }
  if (path === "/api/taxonomy/sources") {
    const courseId = url.searchParams.get("courseId");
    return awaitJson(env, t => t.sources.filter(s => !courseId || String(s.parentId) === String(courseId)));
  }
  if (path === "/api/taxonomy/chapters") {
    const sourceId = url.searchParams.get("sourceId");
    return awaitJson(env, t => t.chapters.filter(ch => !sourceId || String(ch.parentId) === String(sourceId)));
  }

  // --- API مدیریت: مشاهده/ذخیره کل JSON (نیاز به توکن) ---
  if (path === "/api/management/taxonomy" && req.method === "GET") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    return awaitJson(env, t => ({ ok: true, data: t }));
  }
  if (path === "/api/management/taxonomy" && req.method === "PUT") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    return new Response(null, {
      headers: { "content-type": "application/json" },
      status: 200,
      body: JSON.stringify(await putBody())
    });

    async function putBody() {
      try {
        const body = await req.json();
        await saveTaxonomy(env, body);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
  }

  return null;

  function isAdmin(u: URL, r: Request, e: any): boolean {
    const token = u.searchParams.get("token") || r.headers.get("x-admin-token");
    return token && e.ADMIN_TOKEN && token === e.ADMIN_TOKEN;
  }
}
function awaitJson(env: any, fn: (t: any) => any): Response {
  return new Response(
    (async () => JSON.stringify(fn(await loadTaxonomy(env))))(),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
  );
}
