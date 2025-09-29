import { html, json, page } from "../lib/http";
import { queryRandomQuestion, getQuestion, Question } from "../lib/dataStore";

export function routeStudent(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // API: گرفتن سؤال تصادفی با فیلترها (GET)
  if (p === "/api/student/random" && req.method === "GET") {
    return (async () => {
      const type = ((url.searchParams.get("type") || "konkur") as "konkur"|"talifi");
      const majorId = url.searchParams.get("majorId");
      if (!majorId) return json({ ok: false, error: "majorId required" }, 400);

      const filters = {
        majorId,
        degreeId: url.searchParams.get("degreeId") || undefined,
        ministryId: url.searchParams.get("ministryId") || undefined,
        examYearId: url.searchParams.get("examYearId") || undefined,
        courseId: url.searchParams.get("courseId") || undefined,
        sourceId: url.searchParams.get("sourceId") || undefined,
        chapterId: url.searchParams.get("chapterId") || undefined
      };

      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const q = await queryRandomQuestion(env, type, filters);
      if (!q) return json({ ok: false, error: "no_question" }, 404);

      // پاسخ امن: گزینه صحیح را ارسال نکن
      const safe = {
        id: q.id, type: q.type, stem: q.stem,
        options: (q.options || []).map(o => ({ label: o.label, text: o.text }))
      };
      return json({ ok: true, data: safe });
    })();
  }

  // API: چک کردن پاسخ (POST: id, type, choice)
  if (p === "/api/student/check" && req.method === "POST") {
    return (async () => {
      const body = await req.json().catch(() => null) as any;
      const id = body?.id, type = body?.type as "konkur"|"talifi";
      const choice = body?.choice as "A"|"B"|"C"|"D";
      if (!id || !type || !choice) return json({ ok: false, error: "bad_request" }, 400);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const q = await getQuestion(env, type, id);
      if (!q) return json({ ok: false, error: "not_found" }, 404);
      const correct = q.correctLabel === choice;
      return json({
        ok: true,
        correct,
        correctLabel: q.correctLabel,
        expl: q.expl || null
      });
    })();
  }

  // صفحه دانشجو
  if (p === "/student") {
    const body = `
      <h1>صفحه دانشجو</h1>
      <div class="card">
        <b>گرفتن سؤال تصادفی</b>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end">
          <div><label>نوع</label>
            <select id="type">
              <option value="konkur">کنکور</option>
              <option value="talifi">تالیفی</option>
            </select>
          </div>
          <div><label>رشته (الزامی)</label> <select id="major" required></select></div>
          <div><label>مقطع</label> <select id="degree"></select></div>
          <div><label>وزارتخانه</label> <select id="ministry"></select></div>
          <div><label>سال کنکور</label> <select id="examYear"></select></div>
          <div><label>درس</label> <select id="course"></select></div>
          <div><label>منبع</label> <select id="source"></select></div>
          <div><label>فصل</label> <select id="chapter"></select></div>
          <button id="fetchBtn">یافتن سؤال</button>
        </div>
      </div>

      <div class="card" id="qbox" style="display:none">
        <div id="stem" style="font-weight:600;margin-bottom:8px"></div>
        <div id="opts"></div>
        <div id="result" style="margin-top:10px" class="muted"></div>
        <button id="nextBtn" style="margin-top:8px">سؤال بعدی</button>
      </div>

      <p class="muted">یادداشت: فعلاً جلوگیری از تکرار در حد مرورگر شماست (sessionStorage). بعد از افزودن لاگین گوگل، منطق اولویت‌دهی کامل می‌شود.</p>

      <script>
        const $ = s => document.querySelector(s);

        async function fill(id, url, v="id", l="name") {
          const el = $("#"+id); el.innerHTML = "<option value=''>--</option>";
          const res = await fetch(url); const items = await res.json();
          for (const it of items) { const o=document.createElement("option"); o.value=it[v]; o.textContent=it[l]; el.appendChild(o); }
        }
        async function initCascades() {
          await fill("major", "/api/taxonomy/majors");
          await fill("degree", "/api/taxonomy/degrees");
          await fill("ministry", "/api/taxonomy/ministries");
          await fill("examYear", "/api/taxonomy/exam-years");
          const upd = async () => {
            const mid = $("#major").value || "";
            await fill("course", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid));
            const cid = $("#course").value || "";
            await fill("source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
            const sid = $("#source").value || "";
            await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          };
          $("#major").addEventListener("change", upd);
          $("#course").addEventListener("change", async () => {
            const cid = $("#course").value || "";
            await fill("source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
          });
          $("#source").addEventListener("change", async () => {
            const sid = $("#source").value || "";
            await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          });
          await new Promise(r=>setTimeout(r,120));
          await upd();
        }

        function seenAdd(id) {
          const k="seenIds"; const s = sessionStorage.getItem(k);
          const arr = s? JSON.parse(s): [];
          if (!arr.includes(id)) arr.push(id);
          sessionStorage.setItem(k, JSON.stringify(arr.slice(-50)));
        }
        function seenHas(id) {
          const s = sessionStorage.getItem("seenIds");
          if (!s) return false;
          return JSON.parse(s).includes(id);
        }

        async function fetchRandom() {
          const type = $("#type").value;
          const majorId = $("#major").value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const params = new URLSearchParams({
            type,
            majorId,
            degreeId: $("#degree").value,
            ministryId: $("#ministry").value,
            examYearId: $("#examYear").value,
            courseId: $("#course").value,
            sourceId: $("#source").value,
            chapterId: $("#chapter").value
          });
          // تلاش برای دوری از تکرار داخل نشست
          for (let tries=0; tries<5; tries++) {
            const r = await fetch("/api/student/random?"+params.toString());
            const d = await r.json();
            if (!d.ok) { $("#qbox").style.display="none"; alert("سؤالی با این فیلتر پیدا نشد."); return; }
            const q = d.data;
            if (seenHas(q.id) && tries < 4) continue;
            renderQ(q); return;
          }
          alert("سؤال تازه‌ای پیدا نشد. فیلتر را عوض کن.");
        }

        function renderQ(q) {
          $("#qbox").style.display="block";
          $("#stem").textContent = q.stem;
          const box = $("#opts"); box.innerHTML = "";
          for (const o of q.options || []) {
            const btn = document.createElement("button");
            btn.textContent = o.label + ") " + o.text;
            btn.style.display = "block";
            btn.style.margin = "6px 0";
            btn.onclick = () => check(q, o.label);
            box.appendChild(btn);
          }
          $("#result").textContent = "";
          $("#nextBtn").onclick = () => fetchRandom();
          $("#qbox").dataset.id = q.id; $("#qbox").dataset.type = q.type;
        }

        async function check(q, choice) {
          const res = await fetch("/api/student/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: q.id, type: q.type, choice })
          });
          const d = await res.json();
          if (!d.ok) { $("#result").textContent = "خطا."; return; }
          seenAdd(q.id);
          $("#result").innerHTML = (d.correct? "✅ درست": "❌ غلط") + (d.correctLabel? " — گزینه صحیح: " + d.correctLabel : "") + (d.expl? "<div style='margin-top:6px'>"+d.expl+"</div>": "");
        }

        $("#fetchBtn").addEventListener("click", fetchRandom);
        initCascades();
      </script>
    `;
    return html(page("دانشجو", body));
  }

  return null;
}

// دیباگ ساده: ببینیم بایندینگ‌ها می‌رسند یا نه
if (p === "/api/student/debug" && req.method === "GET") {
  return json({
    hasEnv: !!env,
    hasDATA: !!env?.DATA,
    canList: !!env?.DATA?.list
  });
}
