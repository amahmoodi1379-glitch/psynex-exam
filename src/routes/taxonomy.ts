import { json } from "../lib/http";
import { loadTaxonomy, saveTaxonomy } from "../lib/taxonomyStore";

export async function routeTaxonomy(req: Request, url: URL, env: any): Promise<Response | null> {
  const p = url.pathname;

  // داده تاکسونومی را یک بار لود می‌کنیم
  const t = await loadTaxonomy(env);

  // API عمومی برای دراپ‌داون‌ها
  if (p === "/api/taxonomy/majors") return json(t.majors);
  if (p === "/api/taxonomy/degrees") return json(t.degrees);
  if (p === "/api/taxonomy/ministries") return json(t.ministries);
  if (p === "/api/taxonomy/exam-years") return json(t.examYears);

  if (p === "/api/taxonomy/courses") {
    const majorId = url.searchParams.get("majorId");
    return json(t.courses.filter(c => !majorId || String(c.parentId) === String(majorId)));
  }
  if (p === "/api/taxonomy/sources") {
    const courseId = url.searchParams.get("courseId");
    return json(t.sources.filter(s => !courseId || String(s.parentId) === String(courseId)));
  }
  if (p === "/api/taxonomy/chapters") {
    const sourceId = url.searchParams.get("sourceId");
    return json(t.chapters.filter(ch => !sourceId || String(ch.parentId) === String(sourceId)));
  }

  // API مدیریت برای مشاهده و ذخیره کل JSON
  if (p === "/api/management/taxonomy" && req.method === "GET") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    return json({ ok: true, data: t });
  }
  if (p === "/api/management/taxonomy" && req.method === "PUT") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    try {
      const body = await req.json();
      await saveTaxonomy(env, body);
      return json({ ok: true });
    } catch (e: any) {
      return json({ ok: false, error: String(e?.message || e) }, 400);
    }
  }

  return null;

  function isAdmin(u: URL, r: Request, e: any): boolean {
    const token = u.searchParams.get("token") || r.headers.get("x-admin-token");
    return !!token && token === e.ADMIN_TOKEN;
  }
}
