// src/routes/student.ts
import { html, json, page } from "../lib/http";
import { getSessionUser } from "../lib/auth";
import { PLAN_CATALOG } from "../lib/billing";
import {
  formatUsageDateKey,
  getDailyUsageLimits,
  incrementUsageCounter,
  isLimitReached,
  readUsageCounters,
} from "../lib/usageLimits";
import {
  queryRandomQuestion, getQuestion, recordAnswer, upsertRating,
  chooseChallengeQuestion, listAnswersByClient, aggregateStatsFromLogs,
  createExamDraft, gradeExam, getExamReview, listQuestions
} from "../lib/dataStore";

export function routeStudent(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;
  const sessionPromise: Promise<Awaited<ReturnType<typeof getSessionUser>> | null> = env
    ? getSessionUser(req, env).then(user => {
        if (!user) return null;
        if (user.planTier !== "free" && user.planExpiresAt && user.planExpiresAt < Date.now()) {
          return { ...user, planTier: "free", planExpiresAt: null } as typeof user;
        }
        return user;
      })
    : Promise.resolve(null);

  function ensureSession(me: Awaited<typeof sessionPromise> | null) {
    if (!me) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    return null;
  }


  // --- API: سؤال تصادفی ---
  if (p === "/api/student/random" && req.method === "GET") {
    return (async () => {
      const me = await sessionPromise;
      const guard = ensureSession(me);
      if (guard) return guard;
      const type = ((url.searchParams.get("type") || "konkur") as "konkur"|"talifi"|"qa");
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
      let counters;
      let dayKey: string | null = null;
      if (type === "talifi") {
        const limits = getDailyUsageLimits(me!.planTier);
        dayKey = formatUsageDateKey();
        counters = await readUsageCounters(env, me!.email, dayKey);
        if (isLimitReached(limits, "randomTalifi", counters, 1)) {
          return json({ ok: false, error: "usage_limit_reached", field: "randomTalifi" }, 429);
        }
      }
      const q = await queryRandomQuestion(env, type, filters);
      if (!q) return json({ ok: false, error: "no_question" }, 404);
      if (type === "talifi" && dayKey) {
        counters = await incrementUsageCounter(env, me!.email, dayKey, "randomTalifi", 1, counters);
      }

      const safe = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: (q.options || []).map(o => ({ label: o.label, text: o.text })),
        expl: (!q.options || q.options.length === 0) ? (q.expl || null) : null
      };
      return json({ ok: true, data: safe });
    })();
  }

  // --- API: ثبت پاسخ یک سؤال (تک‌سؤال/چالش) + امتیاز ---
  if (p === "/api/student/answer" && req.method === "POST") {
    return (async () => {
      try {
        const body = await req.json();
        const id = body?.id as string;
        const type = body?.type as "konkur"|"talifi"|"qa";
        const choice = body?.choice as "A"|"B"|"C"|"D"|undefined|null;
        const clientId = body?.clientId as string;
        const quality = body?.quality ? Number(body.quality) : undefined;
        const difficulty = body?.difficulty ? Number(body.difficulty) : undefined;
        const filters = body?.filters || undefined;

        if (!id || !type || !clientId) return json({ ok: false, error: "bad_request" }, 400);
        if (type !== "qa" && !choice) return json({ ok: false, error: "bad_request" }, 400);
        if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);

        const q = await getQuestion(env, type, id);
        if (!q) return json({ ok: false, error: "not_found" }, 404);

        if (type === "qa") {
          await upsertRating(env, id, quality, difficulty);
          return json({ ok: true, correct: null, correctLabel: null, expl: q.expl || null });
        }

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

      const safe = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: (q.options || []).map(o => ({ label: o.label, text: o.text })),
        expl: (!q.options || q.options.length === 0) ? (q.expl || null) : null
      };
      return json({ ok: true, data: safe });
    })();
  }

  // --- API: لیست/جستجوی پرسش‌های تشریحی ---
  if (p === "/api/student/qa/list" && req.method === "GET") {
    return (async () => {
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
      const majorId = url.searchParams.get("majorId");
      const courseId = url.searchParams.get("courseId");
      const query = (url.searchParams.get("query") || "").trim().toLowerCase();
      if (!majorId) return json({ ok: false, error: "majorId required" }, 400);

      const raw = await listQuestions(env, "qa", limit * 3);
      const filtered = raw.filter(it => {
        if (String(it.majorId) !== String(majorId)) return false;
        if (courseId && String(it.courseId || "") !== String(courseId)) return false;
        if (query) {
          const hay = ((it.stem || "") + " " + (it.expl || "")).toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      }).slice(0, limit);

      const safe = filtered.map(it => ({
        id: it.id,
        type: it.type,
        stem: it.stem,
        expl: it.expl || null,
        majorId: it.majorId,
        courseId: it.courseId,
        createdAt: it.createdAt
      }));

      return json({ ok: true, data: safe });
    })();
  }

  // --- API: آمار ---
  if (p === "/api/student/stats" && req.method === "GET") {
    return (async () => {
      const clientId = url.searchParams.get("clientId") || "";
      const window = url.searchParams.get("window") || "7d"; // 24h,3d,7d,1m,3m,6m,all
      if (!clientId) return json({ ok: false, error: "clientId required" }, 400);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      const logs = await listAnswersByClient(env, clientId, 1000);
      const stats = aggregateStatsFromLogs(logs, window);
      return json({ ok: true, data: stats });
    })();
  }

  // --- API: شروع آزمون (konkur | mixed | talifi) ---
  if (p === "/api/student/exam/start" && req.method === "POST") {
    return (async () => {
      try {
        const me = await sessionPromise;
        const guard = ensureSession(me);
        if (guard) return guard;
        const body = await req.json();
        const clientId = String(body?.clientId || "");
        const mode = (String(body?.mode || "konkur") as "konkur"|"mixed"|"talifi");
        const majorId = String(body?.majorId || "");
        const courseId = body?.courseId ? String(body.courseId) : "";
        const sourceId = body?.sourceId ? String(body.sourceId) : "";
        const chapterId = body?.chapterId ? String(body.chapterId) : "";
        const count = Math.max(5, Math.min(50, Number(body?.count || 20)));
        const durationMin = Math.max(1, Math.min(180, Number(body?.durationMin || 10)));

        if (!clientId) return json({ ok: false, error: "bad_request" }, 400);
        if (!majorId)  return json({ ok: false, error: "majorId required" }, 400);
        if ((mode === "konkur" || mode === "mixed") && !courseId) {
          return json({ ok: false, error: "courseId required" }, 400);
        }
        if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);

        const planLimits = getDailyUsageLimits(me!.planTier);
        const dayKey = formatUsageDateKey();
        let counters = await readUsageCounters(env, me!.email, dayKey);

        if (isLimitReached(planLimits, "exams", counters, 1)) {
          return json({ ok: false, error: "usage_limit_reached", field: "exams" }, 429);
        }
        if (mode === "talifi" && isLimitReached(planLimits, "talifiExams", counters, 1)) {
          return json({ ok: false, error: "usage_limit_reached", field: "talifiExams" }, 429);
        }

        if (mode === "talifi" && me!.planTier === "free") {
          const freeLimits = getDailyUsageLimits("free");
          if (freeLimits.maxTalifiQuestionsPerExamFree !== null && count > freeLimits.maxTalifiQuestionsPerExamFree) {
            return json({ ok: false, error: "talifi_question_limit" }, 400);
          }
        }

        const { id, questions, durationSec } = await createExamDraft(
          env,
          clientId,
          mode,
          { majorId, courseId: courseId || undefined, sourceId: sourceId || undefined, chapterId: chapterId || undefined },
          count,
          durationMin * 60
        );
        counters = await incrementUsageCounter(env, me!.email, dayKey, "exams", 1, counters);
        if (mode === "talifi") {
          counters = await incrementUsageCounter(env, me!.email, dayKey, "talifiExams", 1, counters);
        }
        return json({ ok: true, examId: id, questions, durationSec });
      } catch (e: any) {
        const msg = String(e?.message || e);
        return json({ ok: false, error: msg }, msg === "no_questions" ? 404 : 500);
      }
    })();
  }

  // --- API: ارسال پاسخ‌های آزمون ---
  if (p === "/api/student/exam/submit" && req.method === "POST") {
    return (async () => {
      try {
        const body = await req.json();
        const clientId = String(body?.clientId || "");
        const examId = String(body?.examId || "");
        const answers = Array.isArray(body?.answers) ? body.answers : [];
        if (!clientId || !examId) return json({ ok: false, error: "bad_request" }, 400);
        if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
        const res = await gradeExam(env, clientId, examId, answers);
        return json({ ok: true, result: res });
      } catch (e: any) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    })();
  }

  // --- API: پاسخنامه آزمون ---
  if (p === "/api/student/exam/review" && req.method === "GET") {
    return (async () => {
      const clientId = url.searchParams.get("clientId") || "";
      const examId = url.searchParams.get("examId") || "";
      if (!clientId || !examId) return json({ ok: false, error: "bad_request" }, 400);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      try {
        const review = await getExamReview(env, clientId, examId);
        return json({ ok: true, data: review });
      } catch (e:any) {
        return json({ ok: false, error: String(e?.message || e) }, 404);
      }
    })();
  }

  // --- صفحه دانشجو (۵ تب + پاسخنامه) ---
  if (p === "/student") {
    return (async () => {
      const me = await sessionPromise;
      const planCatalog = Object.entries(PLAN_CATALOG).map(([tier, plan]) => ({
        tier,
        title: plan.title,
        label: plan.label,
        months: plan.months,
        priceTomans: plan.priceTomans,
        description: plan.description,
        highlight: plan.highlight ?? false,
      }));
      const fmt = new Intl.NumberFormat("fa-IR");
      const planCards = planCatalog.map(plan => `
        <div class="plan-card${plan.highlight ? " highlight" : ""}">
          <div class="plan-label">${plan.label}</div>
          <div class="plan-title">${plan.title}</div>
          <div class="plan-price">${fmt.format(plan.priceTomans)} تومان</div>
          <div class="plan-desc muted">${plan.description}</div>
          <div class="plan-duration muted">مدت: ${plan.months} ماه</div>
          <button class="plan-buy" data-tier="${plan.tier}">پرداخت با زرین‌پال</button>
        </div>
      `).join("");
      const planMeta = {
        planTier: me?.planTier ?? "free",
        planExpiresAt: me?.planExpiresAt ?? null,
      };

      const body = `
      <style>
        .tabbar button{margin:0 4px;padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
        .tabbar button.active{background:#222;color:#fff;border-color:#222}
        .tabsec{display:none}
        .bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid #eee;margin-top:8px}
        .bar{width:6px;background:#888}
        .muted{color:#666}
        .hide{display:none}
        .plan-grid{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
        .plan-card{flex:1 1 240px;border:1px solid #ddd;border-radius:12px;padding:16px;background:#fff;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 2px rgba(0,0,0,0.05)}
        .plan-card.highlight{border-color:#2d7a46;background:#f3fff6}
        .plan-label{font-size:14px;color:#2d7a46;font-weight:600}
        .plan-title{font-size:18px;font-weight:700}
        .plan-price{font-size:22px;font-weight:700}
        .plan-card button{margin-top:auto}
      </style>

      <script id="plan-catalog" type="application/json">${JSON.stringify(planCatalog)}</script>
      <script id="plan-meta" type="application/json">${JSON.stringify(planMeta)}</script>

      <h1>صفحه دانشجو</h1>
      <div class="tabbar">
        <button data-tab="tab-single" class="active">تک‌سؤال‌ها</button>
        <button data-tab="tab-challenges">چالش‌ها</button>
        <button data-tab="tab-qa">پرسش‌های تشریحی</button>
        <button data-tab="tab-stats">آمار</button>
        <button data-tab="tab-exam">آزمون</button>
        <button data-tab="tab-plans">اشتراک</button>
      </div>

      <!-- تک‌سؤال‌ها -->
      <div class="card tabsec" id="tab-single" style="display:block">
        <b>گرفتن سؤال تصادفی</b>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end">
          <div><label>نوع</label>
            <select id="type">
              <option value="konkur">کنکور</option>
              <option value="talifi">تالیفی</option>
              <option value="qa">تشریحی</option>
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
        <b>سؤال‌های چالشی (سؤال‌هایی که قبلاً غلط زده‌ای)</b>
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

      <!-- پرسش‌های تشریحی -->
      <div class="card tabsec" id="tab-qa">
        <b>پرسش‌های تشریحی</b>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end">
          <div><label>رشته (الزامی)</label> <select id="qmajor" required></select></div>
          <div><label>درس</label> <select id="qcourse"></select></div>
          <div><label>جستجو</label> <input id="qquery" type="text" placeholder="کلیدواژه" style="width:180px"></div>
          <button id="qa-search">جستجو</button>
          <button id="qa-random">نمایش تصادفی</button>
        </div>
        <div id="qa-empty" class="muted" style="margin-top:8px">برای شروع، رشته را انتخاب کن و جستجو را بزن یا «نمایش تصادفی» را امتحان کن.</div>
        <div id="qa-list" style="margin-top:8px; display:flex; flex-direction:column; gap:8px"></div>
      </div>

      <!-- آمار -->
      <div class="card tabsec" id="tab-stats">
        <b>آمار پاسخ‌ها</b>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          <label>بازه:</label>
          <select id="win">
            <option value="24h">24 ساعت گذشته</option>
            <option value="3d">3 روز گذشته</option>
            <option value="7d" selected>7 روز گذشته</option>
            <option value="1m">1 ماه گذشته</option>
            <option value="3m">3 ماه گذشته</option>
            <option value="6m">6 ماه گذشته</option>
            <option value="all">کل زمان</option>
          </select>
          <button id="sload">بارگذاری آمار</button>
        </div>
        <div id="sout" style="margin-top:8px" class="muted">برای مشاهده، «بارگذاری آمار» را بزن.</div>
        <div id="chart" class="bars"></div>
      </div>

      <!-- آزمون -->
      <div class="card tabsec" id="tab-exam">
        <b>آزمون</b>
        <div id="exam-setup" style="display:block">
          <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap">
            <div><label>نوع آزمون</label>
              <select id="x-mode">
                <option value="konkur">کنکور</option>
                <option value="mixed">ترکیبی (کنکور+تالیفی)</option>
                <option value="talifi">تالیفی</option>
              </select>
            </div>
            <div><label>رشته (الزامی)</label> <select id="x-major" required></select></div>
            <div id="x-course-wrap"><label>درس</label> <select id="x-course"></select></div>
            <div id="x-source-wrap" class="hide"><label>منبع</label> <select id="x-source"></select></div>
            <div id="x-chapter-wrap" class="hide"><label>فصل</label> <select id="x-chapter"></select></div>
            <div><label>تعداد سؤال</label> <input id="x-count" type="number" min="5" max="50" value="10" style="width:90px"></div>
            <div><label>مدت (دقیقه)</label> <input id="x-min" type="number" min="1" max="180" value="10" style="width:90px"></div>
            <button id="x-start">شروع آزمون</button>
          </div>
          <div class="muted" style="margin-top:6px">در ترکیبی، ۱۰–۶۰٪ سؤالات از کنکور هستند (در صورت کمبود داده، نسبت خودکار تنظیم می‌شود).</div>
        </div>

        <div id="exam-box" style="display:none">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <div>سؤال <span id="x-idx">1</span>/<span id="x-total">0</span></div>
            <div>زمان: <span id="x-timer">00:00</span></div>
          </div>
          <div id="x-stem" style="font-weight:600;margin:10px 0"></div>
          <div id="x-opts"></div>
          <div style="margin-top:10px; display:flex; gap:8px">
            <button id="x-prev">قبلی</button>
            <button id="x-next">بعدی</button>
            <button id="x-submit" style="margin-right:auto">پایان آزمون</button>
          </div>
          <div id="x-msg" class="muted" style="margin-top:8px"></div>
        </div>

        <div id="exam-result" style="display:none" class="muted"></div>
        <button id="x-show-review" style="display:none; margin-top:8px">مشاهده پاسخنامه</button>
        <div id="review-box" style="display:none; margin-top:8px"></div>
      </div>

      <!-- اشتراک -->
      <div class="card tabsec" id="tab-plans">
        <b>انتخاب پلن اشتراک</b>
        <div class="muted" style="margin-top:6px">پرداخت از طریق درگاه امن زرین‌پال انجام می‌شود. پس از موفقیت، پلن به صورت خودکار فعال خواهد شد.</div>
        <div class="plan-grid">
          ${planCards}
        </div>
        <div id="plan-status" class="muted" style="margin-top:10px"></div>
      </div>

      <script>
        const $ = s => document.querySelector(s);

        const planCatalogEl = document.getElementById('plan-catalog');
        const planCatalog = planCatalogEl ? JSON.parse(planCatalogEl.textContent || '[]') : [];
        if (planCatalogEl) planCatalogEl.remove();
        const planMetaEl = document.getElementById('plan-meta');
        const planMeta = planMetaEl ? JSON.parse(planMetaEl.textContent || '{}') : {};
        if (planMetaEl) planMetaEl.remove();
        const planByTier = {};
        for (const p of planCatalog) planByTier[p.tier] = p;

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

        // helper برای دراپ‌داون‌ها
        async function fill(id, url, v="id", l="name", allowEmpty=true) {
          const el = $("#"+id); el.innerHTML = allowEmpty ? "<option value=''>--</option>" : "";
          const res = await fetch(url); const items = await res.json();
          for (const it of items) { const o=document.createElement("option"); o.value=it[v]; o.textContent=it[l]; el.appendChild(o); }
        }

        // ---------- تک‌سؤال‌ها ----------
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
          await upd();
          $("#major").addEventListener("change", upd);
          $("#course").addEventListener("change", async () => {
            const cid = $("#course").value || "";
            await fill("source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
          });
          $("#source").addEventListener("change", async () => {
            const sid = $("#source").value || "";
            await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          });
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
          const opts = q.options || [];
          if (opts.length) {
            for (const o of opts) {
              const btn = document.createElement("button");
              btn.textContent = o.label + ") " + o.text;
              btn.style.display = "block";
              btn.style.margin = "6px 0";
              btn.onclick = () => answer(q, o.label, "single");
              box.appendChild(btn);
            }
            $("#result").textContent = "";
          } else {
            const note = document.createElement("div");
            note.className = "muted";
            note.textContent = "این پرسش گزینه‌ای ندارد. برای مشاهده پاسخ تشریحی دکمه زیر را بزن.";
            box.appendChild(note);
            const btn = document.createElement("button");
            btn.textContent = "مشاهده پاسخ تشریحی";
            btn.style.display = "block";
            btn.style.margin = "6px 0";
            btn.onclick = () => answer(q, null, "single");
            box.appendChild(btn);
            const res = $("#result");
            res.textContent = "";
          }
          $("#nextBtn").onclick = () => fetchRandom();
          $("#qbox").dataset.id = q.id; $("#qbox").dataset.type = q.type; $("#qbox").dataset.expl = q.expl || "";
        }

        // ---------- چالش‌ها ----------
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
          await upd();
          $("#cmajor").addEventListener("change", upd);
          $("#ccourse").addEventListener("change", async () => {
            const cid = $("#ccourse").value || "";
            await fill("csource", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
          });
          $("#csource").addEventListener("change", async () => {
            const sid = $("#csource").value || "";
            await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
          });
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

        // ---------- پرسش‌های تشریحی ----------
        async function initCascadesQA() {
          await fill("qmajor", "/api/taxonomy/majors", "id", "name", false);
          const upd = async () => {
            const mid = $("#qmajor").value || "";
            await fill("qcourse", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid));
          };
          await upd();
          $("#qmajor").addEventListener("change", upd);
        }

        function makeRatingSelect() {
          const sel = document.createElement("select");
          sel.innerHTML = "<option value=''>--</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>";
          return sel;
        }

        function renderQaList(items) {
          const list = $("#qa-list");
          const empty = $("#qa-empty");
          list.innerHTML = "";
          if (!items || !items.length) {
            empty.style.display = "block";
            empty.textContent = "موردی یافت نشد.";
            return;
          }
          empty.style.display = "none";
          for (const it of items) {
            const wrap = document.createElement("div");
            wrap.className = "card";
            wrap.dataset.id = it.id;
            wrap.dataset.type = it.type || "qa";

            const stem = document.createElement("div");
            stem.style.fontWeight = "600";
            stem.textContent = it.stem;
            wrap.appendChild(stem);

            const controls = document.createElement("div");
            controls.style.display = "flex";
            controls.style.flexWrap = "wrap";
            controls.style.alignItems = "center";
            controls.style.gap = "6px";
            controls.style.marginTop = "6px";

            const qLabel = document.createElement("span");
            qLabel.textContent = "کیفیت:";
            const qSel = makeRatingSelect();
            const dLabel = document.createElement("span");
            dLabel.textContent = "سختی:";
            const dSel = makeRatingSelect();

            const btn = document.createElement("button");
            btn.textContent = "مشاهده پاسخ";

            const expl = document.createElement("div");
            expl.className = "muted";
            expl.style.marginTop = "6px";
            expl.style.display = "none";
            expl.innerHTML = it.expl || "";

            btn.addEventListener("click", () => revealQa(it, qSel, dSel, expl, btn));

            controls.appendChild(qLabel);
            controls.appendChild(qSel);
            controls.appendChild(dLabel);
            controls.appendChild(dSel);
            controls.appendChild(btn);

            wrap.appendChild(controls);
            wrap.appendChild(expl);
            list.appendChild(wrap);
          }
        }

        async function revealQa(item, qSel, dSel, explEl, btn) {
          if (explEl.dataset.revealed === "1") {
            explEl.style.display = "block";
            return;
          }
          if (btn.dataset.loading === "1") return;
          btn.dataset.loading = "1";
          const original = btn.textContent;
          btn.textContent = "در حال دریافت...";
          let explanation = item.expl || null;
          let success = false;
          try {
            const payload = { id: item.id, type: item.type || "qa", clientId };
            const qv = Number(qSel.value || "");
            const dv = Number(dSel.value || "");
            if (qv) payload.quality = qv;
            if (dv) payload.difficulty = dv;
            const res = await fetch("/api/student/answer", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || "error");
            if (data.expl != null) explanation = data.expl;
            success = true;
          } catch (e) {
            if (!explanation) {
              btn.textContent = original;
              delete btn.dataset.loading;
              alert("خطا در دریافت پاسخ تشریحی");
              return;
            }
          }
          explEl.innerHTML = explanation || "پاسخی برای این پرسش ثبت نشده است.";
          explEl.style.display = "block";
          explEl.dataset.revealed = "1";
          delete btn.dataset.loading;
          btn.disabled = true;
          btn.textContent = success ? "پاسخ نمایش داده شد" : "پاسخ بدون ثبت";
        }

        async function loadQaList() {
          const majorId = $("#qmajor").value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const courseId = $("#qcourse").value;
          const query = $("#qquery").value.trim();
          const params = new URLSearchParams({ majorId });
          if (courseId) params.set("courseId", courseId);
          if (query) params.set("query", query);
          $("#qa-empty").style.display = "block";
          $("#qa-empty").textContent = "در حال جستجو...";
          const res = await fetch("/api/student/qa/list?"+params.toString());
          const d = await res.json();
          if (!d.ok) {
            $("#qa-list").innerHTML = "";
            $("#qa-empty").style.display = "block";
            $("#qa-empty").textContent = d.error || "خطا در دریافت داده";
            return;
          }
          renderQaList(d.data || []);
        }

        async function fetchRandomQa() {
          const majorId = $("#qmajor").value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const courseId = $("#qcourse").value;
          const params = new URLSearchParams({ type: "qa", majorId });
          if (courseId) params.set("courseId", courseId);
          const res = await fetch("/api/student/random?"+params.toString());
          const d = await res.json();
          if (!d.ok) { alert("پرسش تشریحی پیدا نشد."); return; }
          renderQaList([d.data]);
        }

        async function answer(q, choice, mode) {
          const quality = Number((mode==="single" ? $("#quality").value : $("#cquality").value) || "") || undefined;
          const difficulty = Number((mode==="single" ? $("#difficulty").value : $("#cdifficulty").value) || "") || undefined;
          const filters = mode==="single" ? currentFiltersSingle() : currentFiltersChallenge();
          const payload = { id: q.id, type: q.type, clientId, quality, difficulty, filters };
          if (choice) { payload.choice = choice; }
          const res = await fetch("/api/student/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          const d = await res.json();
          const target = (mode==="single") ? "#result" : "#cresult";
          if (!d.ok) { document.querySelector(target).textContent = "خطا."; return; }
          if (q.type === "qa" || !choice) {
            const html = d.expl ? "<div style='margin-top:6px'>"+d.expl+"</div>" : "پاسخی برای این پرسش ثبت نشده است.";
            document.querySelector(target).innerHTML = html;
            if (mode==="single") { seenAdd(q.id); }
            return;
          }
          const html = (d.correct? "✅ درست": "❌ غلط") + (d.correctLabel? " — گزینه صحیح: " + d.correctLabel : "") + (d.expl? "<div style='margin-top:6px'>"+d.expl+"</div>": "");
          document.querySelector(target).innerHTML = html;
          if (mode==="single") { seenAdd(q.id); }
        }

        // ---------- آمار ----------
        function bars(container, series) {
          const el = $("#"+container); el.innerHTML = "";
          if (!series || !series.points || !series.points.length) return;
          const max = Math.max(...series.points.map(p => p.total), 1);
          for (const p of series.points) {
            const h = Math.round((p.total / max) * 120);
            const bar = document.createElement("div");
            bar.className = "bar";
            bar.style.height = h+"px";
            bar.title = new Date(p.t).toLocaleString() + " → " + p.total;
            el.appendChild(bar);
          }
        }
        async function loadStats() {
          const win = $("#win").value;
          const res = await fetch("/api/student/stats?clientId="+encodeURIComponent(clientId)+"&window="+encodeURIComponent(win));
          const d = await res.json();
          if (!d.ok) { $("#sout").textContent = "خطا در دریافت آمار"; return; }
          const s = d.data;
          $("#sout").innerHTML = [
            "کل پاسخ‌ها: "+s.total,
            "درست: "+s.correct,
            "غلط: "+s.wrong,
            (s.acc!=null ? "دقت: "+s.acc+"%" : "")
          ].filter(Boolean).join(" — ")
          + "<br/>[کنکور] کل: "+s.byType.konkur.total+"، دقت: "+(s.byType.konkur.acc??"-")+"%"
          + " | [تالیفی] کل: "+s.byType.talifi.total+"، دقت: "+(s.byType.talifi.acc??"-")+"%";
          bars("chart", s.series);
        }

        // ---------- آزمون ----------
        async function initCascadesExam() {
          await fill("x-major", "/api/taxonomy/majors", "id", "name", false);
          const upd = async () => {
            const mid = $("#x-major").value || "";
            await fill("x-course", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid), "id", "name", true);
            const cid = $("#x-course").value || "";
            await fill("x-source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid), "id", "name", true);
            const sid = $("#x-source").value || "";
            await fill("x-chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid), "id", "name", true);
          };
          await upd();
          $("#x-major").addEventListener("change", upd);
          $("#x-course").addEventListener("change", async () => {
            const cid = $("#x-course").value || "";
            await fill("x-source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid), "id", "name", true);
          });
          $("#x-source").addEventListener("change", async () => {
            const sid = $("#x-source").value || "";
            await fill("x-chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid), "id", "name", true);
          });
        }

        function toggleExamFields() {
          const mode = $("#x-mode").value;
          // برای konkur/mixed: course الزامی؛ برای talifi اختیاری + source/chapter نمایش داده شوند
          $("#x-course-wrap").classList.toggle("hide", mode === "talifi");
          $("#x-source-wrap").classList.toggle("hide", mode !== "talifi");
          $("#x-chapter-wrap").classList.toggle("hide", mode !== "talifi");
        }

        let exam = null;
        let lastExamId = null;

        function fmt(sec){ const m = Math.floor(sec/60), s = sec%60; return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); }
        function renderExam() {
          if (!exam) return;
          $("#exam-setup").style.display = "none";
          $("#exam-box").style.display = "block";
          $("#exam-result").style.display = "none";
          $("#x-show-review").style.display = "none";
          $("#review-box").style.display = "none";
          $("#review-box").innerHTML = "";
          $("#x-total").textContent = String(exam.questions.length);
          $("#x-idx").textContent = String(exam.idx+1);
          $("#x-timer").textContent = fmt(exam.tLeft);
          const q = exam.questions[exam.idx];
          $("#x-stem").textContent = q.stem;
          const box = $("#x-opts"); box.innerHTML = "";
          const chosen = exam.answers[q.id] || null;
          for (const o of (q.options || [])) {
            const b = document.createElement("button");
            b.textContent = o.label+") "+o.text; b.style.display="block"; b.style.margin="6px 0";
            if (chosen === o.label) { b.style.outline="2px solid #222"; }
            b.onclick = () => { exam.answers[q.id] = o.label; renderExam(); };
            box.appendChild(b);
          }
          $("#x-msg").textContent = chosen ? ("پاسخ انتخابی: "+chosen) : "بدون پاسخ";
        }
        function tick() {
          if (!exam) return;
          exam.tLeft--;
          $("#x-timer").textContent = fmt(exam.tLeft);
          if (exam.tLeft <= 0) submitExam();
        }
        async function startExam() {
          const mode = $("#x-mode").value;
          const majorId = $("#x-major").value;
          const courseId = $("#x-course").value;
          const sourceId = $("#x-source").value;
          const chapterId = $("#x-chapter").value;
          const count = Number($("#x-count").value || 10);
          const durationMin = Number($("#x-min").value || 10);
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          if ((mode==="konkur" || mode==="mixed") && !courseId) { alert("برای کنکور/ترکیبی باید درس را انتخاب کنی."); return; }
          const res = await fetch("/api/student/exam/start", {
            method: "POST", headers: {"content-type":"application/json"},
            body: JSON.stringify({ clientId, mode, majorId, courseId, sourceId, chapterId, count, durationMin })
          });
          const d = await res.json();
          if (!d.ok) { alert(d.error || "خطا در شروع آزمون"); return; }
          exam = { examId: d.examId, questions: d.questions, durationSec: d.durationSec, idx: 0, answers: {}, tLeft: d.durationSec, timer: null };
          renderExam();
          if (exam.timer) clearInterval(exam.timer);
          exam.timer = setInterval(tick, 1000);
        }
        function prevQ(){ if (!exam) return; if (exam.idx>0){ exam.idx--; renderExam(); } }
        function nextQ(){ if (!exam) return; if (exam.idx<exam.questions.length-1){ exam.idx++; renderExam(); } }
        async function submitExam() {
          if (!exam) return;
          if (exam.timer) { clearInterval(exam.timer); exam.timer = null; }
          const answers = exam.questions.map(q => ({ id: q.id, type: q.type, choice: exam.answers[q.id] || null }));
          const res = await fetch("/api/student/exam/submit", {
            method: "POST", headers: {"content-type":"application/json"},
            body: JSON.stringify({ clientId, examId: exam.examId, answers })
          });
          const d = await res.json();
          if (!d.ok) { alert(d.error || "خطا در ارسال آزمون"); return; }
          $("#exam-box").style.display = "none";
          $("#exam-result").style.display = "block";
          const r = d.result;
          $("#exam-result").innerHTML = "نتیجه: "+
            "کل="+r.total+" — درست="+r.correct+" — غلط="+r.wrong+" — نزده="+r.blank+
            "<br>درصد بدون نمره منفی: "+r.percentNoNeg+"%"+
            "<br>درصد با نمره منفی (⅓-): "+r.percentWithNeg+"%";
          lastExamId = exam.examId;
          document.getElementById("x-show-review").style.display = "inline-block";
          document.getElementById("review-box").style.display = "none";
          document.getElementById("review-box").innerHTML = "";
          exam = null;
          $("#exam-setup").style.display = "block";
        }

        async function loadReview(){
          if (!lastExamId) { alert("آزمونی برای مرور موجود نیست."); return; }
          const r = await fetch("/api/student/exam/review?clientId="+encodeURIComponent(clientId)+"&examId="+encodeURIComponent(lastExamId));
          const d = await r.json();
          if (!d.ok) { alert(d.error || "خطا در دریافت پاسخنامه"); return; }
          const box = document.getElementById("review-box");
          box.style.display = "block";
          box.innerHTML = "";
          for (const it of d.data) {
            const wrap = document.createElement("div");
            wrap.className = "card";
            wrap.style.marginTop = "6px";

            const head = document.createElement("div");
            head.innerHTML = (it.isCorrect===true ? "✅" : it.isCorrect===false ? "❌" : "⬜️") + " " + it.stem;
            head.style.fontWeight = "600";
            wrap.appendChild(head);

            const opts = document.createElement("div");
            for (const o of (it.options||[])) {
              const line = document.createElement("div");
              let text = o.label + ") " + o.text;
              if (it.userChoice === o.label) text += "  ← پاسخ شما";
              if (it.correctLabel === o.label) text += "  (گزینه صحیح)";
              line.textContent = text;
              opts.appendChild(line);
            }
            wrap.appendChild(opts);

            if (it.expl) {
              const ex = document.createElement("div");
              ex.style.marginTop = "6px";
              ex.className = "muted";
              ex.innerHTML = "پاسخ تشریحی: " + it.expl;
              wrap.appendChild(ex);
            }
            box.appendChild(wrap);
          }
          // اسکرول به پاسخنامه
          document.getElementById("x-show-review").scrollIntoView({ behavior: "smooth", block: "center" });
        }

        function initPlans() {
          const statusEl = document.getElementById('plan-status');
          if (statusEl) {
            if (!planMeta || planMeta.planTier === 'free') {
              statusEl.textContent = 'پلن فعلی: رایگان. برای دسترسی کامل یکی از پلن‌ها را فعال کن.';
            } else {
              const info = planByTier[planMeta.planTier] || null;
              let text = 'پلن فعلی: ' + (info ? info.title : planMeta.planTier);
              if (planMeta.planExpiresAt) {
                try {
                  const fa = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long' }).format(new Date(planMeta.planExpiresAt));
                  text += ' — اعتبار تا ' + fa;
                } catch {
                  text += ' — اعتبار تا ' + new Date(planMeta.planExpiresAt).toLocaleDateString('fa-IR');
                }
              }
              statusEl.textContent = text;
            }
          }

          document.querySelectorAll('.plan-buy').forEach(btn => {
            btn.addEventListener('click', async () => {
              const tier = btn.dataset.tier;
              const info = tier ? planByTier[tier] : null;
              if (!tier || !info) {
                alert('پلن انتخابی معتبر نیست.');
                return;
              }
              const confirmMsg = 'آیا می‌خواهی پرداخت پلن «' + info.title + '» آغاز شود؟';
              if (!confirm(confirmMsg)) return;
              btn.disabled = true;
              const original = btn.textContent;
              btn.textContent = 'در حال ایجاد لینک...';
              if (statusEl) statusEl.textContent = 'در حال ارتباط با زرین‌پال...';
              try {
                const res = await fetch('/api/billing/zarinpal/create', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ planTier: tier })
                });
                const data = await res.json();
                if (!data.ok || !data.payUrl) {
                  const msg = data.error || 'خطا در ایجاد تراکنش';
                  throw new Error(msg);
                }
                if (statusEl) statusEl.textContent = 'در حال انتقال به درگاه امن زرین‌پال...';
                location.href = data.payUrl;
              } catch (err) {
                btn.disabled = false;
                btn.textContent = original;
                const msg = err?.message || String(err) || 'خطا رخ داد';
                if (statusEl) statusEl.textContent = 'خطا: ' + msg;
              }
            });
          });
        }

        // رویدادها
        $("#fetchBtn").addEventListener("click", fetchRandom);
        $("#cfetchBtn").addEventListener("click", fetchChallenge);
        $("#qa-search").addEventListener("click", loadQaList);
        $("#qa-random").addEventListener("click", fetchRandomQa);
        $("#sload").addEventListener("click", loadStats);
        $("#x-start").addEventListener("click", startExam);
        $("#x-prev").addEventListener("click", prevQ);
        $("#x-next").addEventListener("click", nextQ);
        $("#x-submit").addEventListener("click", submitExam);
        document.getElementById("x-show-review").addEventListener("click", loadReview);

        // تغییر فیلدهای آزمون بر اساس mode (JS خالص)
        const xmodeEl = document.getElementById("x-mode");
        if (xmodeEl) xmodeEl.addEventListener("change", toggleExamFields);

        async function initAll(){
          await initCascadesSingle();
          await initCascadesChallenge();
          await initCascadesQA();
          await initCascadesExam();
          toggleExamFields();
          initPlans();
        }
        initAll();
      </script>
    `;
      return html(page("دانشجو", body));
    })();
  }

  return null;
}
