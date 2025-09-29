import { json } from "../lib/http";
import { loadTaxonomy, saveTaxonomy } from "../lib/taxonomyStore";

type Entity =
  | "majors" | "degrees" | "ministries" | "exam-years"
  | "courses" | "sources" | "chapters";

const map: Record<Entity, keyof Awaited<ReturnType<typeof loadTaxonomy>>> = {
  majors: "majors",
  degrees: "degrees",
  ministries: "ministries",
  "exam-years": "examYears",
  courses: "courses",
  sources: "sources",
  chapters: "chapters"
};

export async function routeTaxonomy(req: Request, url: URL, env: any): Promise<Response | null> {
  const p = url.pathname;

  const t = await loadTaxonomy(env);

  // عمومی
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

  // مدیریت - نیاز به توکن
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

  // افزودن یا ویرایش یک آیتم
  if (p === "/api/management/taxonomy/upsert" && req.method === "POST") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    const entityParam = url.searchParams.get("entity") as Entity | null;
    if (!entityParam || !map[entityParam]) return json({ ok: false, error: "bad entity" }, 400);

    const body = await req.json().catch(() => null) as any;
    if (!body || !body.name) return json({ ok: false, error: "name required" }, 400);

    const key = map[entityParam];
    // @ts-ignore
    const list = t[key] as Array<any>;
    const id = body.id ? String(body.id) : String(Date.now());

    const idx = list.findIndex(it => String(it.id) === id);
    const item: any = { id, name: String(body.name) };
    if (entityParam === "courses") item.parentId = body.parentId;
    if (entityParam === "sources") item.parentId = body.parentId;
    if (entityParam === "chapters") item.parentId = body.parentId;

    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    else list.push(item);

    await saveTaxonomy(env, t);
    return json({ ok: true, item });
  }

  // حذف یک آیتم با حذف آبشاری
  if (p === "/api/management/taxonomy/delete" && req.method === "DELETE") {
    if (!isAdmin(url, req, env)) return json({ ok: false, error: "unauthorized" }, 401);
    const entityParam = url.searchParams.get("entity") as Entity | null;
    const id = url.searchParams.get("id");
    if (!entityParam || !map[entityParam] || !id) return json({ ok: false, error: "bad params" }, 400);

    cascadeDelete(t, entityParam, id);
    await saveTaxonomy(env, t);
    return json({ ok: true });
  }

  return null;
}

function isAdmin(u: URL, r: Request, e: any): boolean {
  const token = u.searchParams.get("token") || r.headers.get("x-admin-token");
  return !!token && token === e.ADMIN_TOKEN;
}

function cascadeDelete(t: any, entity: Entity, id: string) {
  const rem = (arr: any[], pred: (x: any) => boolean) => {
    const removed: string[] = [];
    for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) { removed.push(String(arr[i].id)); arr.splice(i, 1); }
    return removed;
  };

  // حذف اصلی
  const key = map[entity];
  // @ts-ignore
  rem(t[key], (x: any) => String(x.id) === String(id));

  if (entity === "majors") {
    const courseIds = rem(t.courses, (x: any) => String(x.parentId) === String(id));
    const sourceIds = rem(t.sources, (x: any) => courseIds.includes(String(x.parentId)));
    rem(t.chapters, (x: any) => sourceIds.includes(String(x.parentId)));
  } else if (entity === "courses") {
    const sourceIds = rem(t.sources, (x: any) => String(x.parentId) === String(id));
    rem(t.chapters, (x: any) => sourceIds.includes(String(x.parentId)));
  } else if (entity === "sources") {
    rem(t.chapters, (x: any) => String(x.parentId) === String(id));
  }
}
