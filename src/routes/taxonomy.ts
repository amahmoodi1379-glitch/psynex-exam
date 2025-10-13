// src/routes/taxonomy.ts
import { html, json, page } from "../lib/http";
import { requireRole } from "../lib/auth";

type Item = { id: string; name: string };
type Course = Item & { majorId: string };
type Source = Item & { courseId: string };
type Chapter = Item & { sourceId: string };

const K = {
  major: (id: string) => `taxo:majors:${id}`,
  degree: (id: string) => `taxo:degrees:${id}`,
  ministry: (id: string) => `taxo:ministries:${id}`,
  examYear: (id: string) => `taxo:examYears:${id}`,
  course: (id: string) => `taxo:courses:${id}`,
  source: (id: string) => `taxo:sources:${id}`,
  chapter: (id: string) => `taxo:chapters:${id}`,
};

function nid() { return String(Date.now()) + Math.floor(Math.random()*100000).toString().padStart(5, "0"); }
async function listAll<T>(env:any, prefix:string): Promise<T[]> {
  const out:T[] = [];
  let cursor: string | undefined;
  while (true) {
    const res = await env.TAXO.list({ prefix, limit: 1000, cursor });
    for (const k of res.keys) {
      const raw = await env.TAXO.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return out;
}

export function routeTaxonomy(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ---------- GET های عمومی برای دراپ‌داون‌ها ----------
  if (p === "/api/taxonomy/majors" && req.method === "GET") {
    return (async () => {
      const items: Item[] = await listAll(env, "taxo:majors:");
      items.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(items);
    })();
  }
  if (p === "/api/taxonomy/degrees" && req.method === "GET") {
    return (async () => {
      const items: Item[] = await listAll(env, "taxo:degrees:");
      items.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(items);
    })();
  }
  if (p === "/api/taxonomy/ministries" && req.method === "GET") {
    return (async () => {
      const items: Item[] = await listAll(env, "taxo:ministries:");
      items.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(items);
    })();
  }
  if (p === "/api/taxonomy/exam-years" && req.method === "GET") {
    return (async () => {
      const items: Item[] = await listAll(env, "taxo:examYears:");
      items.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(items);
    })();
  }
  if (p === "/api/taxonomy/courses" && req.method === "GET") {
    return (async () => {
      const majorId = url.searchParams.get("majorId") || "";
      const items: Course[] = await listAll(env, "taxo:courses:");
      const filtered = majorId ? items.filter(x=>x.majorId===majorId) : items;
      filtered.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(filtered);
    })();
  }
  if (p === "/api/taxonomy/sources" && req.method === "GET") {
    return (async () => {
      const courseId = url.searchParams.get("courseId") || "";
      const items: Source[] = await listAll(env, "taxo:sources:");
      const filtered = courseId ? items.filter(x=>x.courseId===courseId) : items;
      filtered.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(filtered);
    })();
  }
  if (p === "/api/taxonomy/chapters" && req.method === "GET") {
    return (async () => {
      const sourceId = url.searchParams.get("sourceId") || "";
      const items: Chapter[] = await listAll(env, "taxo:chapters:");
      const filtered = sourceId ? items.filter(x=>x.sourceId===sourceId) : items;
      filtered.sort((a,b)=> a.name.localeCompare(b.name, "fa"));
      return json(filtered);
    })();
  }

  // ---------- نوشتن (فقط ادمین) ----------
  // helpers
  async function ensureAdmin(): Promise<Response | null> {
    const r = await requireRole(req, env, "admin");
    return (r instanceof Response) ? r : null;
  }
  async function up(env:any, key:string, obj:any) { await env.TAXO.put(key, JSON.stringify(obj)); }
  async function del(env:any, key:string) { await env.TAXO.delete(key); }

  // majors
  if (p === "/api/taxonomy/majors" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const name = String(body?.name || "").trim(); const id = String(body?.id || "") || nid();
      if (!name) return json({ ok:false, error:"name_required" }, 400);
      const obj: Item = { id, name }; await up(env, K.major(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/majors/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      // جلوگیری از حذف در صورت وجود course
      const courses: Course[] = await listAll(env, "taxo:courses:");
      if (courses.some(c=>c.majorId===id)) return json({ ok:false, error:"has_children" }, 400);
      await del(env, K.major(id));
      return json({ ok:true });
    })();
  }

  // degrees
  if (p === "/api/taxonomy/degrees" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const name = String(body?.name || "").trim(); const id = String(body?.id || "") || nid();
      if (!name) return json({ ok:false, error:"name_required" }, 400);
      const obj: Item = { id, name }; await up(env, K.degree(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/degrees/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      await del(env, K.degree(id)); return json({ ok:true });
    })();
  }

  // ministries
  if (p === "/api/taxonomy/ministries" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const name = String(body?.name || "").trim(); const id = String(body?.id || "") || nid();
      if (!name) return json({ ok:false, error:"name_required" }, 400);
      const obj: Item = { id, name }; await up(env, K.ministry(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/ministries/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      await del(env, K.ministry(id)); return json({ ok:true });
    })();
  }

  // examYears
  if (p === "/api/taxonomy/exam-years" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const name = String(body?.name || "").trim(); const id = String(body?.id || "") || nid();
      if (!name) return json({ ok:false, error:"name_required" }, 400);
      const obj: Item = { id, name }; await up(env, K.examYear(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/exam-years/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      await del(env, K.examYear(id)); return json({ ok:true });
    })();
  }

  // courses
  if (p === "/api/taxonomy/courses" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json();
      const name = String(body?.name || "").trim(); const majorId = String(body?.majorId || ""); const id = String(body?.id || "") || nid();
      if (!name || !majorId) return json({ ok:false, error:"name_major_required" }, 400);
      const obj: Course = { id, name, majorId }; await up(env, K.course(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/courses/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      // جلوگیری از حذف در صورت وجود source
      const sources: Source[] = await listAll(env, "taxo:sources:");
      if (sources.some(s=>s.courseId===id)) return json({ ok:false, error:"has_children" }, 400);
      await del(env, K.course(id)); return json({ ok:true });
    })();
  }

  // sources
  if (p === "/api/taxonomy/sources" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json();
      const name = String(body?.name || "").trim(); const courseId = String(body?.courseId || ""); const id = String(body?.id || "") || nid();
      if (!name || !courseId) return json({ ok:false, error:"name_course_required" }, 400);
      const obj: Source = { id, name, courseId }; await up(env, K.source(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/sources/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      const chapters: Chapter[] = await listAll(env, "taxo:chapters:");
      if (chapters.some(c=>c.sourceId===id)) return json({ ok:false, error:"has_children" }, 400);
      await del(env, K.source(id)); return json({ ok:true });
    })();
  }

  // chapters
  if (p === "/api/taxonomy/chapters" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json();
      const name = String(body?.name || "").trim(); const sourceId = String(body?.sourceId || ""); const id = String(body?.id || "") || nid();
      if (!name || !sourceId) return json({ ok:false, error:"name_source_required" }, 400);
      const obj: Chapter = { id, name, sourceId }; await up(env, K.chapter(id), obj);
      return json({ ok:true, item: obj });
    })();
  }
  if (p === "/api/taxonomy/chapters/delete" && req.method === "POST") {
    return (async () => {
      const g = await ensureAdmin(); if (g) return g;
      const body = await req.json(); const id = String(body?.id || "");
      if (!id) return json({ ok:false, error:"id_required" }, 400);
      await del(env, K.chapter(id)); return json({ ok:true });
    })();
  }

  // ---------- صفحهٔ مدیریت تاکسونومی (ادمین) ----------
  if (p === "/admin/taxonomy" && req.method === "GET") {
    return (async () => {
      const g = await requireRole(req, env, "admin"); if (g instanceof Response) return g;
      const body = `
        <style>
          .row{display:flex; gap:8px; flex-wrap:wrap; align-items:end}
          input,select{padding:6px}
          table{width:100%; border-collapse: collapse; margin-top:8px}
          th,td{border:1px solid #eee; padding:6px}
          th{background:#fafafa}
        </style>
        <h1>مدیریت تاکسونومی</h1>

        <div class="card">
          <b>رشته‌ها</b>
          <div class="row">
            <input id="m-name" placeholder="نام رشته">
            <button id="m-add">افزودن</button>
            <select id="m-list" style="min-width:260px"></select>
            <button id="m-del">حذف</button>
          </div>
        </div>

        <div class="card">
          <b>درس‌ها</b>
          <div class="row">
            <select id="c-major"></select>
            <input id="c-name" placeholder="نام درس">
            <button id="c-add">افزودن</button>
            <select id="c-list" style="min-width:260px"></select>
            <button id="c-del">حذف</button>
          </div>
        </div>

        <div class="card">
          <b>منابع</b>
          <div class="row">
            <select id="s-course"></select>
            <input id="s-name" placeholder="نام منبع">
            <button id="s-add">افزودن</button>
            <select id="s-list" style="min-width:260px"></select>
            <button id="s-del">حذف</button>
          </div>
        </div>

        <div class="card">
          <b>فصل‌ها</b>
          <div class="row">
            <select id="ch-source"></select>
            <input id="ch-name" placeholder="نام فصل/مبحث">
            <button id="ch-add">افزودن</button>
            <select id="ch-list" style="min-width:260px"></select>
            <button id="ch-del">حذف</button>
          </div>
        </div>

        <div class="card">
          <b>سایرها</b>
          <div class="row">
            <input id="d-name" placeholder="مقطع">
            <button id="d-add">افزودن مقطع</button>
            <select id="d-list" style="min-width:200px"></select>
            <button id="d-del">حذف</button>
          </div>
          <div class="row" style="margin-top:6px">
            <input id="mi-name" placeholder="وزارتخانه (بهداشت/علوم)">
            <button id="mi-add">افزودن وزارت</button>
            <select id="mi-list" style="min-width:200px"></select>
            <button id="mi-del">حذف</button>
          </div>
          <div class="row" style="margin-top:6px">
            <input id="y-name" placeholder="سال کنکور (مثلاً 1403)">
            <button id="y-add">افزودن سال</button>
            <select id="y-list" style="min-width:200px"></select>
            <button id="y-del">حذف</button>
          </div>
        </div>

        <script>
          async function fill(sel, url, val="id", lab="name") {
            const el = document.getElementById(sel); el.innerHTML = "";
            const r = await fetch(url); const arr = await r.json();
            for (const it of arr) {
              const o = document.createElement("option"); o.value = it[val]; o.textContent = it[lab]; el.appendChild(o);
            }
            return arr;
          }
          async function loadMajors(){ return fill("m-list", "/api/taxonomy/majors"); }
          async function loadDeg(){ return fill("d-list", "/api/taxonomy/degrees"); }
          async function loadMin(){ return fill("mi-list", "/api/taxonomy/ministries"); }
          async function loadYears(){ return fill("y-list", "/api/taxonomy/exam-years"); }

          async function loadCourses(){
            const majors = await fill("c-major", "/api/taxonomy/majors");
            const mid = document.getElementById("c-major").value || (majors[0]?.id||"");
            return fill("c-list", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid));
          }
          async function loadSources(refreshCourses = false){
            const courseSelect = document.getElementById("s-course");
            if(!courseSelect) return;
            const selectEl = /** @type {HTMLSelectElement} */ (courseSelect);
            const previousSelection = selectEl.value;

            let courses;
            if (refreshCourses || !selectEl.options.length) {
              courses = await fill("s-course", "/api/taxonomy/courses");
              if (previousSelection && courses.some(c=>c.id===previousSelection)) {
                selectEl.value = previousSelection;
              } else if (courses.length) {
                selectEl.value = courses[0].id;
              } else {
                selectEl.value = "";
              }
            } else if (!selectEl.value && selectEl.options.length) {
              selectEl.value = selectEl.options[0].value;
            }

            const cid = selectEl.value || "";
            return fill("s-list", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
          }
          async function loadChapters(){
            const sources = await fill("ch-source", "/api/taxonomy/sources");
            const sid = document.getElementById("ch-source").value || (sources[0]?.id||"");
            return fill("ch-list", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          }

          // add/delete handlers
          document.getElementById("m-add").onclick = async ()=>{
            const name = document.getElementById("m-name").value.trim(); if(!name) return alert("نام را وارد کن");
            const r = await fetch("/api/taxonomy/majors", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("m-name").value=""; await loadMajors(); await loadCourses();
          };
          document.getElementById("m-del").onclick = async ()=>{
            const id = document.getElementById("m-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/majors/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadMajors(); await loadCourses();
          };

          document.getElementById("c-major").addEventListener("change", loadCourses);
          document.getElementById("c-add").onclick = async ()=>{
            const majorId = document.getElementById("c-major").value; const name = document.getElementById("c-name").value.trim();
            if(!majorId || !name) return alert("رشته و نام درس لازم است");
            const r = await fetch("/api/taxonomy/courses", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({majorId, name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("c-name").value=""; await loadCourses(); await loadSources(true);
          };
          document.getElementById("c-del").onclick = async ()=>{
            const id = document.getElementById("c-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/courses/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadCourses(); await loadSources(true);
          };

          document.getElementById("s-course").addEventListener("change", ()=>loadSources());
          document.getElementById("s-add").onclick = async ()=>{
            const courseId = document.getElementById("s-course").value; const name = document.getElementById("s-name").value.trim();
            if(!courseId || !name) return alert("درس و نام منبع لازم است");
            const r = await fetch("/api/taxonomy/sources", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({courseId, name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("s-name").value=""; await loadSources(); await loadChapters();
          };
          document.getElementById("s-del").onclick = async ()=>{
            const id = document.getElementById("s-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/sources/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadSources(); await loadChapters();
          };

          document.getElementById("ch-source").addEventListener("change", loadChapters);
          document.getElementById("ch-add").onclick = async ()=>{
            const sourceId = document.getElementById("ch-source").value; const name = document.getElementById("ch-name").value.trim();
            if(!sourceId || !name) return alert("منبع و نام فصل لازم است");
            const r = await fetch("/api/taxonomy/chapters", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({sourceId, name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("ch-name").value=""; await loadChapters();
          };
          document.getElementById("ch-del").onclick = async ()=>{
            const id = document.getElementById("ch-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/chapters/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadChapters();
          };

          // others
          document.getElementById("d-add").onclick = async ()=>{
            const name = document.getElementById("d-name").value.trim(); if(!name) return alert("نام مقطع لازم است");
            const r = await fetch("/api/taxonomy/degrees", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("d-name").value=""; await loadDeg();
          };
          document.getElementById("d-del").onclick = async ()=>{
            const id = document.getElementById("d-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/degrees/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadDeg();
          };

          document.getElementById("mi-add").onclick = async ()=>{
            const name = document.getElementById("mi-name").value.trim(); if(!name) return alert("نام وزارت لازم است");
            const r = await fetch("/api/taxonomy/ministries", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("mi-name").value=""; await loadMin();
          };
          document.getElementById("mi-del").onclick = async ()=>{
            const id = document.getElementById("mi-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/ministries/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadMin();
          };

          document.getElementById("y-add").onclick = async ()=>{
            const name = document.getElementById("y-name").value.trim(); if(!name) return alert("سال را وارد کن");
            const r = await fetch("/api/taxonomy/exam-years", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({name})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); document.getElementById("y-name").value=""; await loadYears();
          };
          document.getElementById("y-del").onclick = async ()=>{
            const id = document.getElementById("y-list").value; if(!id) return;
            const r = await fetch("/api/taxonomy/exam-years/delete", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({id})});
            const d = await r.json(); if(!d.ok) return alert(d.error||"خطا"); await loadYears();
          };

          // init
          async function init(){
            await loadMajors(); await loadCourses(); await loadSources(true); await loadChapters();
            await loadDeg(); await loadMin(); await loadYears();
          }
          init();
        </script>
      `;
      return html(page("مدیریت تاکسونومی", body));
    })();
  }

  return null;
}
