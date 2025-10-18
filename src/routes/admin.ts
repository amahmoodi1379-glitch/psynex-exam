import { html, json, page } from "../lib/http";
import {
  createQuestion,
  listQuestions,
  deleteQuestion,
  getQuestion,
  updateQuestion,
  findQuestionById,
  searchQuestionsByStem,
  type QuestionType,
  type Question,
} from "../lib/dataStore";

export function routeAdmin(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // ایجاد آیتم برای هر سه نوع
  if (p === "/api/admin/create" && req.method === "POST") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const fd = await req.formData();
      const payload = formToQuestionPayload(fd, type);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const id = await createQuestion(env, payload);
      return json({ ok: true, id, type });
    })();
  }

  if (p === "/api/admin/question" && req.method === "GET") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const q = await getQuestion(env, type, id);
      if (!q) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, data: q });
    })();
  }

  if (p === "/api/admin/question/update" && req.method === "POST") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as QuestionType;
      const fd = await req.formData();
      const id = String(url.searchParams.get("id") || fd.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const payload = formToQuestionPayload(fd, type);
      const { type: _ignore, ...updates } = payload;
      const updated = await updateQuestion(env, type, id, updates);
      if (!updated) return json({ ok: false, error: "not_found" }, 404);
      return json({ ok: true, data: updated });
    })();
  }

  // لیست برای مدیریت
  if (p === "/api/admin/questions" && req.method === "GET") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      const id = (url.searchParams.get("id") || "").trim();
      const query = (url.searchParams.get("query") || "").trim();
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      let list: Question[];
      if (id) {
        list = await findQuestionById(env, type, id);
      } else if (query) {
        list = await searchQuestionsByStem(env, type, query, 200);
      } else {
        list = await listQuestions(env, type, 50);
      }
      return json({ ok: true, data: list });
    })();
  }

  // حذف
  if (p === "/api/admin/question/delete" && req.method === "DELETE") {
    return (async () => {
      const type = (url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa";
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ ok: false, error: "id required" }, 400);
      if (!env || !env.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      await deleteQuestion(env, type, id);
      return json({ ok: true });
    })();
  }

  // صفحه ادمین با تب‌های واقعی
  if (p === "/admin") {
    const body = `
      <style>
        .tabbar button{margin:0 4px;padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
        .tabbar button.active{background:#222;color:#fff;border-color:#222}
        .tabsec{display:none}
      </style>

      <h1>پنل ادمین</h1>
      <div class="tabbar">
        <button data-tab="tab-konkur" class="active">ایجاد تست کنکور</button>
        <button data-tab="tab-talifi">ایجاد تست تالیفی</button>
        <button data-tab="tab-qa">ایجاد پرسش و پاسخ</button>
        <button data-tab="tab-manage">مدیریت سوالات</button>
      </div>

      <!-- تب کنکور -->
      <div class="card tabsec" id="tab-konkur" style="display:block">
        <b>ایجاد تست کنکور</b>
        ${formHtml("/api/admin/create?type=konkur", true, "k")}
        <pre id="echo-konkur" class="muted"></pre>
      </div>

      <!-- تب تالیفی -->
      <div class="card tabsec" id="tab-talifi">
        <b>ایجاد تست تالیفی</b>
        ${formHtml("/api/admin/create?type=talifi", true, "t")}
        <pre id="echo-talifi" class="muted"></pre>
      </div>

      <!-- تب پرسش و پاسخ -->
      <div class="card tabsec" id="tab-qa">
        <b>ایجاد پرسش و پاسخ</b>
        ${formHtml("/api/admin/create?type=qa", false, "q")}
        <pre id="echo-qa" class="muted"></pre>
      </div>

      <!-- تب مدیریت -->
      <div class="card tabsec" id="tab-manage">
        <b>مدیریت سوالات</b>
        <form id="m-form" style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap">
          <label>نوع:<br>
            <select id="m-type" name="type">
              <option value="konkur">کنکور</option>
              <option value="talifi">تالیفی</option>
              <option value="qa">پرسش و پاسخ</option>
            </select>
          </label>
          <label>شناسه (اختیاری):<br>
            <input id="m-id" name="id" placeholder="UUID" style="min-width:180px">
          </label>
          <label>عبارت متن (اختیاری):<br>
            <input id="m-query" name="query" placeholder="بخشی از صورت سوال" style="min-width:220px">
          </label>
          <button type="submit" id="m-load">جست‌وجو</button>
        </form>
        <div id="m-status" class="muted" style="margin-top:6px"></div>
        <div style="margin-top:10px">
          <table border="1" cellpadding="6" style="width:100%; border-collapse:collapse">
            <thead><tr><th>شناسه</th><th>صورت سوال</th><th>نوع</th><th>عملیات</th></tr></thead>
            <tbody id="m-list"></tbody>
          </table>
          <dialog id="edit-dialog">
            <form id="edit-form">
              <input type="hidden" name="id" id="edit-id">
              <input type="hidden" name="type" id="edit-type">
              <div><label>رشته</label> <select id="edit-major" name="majorId" required></select></div>
              <div><label>مقطع</label> <select id="edit-degree" name="degreeId"></select></div>
              <div><label>وزارتخانه</label> <select id="edit-ministry" name="ministryId"></select></div>
              <div><label>سال کنکور</label> <select id="edit-examYear" name="examYearId"></select></div>
              <div><label>درس</label> <select id="edit-course" name="courseId" required></select></div>
              <div><label>منبع</label> <select id="edit-source" name="sourceId"></select></div>
              <div><label>فصل</label> <select id="edit-chapter" name="chapterId"></select></div>
              <div><label>صورت سوال</label><br><textarea id="edit-stem" name="stem" required rows="3" style="width:100%"></textarea></div>
              <div id="edit-options">
                <div><label>گزینه A</label><input id="edit-optA" name="optA" required style="width:100%"></div>
                <div><label>گزینه B</label><input id="edit-optB" name="optB" required style="width:100%"></div>
                <div><label>گزینه C</label><input id="edit-optC" name="optC" required style="width:100%"></div>
                <div><label>گزینه D</label><input id="edit-optD" name="optD" required style="width:100%"></div>
                <div>
                  <label>گزینه صحیح</label>
                  <select id="edit-correctLabel" name="correctLabel" required>
                    <option value="A">A</option><option value="B">B</option>
                    <option value="C">C</option><option value="D">D</option>
                  </select>
                </div>
              </div>
              <div><label>پاسخنامه تشریحی</label><br><textarea id="edit-expl" name="expl" rows="3" style="width:100%"></textarea></div>
              <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px">
                <button type="button" id="edit-cancel">انصراف</button>
                <button type="submit">ذخیره</button>
              </div>
            </form>
          </dialog>
        </div>
      </div>

      <script>
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

        // helpers
        async function fillSelect(id, url, valueKey = "id", labelKey = "name", selectedValue) {
          const el = document.getElementById(id);
          el.innerHTML = "";
          const res = await fetch(url);
          const items = await res.json();
          for (const it of items) {
            const opt = document.createElement("option");
            opt.value = it[valueKey];
            opt.textContent = it[labelKey];
            if (typeof selectedValue !== "undefined" && String(opt.value) === String(selectedValue)) {
              opt.selected = true;
            }
            el.appendChild(opt);
          }
          if (typeof selectedValue !== "undefined" && el.options.length) {
            const hasSelected = Array.from(el.options).some(o => o.selected);
            if (!hasSelected) {
              const placeholder = document.createElement("option");
              placeholder.value = "";
              placeholder.textContent = "یک گزینه را انتخاب کنید";
              placeholder.disabled = true;
              placeholder.selected = true;
              el.insertBefore(placeholder, el.firstChild);
            }
          }
        }
        async function initCascades(rootId) {
          await fillSelect(rootId+"-major", "/api/taxonomy/majors");
          await fillSelect(rootId+"-degree", "/api/taxonomy/degrees");
          await fillSelect(rootId+"-ministry", "/api/taxonomy/ministries");
          await fillSelect(rootId+"-examYear", "/api/taxonomy/exam-years");

          const upd = async () => {
            const majorId = document.getElementById(rootId+"-major").value;
            await fillSelect(rootId+"-course", "/api/taxonomy/courses?majorId=" + majorId);
            const courseId = document.getElementById(rootId+"-course").value;
            await fillSelect(rootId+"-source", "/api/taxonomy/sources?courseId=" + courseId);
            const sourceId = document.getElementById(rootId+"-source").value;
            await fillSelect(rootId+"-chapter", "/api/taxonomy/chapters?sourceId=" + sourceId);
          };
          document.getElementById(rootId+"-major").addEventListener("change", upd);
          document.getElementById(rootId+"-course").addEventListener("change", async () => {
            const courseId = document.getElementById(rootId+"-course").value;
            await fillSelect(rootId+"-source", "/api/taxonomy/sources?courseId=" + courseId);
          });
          document.getElementById(rootId+"-source").addEventListener("change", async () => {
            const sourceId = document.getElementById(rootId+"-source").value;
            await fillSelect(rootId+"-chapter", "/api/taxonomy/chapters?sourceId=" + sourceId);
          });
          await new Promise(r => setTimeout(r, 120));
          await upd();
        }
        function wireForm(formId, echoId) {
          const form = document.getElementById(formId);
          form.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const fd = new FormData(form);
            const res = await fetch(form.action, { method: "POST", body: fd });
            const data = await res.json();
            document.getElementById(echoId).textContent = JSON.stringify(data, null, 2);
            // فرم را خالی نکن تا بشود سریع چندتا پشت سر هم ساخت
          });
        }

        // راه‌اندازی هر سه فرم
        initCascades("k"); wireForm("form-k", "echo-konkur");
        initCascades("t"); wireForm("form-t", "echo-talifi");
        initCascades("q"); wireForm("form-q", "echo-qa");
        initCascades("edit");

        const editDialog = document.getElementById("edit-dialog");
        const editForm = document.getElementById("edit-form");
        const editCancel = document.getElementById("edit-cancel");
        const editOptions = document.getElementById("edit-options");

        editCancel.addEventListener("click", () => {
          if (typeof editDialog.close === "function") editDialog.close();
          else editDialog.style.display = "none";
        });

        function toggleEditOptions(type) {
          const isQA = type === "qa";
          editOptions.style.display = isQA ? "none" : "block";
          editOptions.querySelectorAll("input, select").forEach(el => {
            if (el.tagName === "INPUT" || el.tagName === "SELECT") {
              el.required = !isQA;
            }
          });
        }

        async function populateEditTaxonomy(q) {
          await fillSelect("edit-major", "/api/taxonomy/majors", "id", "name", q.majorId);
          await fillSelect("edit-degree", "/api/taxonomy/degrees", "id", "name", q.degreeId);
          await fillSelect("edit-ministry", "/api/taxonomy/ministries", "id", "name", q.ministryId);
          await fillSelect("edit-examYear", "/api/taxonomy/exam-years", "id", "name", q.examYearId);

          const majorSel = document.getElementById("edit-major");
          const courseUrl = "/api/taxonomy/courses?majorId=" + encodeURIComponent(majorSel.value || q.majorId || "");
          await fillSelect("edit-course", courseUrl, "id", "name", q.courseId);

          const courseSel = document.getElementById("edit-course");
          const sourceUrl = "/api/taxonomy/sources?courseId=" + encodeURIComponent(courseSel.value || q.courseId || "");
          await fillSelect("edit-source", sourceUrl, "id", "name", q.sourceId);

          const sourceSel = document.getElementById("edit-source");
          const chapterUrl = "/api/taxonomy/chapters?sourceId=" + encodeURIComponent(sourceSel.value || q.sourceId || "");
          await fillSelect("edit-chapter", chapterUrl, "id", "name", q.chapterId);
        }

        async function openEdit(type, id) {
          const res = await fetch('/api/admin/question?type=' + type + '&id=' + encodeURIComponent(id));
          const data = await res.json();
          if (!data.ok) {
            alert(data.error || "خطا در دریافت اطلاعات سوال");
            return;
          }
          const q = data.data;
          document.getElementById("edit-id").value = q.id;
          document.getElementById("edit-type").value = q.type;
          document.getElementById("edit-stem").value = q.stem || "";
          document.getElementById("edit-expl").value = q.expl || "";

          await populateEditTaxonomy(q);
          toggleEditOptions(q.type);

          if (q.options && q.options.length) {
            const map = new Map(q.options.map(o => [o.label, o.text]));
            document.getElementById("edit-optA").value = map.get("A") || "";
            document.getElementById("edit-optB").value = map.get("B") || "";
            document.getElementById("edit-optC").value = map.get("C") || "";
            document.getElementById("edit-optD").value = map.get("D") || "";
          } else {
            document.getElementById("edit-optA").value = "";
            document.getElementById("edit-optB").value = "";
            document.getElementById("edit-optC").value = "";
            document.getElementById("edit-optD").value = "";
          }
          document.getElementById("edit-correctLabel").value = q.correctLabel || "A";

          if (typeof editDialog.showModal === "function") editDialog.showModal();
          else editDialog.style.display = "block";
        }

        editForm.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const fd = new FormData(editForm);
          const type = fd.get("type");
          const id = fd.get("id");
          if (!type || !id) {
            alert("نوع یا شناسه موجود نیست");
            return;
          }
          const res = await fetch('/api/admin/question/update?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id), {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          if (!data.ok) {
            alert(data.error || "ویرایش انجام نشد");
            return;
          }
          if (typeof editDialog.close === "function") editDialog.close();
          else editDialog.style.display = "none";
          loadManageList();
        });

        // مدیریت
        const manageForm = document.getElementById("m-form");
        const manageStatus = document.getElementById("m-status");
        async function loadManageList() {
          const type = document.getElementById("m-type").value;
          const id = document.getElementById("m-id").value.trim();
          const query = document.getElementById("m-query").value.trim();
          const params = new URLSearchParams({ type });
          if (id) params.set("id", id);
          if (query) params.set("query", query);
          manageStatus.textContent = "در حال جست‌وجو...";
          let data;
          try {
            const res = await fetch("/api/admin/questions?" + params.toString());
            data = await res.json();
          } catch (err) {
            manageStatus.textContent = "خطا در برقراری ارتباط";
            return;
          }
          const tb = document.getElementById("m-list");
          tb.innerHTML = "";
          if (!data.ok) {
            manageStatus.textContent = "خطا: " + (data.error || "نامشخص");
            return;
          }
          manageStatus.textContent = "";
          if (!Array.isArray(data.data) || data.data.length === 0) {
            manageStatus.textContent = "موردی یافت نشد";
            return;
          }
          for (const it of data.data) {
            const tr = document.createElement("tr");
            tr.innerHTML = "<td>"+it.id+"</td><td>"+(it.stem?.slice(0,120) || "")+"</td><td>"+it.type+"</td><td></td>";
            const actions = tr.lastChild;

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.textContent = "ویرایش";
            editBtn.style.marginInlineEnd = "6px";
            editBtn.onclick = () => openEdit(it.type, it.id);
            actions.appendChild(editBtn);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.textContent = "حذف";
            delBtn.onclick = async () => {
              if (!confirm("حذف این آیتم؟")) return;
              await fetch("/api/admin/question/delete?type="+type+"&id="+encodeURIComponent(it.id), { method: "DELETE" });
              loadManageList();
            };
            actions.appendChild(delBtn);
            tb.appendChild(tr);
          }
        }
        manageForm.addEventListener("submit", (ev) => {
          ev.preventDefault();
          loadManageList();
        });
      </script>
    `;
    return html(page("ادمین", body));
  }

  return null;
}

