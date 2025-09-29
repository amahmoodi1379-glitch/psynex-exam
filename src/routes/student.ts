import { html, json, page } from "../lib/http";
import { queryRandomQuestion, getQuestion, recordAnswer, upsertRating, chooseChallengeQuestion } from "../lib/dataStore";

export function routeStudent(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // --- API: سؤال تصادفی (تک سؤال‌ها) ---
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

      const safe = { id: q.id, type: q.type, stem: q.stem, options: (q.options || []).map(o => ({ label: o.label, text: o.text })) };
      return json({ ok: true, data: safe });
    })();
  }

  // --- API: جواب + ثبت لاگ + امتیاز ---
  if (p === "/api/student/answer" && req.method === "POST") {
    return (async () => {
      try {
        const body = await req.json();
        const id = body?.id as string;
        const type = body?.type as "konkur"|"talifi";
        const choice = body?.choice as "A"|"B"|"C"|"D";
        const clientId = body?.clientId as string;
        const quality = body?.quality ? Number(body.quality) : undefined;
        const difficulty = body?.difficulty ? Number(body.difficulty) : undefined;
        const filters = body?.filters || undefined;

        if (!id || !type || !choice || !clientId) return json({ ok: false, error: "bad_request" }, 400);
        if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);

        const q = await getQuestion(env, type, id);
        if (!q) return json({ ok: false, error: "not_found" }, 404);

        const correct = q.correctLabel === choice;
        await recordAnswer(env, { clientId, qid: id, type, choice, correct, at: Date.now(), filters });
        await upsertRating(env, id, quality, difficulty);

        return json({ ok: true, correct, correctLabel: q.correctLabel, expl: q.expl || null });
      } catch (e: any) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    })();
  }

  // --- API: سؤال چالشی بعدی ---
  if (p === "/api/student/challenge-next" && req.method === "GET") {
    return (async () => {
      const clientId = url.searchParams.get("clientId") || "";
      const type = (url.searchParams.get("type") as "konkur"|"talifi") || null;
      const filters = {
        majorId: url.searchParams.get("majorId") || undefined,
        courseId: url.searchParams.get("courseId") || undefined,
        degreeId: url.searchParams.get("degreeId") || undefined,
        ministryId: url.searchParams.get("ministryId") || undefined,
        examYearId: url.searchParams.get("examYearId") || undefined,
        sourceId: url.searchParams.get("sourceId") || undefined,
        chapterId: url.searchParams.get("chapterId") || undefined
      };
      if (!clientId) return json({ ok: false, error: "clientId required" }, 400);
      if (!filters.majorId) return json({ ok: false, error: "majorId required" }, 400);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);

      const q = await chooseChallengeQuestion(env, clientId, filters, type);
      if (!q) return json({ ok: false, error: "no_challenge" }, 404);

      const safe = { id: q.id, type: q.type, stem: q.stem, options: (q.options || []).map(o => ({ label: o.label, text: o.text })) };
      return json({ ok: true, data: safe });
    })();
  }

  // --- صفحه دانشجو با دو تب: تک‌سؤال‌ها + چالش‌ها ---
  if (p === "/student") {
    const body = `
      <style>
        .tabbar button{margin:0 4px;padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
        .tabbar button.active{background:#222;color:#fff;border-color:#222}
        .tabsec{display:none}
      </style>

      <h1>صفحه دانشجو</h1>
      <div class="tabbar">
        <button data-tab="tab-single" class="active">تک‌سؤال‌ها</button>
        <button data-tab="tab-challenges">چالش‌ها</button>
      </div>

      <!-- تک‌سؤال‌ها -->
      <div class="card tabsec" id="tab-single" style="display:block">
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

        <div class="card" id="qbox" style="display:none">
          <div id="stem" style="font-weight:600;margin-bottom:8px"></div>
          <div id="opts"></div>

          <div style="margin-top:10px">
            <span>امتیاز کیفیت (اختیاری): </span>
            <select id="quality"><option value="">--</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
            <span style="margin-right:12px">سختی (اختیاری): </span>
            <select id="difficulty"><option value="">--</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
          </div>

          <div id="result" style="margin-top:10px" class="muted"></div>
          <button id="nextBtn" style="margin-top:8px">سؤال بعدی</button>
        </div>
      </div>

      <!-- چالش‌ها -->
      <div class="card tabsec" id="tab-challenges">
        <b>سؤال‌های چالشی (سؤالهایی که قبلاً غلط زده‌ای)</b>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end">
          <div><label>نوع</label>
            <select id="ctype">
              <option value="">هر دو</option>
              <option value="konkur">کنکور</option>
              <option value="talifi">تالیفی</option>
            </select>
          </div>
          <div><label>رشته (الزامی)</label> <select id="cmajor" required></select></div>
          <div><label>درس</label> <select id="ccourse"></select></div>
          <div><label>منبع</label> <select id="csource"></select></div>
          <div><label>فصل</label> <select id="cchapter"></select></div>
          <button id="cfetchBtn">سؤال چالشی</button>
        </div>

        <div class="card" id="cbox" style="display:none">
          <div id="cstem" style="font-weight:600;margin-bottom:8px"></div>
          <div id="copts"></div>

          <div style="margin-top:10px">
            <span>کیفیت (اختیاری): </span>
            <select id="cquality"><option value="">--</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
            <span style="margin-right:12px">سختی (اختیاری): </span>
            <select id="cdifficulty"><option value="">--</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
          </div>

          <div id="cresult" style="margin-top:10px" class="muted"></div>
          <button id="cnextBtn" style="margin-top:8px">چالشی بعدی</button>
        </div>
      </div>

      <script>
        const $ = s => document.querySelector(s);

        // تب‌ها
        const tabs = document.querySelectorAll('.tabbar button');
        function showTab(id){
          document.querySelectorAll('.tabsec').forEach(el=>el.style.display='none');
          document.getElementById(id).style.display='block';
          tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
          location.hash = id;
        }
        tabs.forEach(b=>b.addEventListener('click', ()=>showTab(b.dataset.tab)));
        if (location.hash && document.getElementById(location.hash.slice(1))) showTab(location.hash.slice(1));

        // clientId دائمی
        function getClientId(){
          const k="psx_cid";
          let v = localStorage.getItem(k);
          if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
          return v;
        }
        const clientId = getClientId();

        // helper برای پرکردن دراپ‌داون‌ها
        async function fill(id, url, v="id", l="name", allowEmpty=true) {
          const el = $("#"+id); el.innerHTML = allowEmpty ? "<option value=''>--</option>" : "";
          const res = await fetch(url); const items = await res.json();
          for (const it of items) { const o=document.createElement("option"); o.value=it[v]; o.textContent=it[l]; el.appendChild(o); }
        }
        async function initCascadesSingle() {
          await fill("major", "/api/taxonomy/majors", "id", "name", false);
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
          await new Promise(r=>setTimeout(r,100));
          await upd();
        }
        async function initCascadesChallenge() {
          await fill("cmajor", "/api/taxonomy/majors", "id", "name", false);
          const upd = async () => {
            const mid = $("#cmajor").value || "";
            await fill("ccourse", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid));
            const cid = $("#ccourse").value || "";
            await fill("csource", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
            const sid = $("#csource").value || "";
            await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          };
          $("#cmajor").addEventListener("change", upd);
          $("#ccourse").addEventListener("change", async () => {
            const cid = $("#ccourse").value || "";
            await fill("csource", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
          });
          $("#csource").addEventListener("change", async () => {
            const sid = $("#csource").value || "";
            await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          });
          await new Promise(r=>setTimeout(r,100));
          await upd();
        }

        // جلوگیری ساده از تکرار در نشست (فقط تک‌سؤال‌ها)
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

        function currentFiltersSingle(){
          return {
            majorId: $("#major").value || undefined,
            degreeId: $("#degree").value || undefined,
            ministryId: $("#ministry").value || undefined,
            examYearId: $("#examYear").value || undefined,
            courseId: $("#course").value || undefined,
            sourceId: $("#source").value || undefined,
            chapterId: $("#chapter").value || undefined
          };
        }
        function currentFiltersChallenge(){
          return {
            majorId: $("#cmajor").value || undefined,
            courseId: $("#ccourse").value || undefined,
            sourceId: $("#csource").value || undefined,
            chapterId: $("#cchapter").value || undefined
          };
        }

        async function fetchRandom() {
          const type = $("#type").value;
          const majorId = $("#major").value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const params = new URLSearchParams({
            type, majorId,
            degreeId: $("#degree").value,
            ministryId: $("#ministry").value,
            examYearId: $("#examYear").value,
            courseId: $("#course").value,
            sourceId: $("#source").value,
            chapterId: $("#chapter").value
          });
          for (let tries=0; tries<5; tries++) {
            const r = await fetch("/api/student/random?"+params.toString());
            const d = await r.json();
            if (!d.ok) { $("#qbox").style.display="none"; alert("سؤالی با این فیلتر پیدا نشد."); return; }
            const q = d.data;
            if (seenHas(q.id) && tries < 4) continue;
            renderSingle(q); return;
          }
          alert("سؤال تازه‌ای پیدا نشد. فیلتر را عوض کن.");
        }

        function renderSingle(q) {
          $("#qbox").style.display="block";
          $("#stem").textContent = q.stem;
          const box = $("#opts"); box.innerHTML = "";
          for (const o of (q.options || [])) {
            const btn = document.createElement("button");
            btn.textContent = o.label + ") " + o.text;
            btn.style.display = "block";
            btn.style.margin = "6px 0";
            btn.onclick = () => answer(q, o.label, "single");
            box.appendChild(btn);
          }
          $("#result").textContent = "";
          $("#nextBtn").onclick = () => fetchRandom();
          $("#qbox").dataset.id = q.id; $("#qbox").dataset.type = q.type;
        }

        async function fetchChallenge() {
          const majorId = $("#cmajor").value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const params = new URLSearchParams({
            clientId,
            type: $("#ctype").value,
            majorId,
            courseId: $("#ccourse").value,
            sourceId: $("#csource").value,
            chapterId: $("#cchapter").value
          });
          const r = await fetch("/api/student/challenge-next?"+params.toString());
          const d = await r.json();
          if (!d.ok) { $("#cbox").style.display="none"; alert("سؤال چالشی پیدا نشد."); return; }
          renderChallenge(d.data);
        }

        function renderChallenge(q) {
          $("#cbox").style.display="block";
          $("#cstem").textContent = q.stem;
          const box = $("#copts"); box.innerHTML = "";
          for (const o of (q.options || [])) {
            const btn = document.createElement("button");
            btn.textContent = o.label + ") " + o.text;
            btn.style.display = "block";
            btn.style.margin = "6px 0";
            btn.onclick = () => answer(q, o.label, "challenge");
            box.appendChild(btn);
          }
          $("#cresult").textContent = "";
          $("#cnextBtn").onclick = () => fetchChallenge();
          $("#cbox").dataset.id = q.id; $("#cbox").dataset.type = q.type;
        }

        async function answer(q, choice, mode) {
          const quality = Number((mode==="single" ? $("#quality").value : $("#cquality").value) || "") || undefined;
          const difficulty = Number((mode==="single" ? $("#difficulty").value : $("#cdifficulty").value) || "") || undefined;
          const filters = mode==="single" ? currentFiltersSingle() : currentFiltersChallenge();
          const res = await fetch("/api/student/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: q.id, type: q.type, choice, clientId, quality, difficulty, filters })
          });
          const d = await res.json();
          const target = (mode==="single") ? "#result" : "#cresult";
          if (!d.ok) { $(target).textContent = "خطا."; return; }
          const html = (d.correct? "✅ درست": "❌ غلط") + (d.correctLabel? " — گزینه صحیح: " + d.correctLabel : "") + (d.expl? "<div style='margin-top:6px'>"+d.expl+"</div>": "");
          $(target).innerHTML = html;
          if (mode==="single") { seenAdd(q.id); }
        }

        $("#fetchBtn").addEventListener("click", fetchRandom);
        $("#cfetchBtn").addEventListener("click", fetchChallenge);

        async function initAll(){
          await initCascadesSingle();
          await initCascadesChallenge();
        }
        initAll();
      </script>
    `;
    return html(page("دانشجو", body));
  }

  return null;
}