function optionalField(fd: FormData, key: string): string | undefined {
  const val = fd.get(key);
  if (val === null) return undefined;
  const str = String(val);
  return str ? str : undefined;
}

function formToQuestionPayload(fd: FormData, type: QuestionType): Omit<Question, "id"|"createdAt"> {
  const payload: Omit<Question, "id"|"createdAt"> = {
    type,
    majorId: String(fd.get("majorId") || ""),
    courseId: String(fd.get("courseId") || ""),
    stem: String(fd.get("stem") || ""),
  };

  payload.degreeId = optionalField(fd, "degreeId");
  payload.ministryId = optionalField(fd, "ministryId");
  payload.examYearId = optionalField(fd, "examYearId");
  payload.sourceId = optionalField(fd, "sourceId");
  payload.chapterId = optionalField(fd, "chapterId");
  payload.expl = optionalField(fd, "expl");

  if (type !== "qa") {
    payload.options = [
      { label: "A", text: String(fd.get("optA") || "") },
      { label: "B", text: String(fd.get("optB") || "") },
      { label: "C", text: String(fd.get("optC") || "") },
      { label: "D", text: String(fd.get("optD") || "") },
    ];
    payload.correctLabel = String(fd.get("correctLabel") || "A") as Question["correctLabel"];
  }

  return payload;
}

// فرم‌ساز
function formHtml(action: string, withOptions: boolean, root: "k"|"t"|"q") {
  return `
  <form id="form-${root}" method="post" action="${action}">
    <div><label>رشته</label> <select id="${root}-major" name="majorId" required></select></div>
    <div><label>مقطع</label> <select id="${root}-degree" name="degreeId"></select></div>
    <div><label>وزارتخانه</label> <select id="${root}-ministry" name="ministryId"></select></div>
    <div><label>سال کنکور</label> <select id="${root}-examYear" name="examYearId"></select></div>
    <div><label>درس</label> <select id="${root}-course" name="courseId" required></select></div>
    <div><label>منبع</label> <select id="${root}-source" name="sourceId"></select></div>
    <div><label>فصل</label> <select id="${root}-chapter" name="chapterId"></select></div>

    <div><label>صورت سوال</label><br><textarea name="stem" required rows="3" style="width:100%"></textarea></div>
    ${withOptions ? `
      <div><label>گزینه A</label><input name="optA" required style="width:100%"></div>
      <div><label>گزینه B</label><input name="optB" required style="width:100%"></div>
      <div><label>گزینه C</label><input name="optC" required style="width:100%"></div>
      <div><label>گزینه D</label><input name="optD" required style="width:100%"></div>
      <div>
        <label>گزینه صحیح</label>
        <select name="correctLabel" required>
          <option value="A">A</option><option value="B">B</option>
          <option value="C">C</option><option value="D">D</option>
        </select>
      </div>` : ``}
    <div><label>پاسخنامه تشریحی</label><br><textarea name="expl" rows="3" style="width:100%"></textarea></div>
    <button type="submit">ثبت</button>
  </form>`;
}

