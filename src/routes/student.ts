// src/routes/student.ts
import { html, json, page } from "../lib/http";
import { requireRole, type SessionPayload } from "../lib/auth";
import { PLAN_CATALOG, getPlanDefinition, type PlanDefinition, type PlanTier } from "../lib/billing";
import {
  queryRandomQuestion, getQuestion, recordAnswer, upsertRating,
  chooseChallengeQuestion, listAnswersByClient, aggregateStatsFromLogs,
  createExamDraft, gradeExam, getExamReview, listQuestions,
  type ChoiceLabel
} from "../lib/dataStore";
import { consumeUsage, describeUsageForPlan, getUsageSnapshots } from "../lib/usage";

const TALIFI_COMBO_ACTION = "combo:talifi_challenge";

type QuotaRecord = { action: string; remaining: number | null; limit: number | null };

type UsageLimitOptions = {
  env: any;
  email: string;
  primaryAction: string;
  primaryLimit: number | null | undefined;
  primaryExceededMessage: string;
  fallbackExceededMessage: string;
  comboLimit?: number | null | undefined;
  comboExceededMessage?: string;
};

async function enforceUsageLimits(options: UsageLimitOptions): Promise<{ quotaRecord: QuotaRecord | null; error: Response | null }> {
  const {
    env,
    email,
    primaryAction,
    primaryLimit,
    primaryExceededMessage,
    fallbackExceededMessage,
    comboLimit,
    comboExceededMessage,
  } = options;

  const increments = [] as Parameters<typeof consumeUsage>[2];
  if (primaryLimit !== null && primaryLimit !== undefined) {
    increments.push({ action: primaryAction, limit: primaryLimit });
  }
  if (comboLimit !== null && comboLimit !== undefined) {
    increments.push({ action: TALIFI_COMBO_ACTION, limit: comboLimit });
  }

  if (increments.length === 0) {
    return { quotaRecord: null, error: null };
  }

  const usage = await consumeUsage(env, email, increments);
  if (!usage.ok) {
    const quota = { action: usage.action, remaining: usage.remaining, limit: usage.limit };
    if (usage.action === primaryAction) {
      return { quotaRecord: null, error: quotaError(primaryExceededMessage, { quota }) };
    }
    if (usage.action === TALIFI_COMBO_ACTION) {
      return {
        quotaRecord: null,
        error: quotaError(comboExceededMessage || fallbackExceededMessage, { quota }),
      };
    }
    return { quotaRecord: null, error: quotaError(fallbackExceededMessage, { quota }) };
  }

  const record = usage.records.find((r) => r.action === primaryAction) || null;
  if (!record) {
    return { quotaRecord: null, error: null };
  }

  return { quotaRecord: { action: record.action, remaining: record.remaining, limit: record.limit }, error: null };
}

type StudentContext = {
  session: SessionPayload;
  plan: PlanDefinition & { tier: PlanTier };
};

type PlanUsageSummary = {
  action: string;
  label: string;
  remaining: number | null;
  limit: number | null;
};

type PlanMeta = {
  planTier: PlanTier;
  planExpiresAt: number | null;
  dailyLimits: PlanDefinition["dailyLimits"] | null;
  featureFlags: PlanDefinition["featureFlags"] | null;
  usage: PlanUsageSummary[];
  talifiExamMaxQuestions: number | null;
  statsAccess: boolean;
};

function resolvePlanDefinition(tier: string | null | undefined): (PlanDefinition & { tier: PlanTier }) {
  const plan = getPlanDefinition(tier);
  if (plan) return plan;
  const fallback = getPlanDefinition("free");
  if (!fallback) {
    throw new Error("missing free plan definition");
  }
  return fallback;
}

async function buildPlanMeta(env: any, ctx: StudentContext): Promise<PlanMeta> {
  const { session, plan } = ctx;
  const usageDescriptors = describeUsageForPlan(plan);
  let usageSummary: PlanUsageSummary[] = [];
  if (env?.DATA && usageDescriptors.length) {
    const snapshots = await getUsageSnapshots(
      env,
      session.email,
      usageDescriptors.map((d) => ({ action: d.action, limit: d.limit })),
    );
    usageSummary = usageDescriptors
      .map((desc, idx) => {
        const snap = snapshots[idx];
        const limit = snap?.limit ?? (desc.limit ?? null);
        return {
          action: desc.action,
          label: desc.label,
          limit,
          remaining: snap?.remaining ?? (typeof limit === "number" ? Math.max(0, limit) : null),
        };
      })
      .filter((it) => it.limit != null);
  }

  const tier = session.planTier ?? plan.tier;

  return {
    planTier: tier,
    planExpiresAt: session?.planExpiresAt ?? null,
    dailyLimits: plan.dailyLimits ?? null,
    featureFlags: plan.featureFlags ?? null,
    usage: usageSummary,
    talifiExamMaxQuestions: plan.usageLimits?.exams.byMode.talifi?.maxQuestions ?? null,
    statsAccess: !!plan.usageLimits?.statsAccess,
  };
}

async function requireStudentContext(req: Request, env: any, opts?: { respondJson?: boolean }): Promise<StudentContext | Response> {
  const res = await requireRole(req, env, "student");
  if (res instanceof Response) {
    if (opts?.respondJson) {
      return json({ ok: false, error: "auth_required" }, 401);
    }
    return res;
  }
  const plan = resolvePlanDefinition(res.planTier);
  return { session: res, plan };
}

function quotaError(message: string, extra: { remaining?: number | null; limit?: number | null } = {}, status = 429) {
  return json({ ok: false, error: "quota_exceeded", message, ...extra }, status);
}

function featureLocked(message: string, status = 403) {
  return json({ ok: false, error: "feature_locked", message }, status);
}

export function routeStudent(req: Request, url: URL, env?: any): Response | null {
  const p = url.pathname;

  // --- API: سؤال تصادفی ---
  if (p === "/api/student/random" && req.method === "GET") {
    return (async () => {
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
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
      const usageLimit = ctx.plan.usageLimits?.randomFetches?.[type] ?? null;
      const comboLimit = type === "talifi"
        ? ctx.plan.usageLimits?.comboActions?.[TALIFI_COMBO_ACTION] ?? null
        : null;
      const {
        quotaRecord,
        error,
      } = await enforceUsageLimits({
        env,
        email: ctx.session.email,
        primaryAction: `random:${type}`,
        primaryLimit: usageLimit,
        primaryExceededMessage: type === "talifi"
          ? "سقف درخواست سؤال تالیفی برای امروز تمام شده است."
          : "سقف استفاده روزانه این بخش تمام شده است.",
        fallbackExceededMessage: "سقف استفاده روزانه این بخش تمام شده است.",
        comboLimit,
        comboExceededMessage: "سقف مشترک استفاده از سؤال‌های تالیفی و چالشی تالیفی به پایان رسیده است.",
      });
      if (error) return error;
      const q = await queryRandomQuestion(env, type, filters);
      if (!q) return json({ ok: false, error: "no_question" }, 404);

      const safe = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: (q.options || []).map(o => ({ label: o.label, text: o.text })),
        expl: (!q.options || q.options.length === 0) ? (q.expl || null) : null
      };
      return json({ ok: true, data: safe, quota: quotaRecord });
    })();
  }

  // --- API: ثبت پاسخ یک سؤال (تک‌سؤال/چالش) + امتیاز ---
  if (p === "/api/student/answer" && req.method === "POST") {
    return (async () => {
      try {
        const ctx = await requireStudentContext(req, env, { respondJson: true });
        if (ctx instanceof Response) return ctx;
        const body = await req.json();
        const id = body?.id as string;
        const type = body?.type as "konkur"|"talifi"|"qa";
        const choice = body?.choice as ChoiceLabel|undefined|null;
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
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
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
      const challengeCfg = ctx.plan.usageLimits?.challengeFetches;
      if (!challengeCfg?.enabled) {
        return featureLocked("این بخش در پلن فعلی فعال نیست.");
      }

      const q = await chooseChallengeQuestion(env, clientId, filters, type);
      if (!q) return json({ ok: false, error: "no_challenge" }, 404);
      const resolvedType: "konkur" | "talifi" = q.type === "talifi" ? "talifi" : "konkur";
      const limit = challengeCfg.perType?.[resolvedType] ?? null;
      const comboLimit = resolvedType === "talifi"
        ? ctx.plan.usageLimits?.comboActions?.[TALIFI_COMBO_ACTION] ?? null
        : null;
      const {
        quotaRecord,
        error,
      } = await enforceUsageLimits({
        env,
        email: ctx.session.email,
        primaryAction: `challenge:${resolvedType}`,
        primaryLimit: limit,
        primaryExceededMessage: "سقف سؤال‌های چالشی امروز تمام شده است.",
        fallbackExceededMessage: "سقف استفاده روزانه این بخش تمام شده است.",
        comboLimit,
        comboExceededMessage: "سقف مشترک استفاده از سؤال‌های تالیفی و چالشی تالیفی به پایان رسیده است.",
      });
      if (error) return error;

      const safe = {
        id: q.id,
        type: q.type,
        stem: q.stem,
        options: (q.options || []).map(o => ({ label: o.label, text: o.text })),
        expl: (!q.options || q.options.length === 0) ? (q.expl || null) : null
      };
      return json({ ok: true, data: safe, quota: quotaRecord });
    })();
  }

  // --- API: لیست/جستجوی پرسش‌های تشریحی ---
  if (p === "/api/student/qa/list" && req.method === "GET") {
    return (async () => {
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      if (!ctx.plan.featureFlags.qaBank) {
        return featureLocked("دسترسی به بانک تشریحی در پلن فعلی غیرفعال است.");
      }
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
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
      const clientId = url.searchParams.get("clientId") || "";
      const window = url.searchParams.get("window") || "7d"; // 24h,3d,7d,1m,3m,6m,all
      if (!clientId) return json({ ok: false, error: "clientId required" }, 400);
      if (!env?.DATA) return json({ ok: false, error: "DATA binding missing" }, 500);
      if (!ctx.plan.usageLimits?.statsAccess) {
        return featureLocked("آمار عملکرد در پلن فعلی فعال نیست.");
      }
      const logs = await listAnswersByClient(env, clientId, 1000);
      const stats = aggregateStatsFromLogs(logs, window);
      return json({ ok: true, data: stats });
    })();
  }

  // --- API: شروع آزمون (konkur | mixed | talifi) ---
  if (p === "/api/student/exam/start" && req.method === "POST") {
    return (async () => {
      try {
        const ctx = await requireStudentContext(req, env, { respondJson: true });
        if (ctx instanceof Response) return ctx;
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

        const usageCfg = ctx.plan.usageLimits?.exams;
        const increments: { action: string; limit: number | null | undefined }[] = [];
        if (usageCfg?.totalPerDay !== null && usageCfg?.totalPerDay !== undefined) {
          increments.push({ action: "exam:total", limit: usageCfg.totalPerDay });
        }
        if (mode === "konkur" && usageCfg?.byMode?.konkur !== null && usageCfg?.byMode?.konkur !== undefined) {
          increments.push({ action: "exam:konkur", limit: usageCfg.byMode.konkur });
        }
        if (mode === "mixed" && usageCfg?.byMode?.mixed !== null && usageCfg?.byMode?.mixed !== undefined) {
          increments.push({ action: "exam:mixed", limit: usageCfg.byMode.mixed });
        }
        if (mode === "talifi") {
          const talifiCfg = usageCfg?.byMode?.talifi;
          if (talifiCfg?.maxQuestions !== null && talifiCfg?.maxQuestions !== undefined && count > talifiCfg.maxQuestions) {
            return quotaError(`حداکثر ${talifiCfg.maxQuestions} سؤال برای هر آزمون تالیفی در پلن فعلی مجاز است.`, { limit: talifiCfg.maxQuestions }, 400);
          }
          if (talifiCfg?.perDay !== null && talifiCfg?.perDay !== undefined) {
            increments.push({ action: "exam:talifi", limit: talifiCfg.perDay });
          }
        }

        let quotaMeta: Record<string, { remaining: number | null; limit: number | null }> | null = null;
        if (increments.length) {
          const usage = await consumeUsage(env, ctx.session.email, increments);
          if (!usage.ok) {
            const msg = usage.action === "exam:talifi"
              ? "سقف آزمون‌های تالیفی امروز به پایان رسیده است."
              : "سقف تعداد آزمون‌های امروز پر شده است.";
            return quotaError(msg, { quota: { action: usage.action, remaining: usage.remaining, limit: usage.limit } });
          }
          quotaMeta = usage.records.reduce((acc, rec) => {
            acc[rec.action] = { remaining: rec.remaining, limit: rec.limit };
            return acc;
          }, {} as Record<string, { remaining: number | null; limit: number | null }>);
        }

        const { id, questions, durationSec } = await createExamDraft(
          env,
          clientId,
          mode,
          { majorId, courseId: courseId || undefined, sourceId: sourceId || undefined, chapterId: chapterId || undefined },
          count,
          durationMin * 60
        );
        return json({ ok: true, examId: id, questions, durationSec, quota: quotaMeta });
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
        const ctx = await requireStudentContext(req, env, { respondJson: true });
        if (ctx instanceof Response) return ctx;
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
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
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

  if (p === "/api/student/plan" && req.method === "GET") {
    return (async () => {
      const ctx = await requireStudentContext(req, env, { respondJson: true });
      if (ctx instanceof Response) return ctx;
      const meta = await buildPlanMeta(env, ctx);
      return json({ ok: true, data: meta });
    })();
  }

  // --- صفحه دانشجو (۵ تب + پاسخنامه) ---
  if (p === "/student") {
    return (async () => {
      if (!env) return page(html`<h1>Service configuration error</h1>`);
      const ctx = await requireStudentContext(req, env);
      if (ctx instanceof Response) return ctx;
      const me = ctx.session;
      const planCatalog = Object.entries(PLAN_CATALOG).map(([tier, plan]) => ({
        tier,
        ...plan,
      }));
      const featureFlagLabels = {
        qaBank: "بانک تشریحی",
        challengeHub: "چالش هوشمند",
        examBuilder: "ساخت آزمون",
        analytics: "گزارش‌گیری",
        prioritySupport: "پشتیبانی ویژه",
        aiCoach: "دستیار هوشمند",
      } as const;
      const fmt = new Intl.NumberFormat("fa-IR");
      const planCards = planCatalog.filter(plan => plan.tier !== "free").map(plan => {
        const featureItems = plan.features.map(f => `<li>${f}</li>`).join("");
        const tags = Object.entries(plan.featureFlags)
          .filter(([, enabled]) => !!enabled)
          .map(([key]) => featureFlagLabels[key as keyof typeof featureFlagLabels] ? `<span>${featureFlagLabels[key as keyof typeof featureFlagLabels]}</span>` : "")
          .filter(Boolean)
          .join("");
        const limits = plan.dailyLimits;
        const limitsText = `سقف روزانه: ${fmt.format(limits.randomQuestionsPerDay)} سؤال تصادفی • ${fmt.format(limits.challengeQuestionsPerDay)} سؤال چالشی • ${fmt.format(limits.examsPerDay)} آزمون • ${fmt.format(limits.qaSessionsPerDay)} مرور تشریحی`;
        const durations = (plan.available && plan.durations.length)
          ? `<div class="plan-durations">${plan.durations.map(duration => {
              const price = fmt.format(duration.priceTomans);
              const savings = duration.savingsLabel ? `<span class=\"plan-save\">${duration.savingsLabel}</span>` : "";
              return `<button class=\"plan-buy\" data-tier=\"${plan.tier}\" data-months=\"${duration.months}\" data-price=\"${duration.priceTomans}\" data-label=\"${duration.label}\"><span class=\"plan-buy-label\">${duration.label}</span><span class=\"plan-buy-price\">${price} تومان</span>${savings}</button>`;
            }).join("")}</div>`
          : `<div class="plan-coming-soon">${plan.comingSoonText || "به‌زودی"}</div>`;
        const badge = plan.highlight ? `<div class="plan-badge">پیشنهادی</div>` : "";
        const tagsBlock = tags ? `<div class="plan-tags">${tags}</div>` : "";
        return `
        <div class="plan-card${plan.highlight ? " highlight" : ""}${!plan.available ? " plan-disabled" : ""}">
          ${badge}
          <div class="plan-title">${plan.title}</div>
          <div class="plan-subtitle muted">${plan.subtitle}</div>
          <div class="plan-desc muted">${plan.description}</div>
          ${tagsBlock}
          <ul class="plan-features">${featureItems}</ul>
          <div class="plan-limits muted">${limitsText}</div>
          ${durations}
        </div>
        `;
      }).join("");
      const planMeta = await buildPlanMeta(env, ctx);
      const showChallengeTab = !!planMeta.featureFlags?.challengeHub;
      const showQaTab = !!planMeta.featureFlags?.qaBank;
      const showStatsTab = !!planMeta.statsAccess;

      const body = `
      <style>
        .tabbar button{margin:0 4px;padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer}
        .tabbar button.active{background:#222;color:#fff;border-color:#222}
        .tabsec{display:none}
        .tabbar button.feature-locked,.tabsec.feature-locked{display:none}
        .bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid #eee;margin-top:8px}
        .bar{width:6px;background:#888}
        .muted{color:#666}
        .hide{display:none}
        .dashboard-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
        .dashboard-header h1{margin:0}
        .logout-link{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid #ddd;background:#f7f7f7;color:#222;text-decoration:none;font-weight:600;transition:background .15s ease,color .15s ease,box-shadow .15s ease}
        .logout-link:hover{background:#ececec;color:#000}
        .logout-link:focus-visible{outline:3px solid #0b5ed7;outline-offset:2px;box-shadow:0 0 0 2px rgba(11,94,215,0.2)}
        .plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:12px}
        .plan-card{position:relative;border:1px solid #e1e1e1;border-radius:16px;padding:20px;background:#fff;display:flex;flex-direction:column;gap:10px;box-shadow:0 8px 18px rgba(0,0,0,0.05);transition:transform .15s ease, box-shadow .15s ease}
        .plan-card:hover{transform:translateY(-4px);box-shadow:0 12px 24px rgba(0,0,0,0.08)}
        .plan-card.highlight{border-color:#2d7a46;box-shadow:0 14px 28px rgba(45,122,70,0.18)}
        .plan-card.plan-disabled{border-style:dashed;background:#fafafa;box-shadow:none;transform:none}
        .plan-badge{position:absolute;top:16px;left:16px;background:#2d7a46;color:#fff;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600}
        .plan-title{font-size:20px;font-weight:700}
        .plan-subtitle{font-size:14px}
        .plan-desc{line-height:1.7}
        .plan-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
        .plan-tags span{background:#eef6ff;color:#0b5ed7;font-size:12px;padding:4px 8px;border-radius:999px}
        .plan-features{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
        .plan-features li{position:relative;padding-right:18px;font-size:14px;line-height:1.6}
        .plan-features li::before{content:"•";position:absolute;right:4px;color:#2d7a46;font-size:18px;line-height:1}
        .plan-limits{font-size:13px;line-height:1.6;margin-top:6px}
        .plan-durations{margin-top:10px;display:flex;flex-direction:column;gap:8px}
        .plan-buy{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;border:1px solid #2d7a46;background:#2d7a46;color:#fff;font-weight:600;cursor:pointer;transition:transform .15s ease, box-shadow .15s ease}
        .plan-buy:hover{transform:translateY(-2px);box-shadow:0 8px 16px rgba(45,122,70,0.25)}
        .plan-card.highlight .plan-buy{background:#1f5c34;border-color:#1f5c34}
        .plan-buy-label{flex:1;text-align:right}
        .plan-buy-price{font-size:16px}
        .plan-save{background:#fff;color:#1f5c34;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}
        .plan-coming-soon{margin-top:16px;padding:14px;border-radius:12px;background:#f1f1f1;text-align:center;font-weight:600;color:#444}
        #plan-status{margin-top:16px}
        #plan-status .plan-meta-limits{margin-top:6px;font-size:13px;color:#444}
        #plan-status .plan-meta-tags{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px}
        #plan-status .plan-meta-tags span{background:#eef6ff;color:#0b5ed7;padding:4px 8px;border-radius:999px;font-size:12px}
        #plan-status .plan-meta-usage{margin-top:6px;font-size:13px;color:#0b5ed7;display:flex;flex-direction:column;gap:2px}
        #plan-status .plan-meta-usage span strong{font-weight:600}
        #plan-status-msg{font-size:13px;margin-top:4px}
        #plan-status-msg.error{color:#b3261e;font-weight:600}
      </style>

      <script id="plan-catalog" type="application/json">${JSON.stringify(planCatalog)}</script>
      <script id="plan-meta" type="application/json">${JSON.stringify(planMeta)}</script>

      <header class="dashboard-header" role="banner">
        <h1>صفحه دانشجو</h1>
        <a class="logout-link" href="/logout">خروج از حساب</a>
      </header>
      <div class="tabbar">
        <button data-tab="tab-single" class="active">تک‌سؤال‌ها</button>
        <button data-tab="tab-challenges" data-requires-feature="challengeHub" class="${showChallengeTab ? "" : "feature-locked"}">چالش‌ها</button>
        <button data-tab="tab-qa" data-requires-feature="qaBank" class="${showQaTab ? "" : "feature-locked"}">پرسش‌های تشریحی</button>
        <button data-tab="tab-stats" data-requires-feature="statsAccess" class="${showStatsTab ? "" : "feature-locked"}">آمار</button>
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
          <div data-konkur-only><label>مقطع</label> <select id="degree"></select></div>
          <div data-konkur-only><label>وزارتخانه</label> <select id="ministry"></select></div>
          <div data-konkur-only><label>سال کنکور</label> <select id="examYear"></select></div>
          <div><label>درس</label> <select id="course"></select></div>
          <div data-talifi-only><label>منبع</label> <select id="source"></select></div>
          <div data-talifi-only><label>فصل</label> <select id="chapter"></select></div>
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
      <div class="card tabsec${showChallengeTab ? "" : " feature-locked"}" id="tab-challenges" data-requires-feature="challengeHub">
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
      <div class="card tabsec${showQaTab ? "" : " feature-locked"}" id="tab-qa" data-requires-feature="qaBank">
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
      <div class="card tabsec${showStatsTab ? "" : " feature-locked"}" id="tab-stats" data-requires-feature="statsAccess">
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
        <div id="plan-status" class="muted"></div>
        <div id="plan-status-msg" class="muted"></div>
      </div>

      <script>
        const $ = s => document.querySelector(s);

        const planCatalogEl = document.getElementById('plan-catalog');
        const planCatalog = planCatalogEl ? JSON.parse(planCatalogEl.textContent || '[]') : [];
        if (planCatalogEl) planCatalogEl.remove();
        const planMetaEl = document.getElementById('plan-meta');

        /**
         * @typedef {Object} PlanUsageSummary
         * @property {string} action
         * @property {string} label
         * @property {?number} remaining
         * @property {?number} limit
         */

        /**
         * @typedef {Object} PlanMeta
         * @property {string} planTier
         * @property {?number} planExpiresAt
         * @property {?Object} dailyLimits
         * @property {?Object} featureFlags
         * @property {PlanUsageSummary[]} usage
         * @property {?number} talifiExamMaxQuestions
         * @property {boolean} statsAccess
         */

        /** @type {PlanMeta|null} */
        let planMeta = planMetaEl ? JSON.parse(planMetaEl.textContent || '{}') : null;
        if (planMetaEl) planMetaEl.remove();
        const planByTier = {};
        for (const p of planCatalog) planByTier[p.tier] = p;
        const flagLabelMap = ${JSON.stringify(featureFlagLabels)};
        const priceFmt = new Intl.NumberFormat('fa-IR');
        window.PSX_PLANS = { catalog: planCatalog, meta: planMeta };

        function updateFeatureVisibility() {
          const requirements = {
            challengeHub: !!planMeta?.featureFlags?.challengeHub,
            qaBank: !!planMeta?.featureFlags?.qaBank,
            statsAccess: !!planMeta?.statsAccess,
          };
          Object.entries(requirements).forEach(([feature, enabled]) => {
            document.querySelectorAll('[data-requires-feature="' + feature + '"]').forEach(node => {
              if (!(node instanceof HTMLElement)) return;
              node.classList.toggle('feature-locked', !enabled);
            });
          });
          const activeButton = document.querySelector('.tabbar button.active');
          if (activeButton && activeButton.dataset.tab) {
            const currentTab = document.getElementById(activeButton.dataset.tab);
            if (currentTab && currentTab.classList.contains('feature-locked')) {
              showTab('tab-single');
            }
          }
        }

        updateFeatureVisibility();

        /** @typedef {{ silent?: boolean }} RefreshPlanMetaOptions */

        /** @type {Promise<PlanMeta|null>|null} */
        let planMetaRequest = null;

        /**
         * @param {RefreshPlanMetaOptions | undefined} options
         * @returns {Promise<PlanMeta|null>}
         */
        async function refreshPlanMeta(options) {
          const { silent = false } = options ?? {};
          if (planMetaRequest) return planMetaRequest;
          const statusMsgEl = document.getElementById('plan-status-msg');
          if (!silent && statusMsgEl) {
            statusMsgEl.classList.remove('error');
            statusMsgEl.textContent = 'در حال بروزرسانی پلن...';
          }
          planMetaRequest = (async () => {
            try {
              const res = await fetch('/api/student/plan', { headers: { accept: 'application/json' } });
              let body = null;
              try {
                body = await res.json();
              } catch {
                body = null;
              }
              if (!res.ok || !body?.ok) {
                const msg = body?.error || body?.message || res.statusText || 'خطای نامشخص';
                throw new Error(msg);
              }
              planMeta = body.data || null;
              window.PSX_PLANS.meta = planMeta;
              updateFeatureVisibility();
              renderPlanStatus();
              if (!silent && statusMsgEl) {
                statusMsgEl.textContent = '';
              }
              return planMeta;
            } catch (err) {
              if (!silent && statusMsgEl) {
                statusMsgEl.classList.add('error');
                const message = err instanceof Error ? err.message : String(err);
                statusMsgEl.textContent = 'خطا در بروزرسانی پلن: ' + message;
              } else {
                console.error('plan refresh failed', err);
              }
              throw err;
            } finally {
              planMetaRequest = null;
            }
          })();
          return planMetaRequest;
        }

        const BILLING_REFRESH_KEY = 'psx_billing_refresh';

        function expectBillingReturn() {
          try {
            sessionStorage.setItem(BILLING_REFRESH_KEY, '1');
          } catch (err) {
            console.warn('billing flag set failed', err);
          }
        }

        function maybeRefreshPlanAfterBilling(silent = true) {
          try {
            const flag = sessionStorage.getItem(BILLING_REFRESH_KEY);
            if (flag === '1') {
              sessionStorage.removeItem(BILLING_REFRESH_KEY);
              refreshPlanMeta({ silent }).catch(err => console.error('plan refresh after billing failed', err));
            }
          } catch (err) {
            console.error('billing flag read failed', err);
          }
        }

        function applyQuotaUpdate(quota) {
          if (!planMeta || !quota) return;
          if (!Array.isArray(planMeta.usage)) planMeta.usage = [];
          const list = planMeta.usage;
          const updateSingle = (action, info) => {
            if (!action || !info) return;
            const item = list.find(it => it.action === action);
            if (item) {
              if (info.limit !== undefined) item.limit = info.limit;
              if (info.remaining !== undefined) item.remaining = info.remaining;
            }
          };
          if (Array.isArray(quota)) {
            quota.forEach(entry => {
              if (entry && entry.action) updateSingle(entry.action, entry);
            });
          } else if (quota.action) {
            updateSingle(quota.action, quota);
          } else if (typeof quota === 'object') {
            for (const key in quota) {
              if (Object.prototype.hasOwnProperty.call(quota, key)) {
                updateSingle(key, quota[key]);
              }
            }
          }
          window.PSX_PLANS.meta = planMeta;
          renderPlanStatus();
        }

        // تب‌ها
        const tabs = document.querySelectorAll('.tabbar button');

        function showInlineNotice(message) {
          const msgEl = document.getElementById('plan-status-msg');
          if (msgEl) {
            msgEl.classList.add('error');
            msgEl.textContent = message;
          }
        }

        /**
         * @param {string | null | undefined} id
         * @returns {Promise<void>}
         */
        async function showTab(id) {
          if (!id) return;
          const trigger = Array.from(tabs).find(b => b.dataset.tab === id);
          if (trigger && trigger.classList.contains('feature-locked')) {
            await showTab('tab-plans');
            showInlineNotice('برای دسترسی به این بخش باید پلن مناسب فعال باشد.');
            return;
          }
          const target = document.getElementById(id);
          if (!target) return;
          if (target.classList.contains('feature-locked')) {
            if (id !== 'tab-single') showTab('tab-single');
            return;
          }
          if (id === 'tab-plans') {
            try {
              await refreshPlanMeta({ silent: false });
            } catch (err) {
              console.error(err);
            }
          }
          document.querySelectorAll('.tabsec').forEach(el=>{ if (el) el.style.display='none'; });
          target.style.display='block';
          tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
          location.hash = id;
        }
        tabs.forEach(b=>b.addEventListener('click', () => { showTab(b.dataset.tab); }));
        if (location.hash && document.getElementById(location.hash.slice(1))) showTab(location.hash.slice(1));

        // clientId دائمی
        const CLIENT_ID_KEY = "psx_cid";
        /** @type {string|null} */
        let memoryClientId = null;

        /**
         * @returns {string}
         */
        function generateFallbackId() {
          if (typeof crypto === "object" && typeof crypto?.getRandomValues === "function") {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
            return (
              hex.slice(0, 8) + "-" +
              hex.slice(8, 12) + "-" +
              hex.slice(12, 16) + "-" +
              hex.slice(16, 20) + "-" +
              hex.slice(20)
            );
          }
          return "cid-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2);
        }

        /**
         * @returns {string}
         */
        function getClientId() {
          if (memoryClientId) return memoryClientId;
          try {
            if (typeof localStorage !== "undefined") {
              const stored = localStorage.getItem(CLIENT_ID_KEY);
              if (stored) {
                memoryClientId = stored;
                return stored;
              }
            }

            if (typeof crypto === "object" && typeof crypto?.randomUUID === "function") {
              const generated = crypto.randomUUID();
              if (typeof localStorage !== "undefined") {
                localStorage.setItem(CLIENT_ID_KEY, generated);
              }
              memoryClientId = generated;
              return generated;
            }

            throw new Error("randomUUID unavailable");
          } catch (err) {
            const fallback = generateFallbackId();
            memoryClientId = fallback;
            return fallback;
          }
        }
        const clientId = getClientId();

        // helper برای دراپ‌داون‌ها
        function resetSelect(id, allowEmpty = true) {
          const el = document.getElementById(id);
          if (!el) return;
          el.innerHTML = allowEmpty ? "<option value=''>--</option>" : "";
        }
        async function fill(id, url, v="id", l="name", allowEmpty=true) {
          const el = document.getElementById(id);
          if (!el) return;
          resetSelect(id, allowEmpty);
          const res = await fetch(url); const items = await res.json();
          for (const it of items) {
            const o=document.createElement("option");
            o.value=it[v];
            o.textContent=it[l];
            el.appendChild(o);
          }
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
            if (sid) {
              await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("chapter");
            }
          };
          await upd();
          $("#major").addEventListener("change", upd);
          $("#course").addEventListener("change", async () => {
            const cid = $("#course").value || "";
            await fill("source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
            const sid = $("#source").value || "";
            if (sid) {
              await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("chapter");
            }
          });
          $("#source").addEventListener("change", async () => {
            const sid = $("#source").value || "";
            if (sid) {
              await fill("chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("chapter");
            }
          });
        }

        function updateSingleKonkurFields() {
          const typeEl = document.getElementById("type");
          const typeValue = typeEl && "value" in typeEl ? typeEl.value : "";
          const isKonkur = typeValue === "konkur";
          const toggleNodes = (selector, shouldShow) => {
            document.querySelectorAll(selector).forEach((node) => {
              if (!(node instanceof HTMLElement)) return;
              node.style.display = shouldShow ? "" : "none";
              const select = node.querySelector("select");
              if (select instanceof HTMLSelectElement) {
                select.disabled = !shouldShow;
                if (!shouldShow) {
                  select.value = "";
                }
              }
            });
          };

          toggleNodes('#tab-single [data-konkur-only]', isKonkur);
          toggleNodes('#tab-single [data-talifi-only]', !isKonkur);
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
          const getValue = (id) => {
            const node = document.getElementById(id);
            if (!node || !("value" in node)) return undefined;
            const val = node.value;
            return val ? val : undefined;
          };
          const typeEl = document.getElementById("type");
          const typeValue = typeEl && "value" in typeEl ? typeEl.value : "";
          const isKonkur = typeValue === "konkur";
          const filters = {
            majorId: getValue("major"),
            courseId: getValue("course"),
          };
          if (!isKonkur) {
            const sourceId = getValue("source");
            const chapterId = getValue("chapter");
            if (sourceId) filters.sourceId = sourceId;
            if (chapterId) filters.chapterId = chapterId;
          }
          if (isKonkur) {
            const degreeId = getValue("degree");
            const ministryId = getValue("ministry");
            const examYearId = getValue("examYear");
            if (degreeId) filters.degreeId = degreeId;
            if (ministryId) filters.ministryId = ministryId;
            if (examYearId) filters.examYearId = examYearId;
          }
          return filters;
        }
        function currentFiltersChallenge(){
          const valueOf = (id) => {
            const node = document.getElementById(id);
            if (!node || !("value" in node)) return undefined;
            const val = node.value;
            return val ? val : undefined;
          };
          return {
            majorId: valueOf("cmajor"),
            courseId: valueOf("ccourse"),
            sourceId: valueOf("csource"),
            chapterId: valueOf("cchapter"),
          };
        }

        async function fetchRandom() {
          const type = $("#type").value;
          const filters = currentFiltersSingle();
          const majorId = filters.majorId;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const params = new URLSearchParams({ type, majorId });
          Object.entries(filters).forEach(([key, value]) => {
            if (key === "majorId") return;
            if (value) params.set(key, value);
          });
          const r = await fetch("/api/student/random?"+params.toString());
          const d = await r.json();
          if (d.quota) applyQuotaUpdate(d.quota);
          if (!d.ok) {
            if (d.error === 'no_question') {
              $("#qbox").style.display="none";
              alert("سؤالی با این فیلتر پیدا نشد.");
            } else {
              alert(d.message || d.error || "خطا در دریافت سؤال");
            }
            return;
          }
          const q = d.data;
          const wasSeen = seenHas(q.id);
          renderSingle(q);
          if (wasSeen) {
            $("#result").textContent = "این سؤال را قبلاً دیده‌ای. برای تمرین دوباره پاسخ بده.";
          }
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
          const majorEl = /** @type {HTMLSelectElement|null} */ (document.getElementById("cmajor"));
          const courseEl = /** @type {HTMLSelectElement|null} */ (document.getElementById("ccourse"));
          const sourceEl = /** @type {HTMLSelectElement|null} */ (document.getElementById("csource"));
          const chapterEl = /** @type {HTMLSelectElement|null} */ (document.getElementById("cchapter"));
          if (!majorEl || !courseEl || !sourceEl || !chapterEl) return;
          await fill("cmajor", "/api/taxonomy/majors", "id", "name", false);
          const upd = async () => {
            const mid = majorEl.value || "";
            await fill("ccourse", "/api/taxonomy/courses?majorId="+encodeURIComponent(mid));
            const cid = courseEl.value || "";
            await fill("csource", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
            const sid = sourceEl.value || "";
            if (sid) {
              await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("cchapter");
            }
          };
          await upd();
          if ("addEventListener" in majorEl) majorEl.addEventListener("change", upd);
          if ("addEventListener" in courseEl) courseEl.addEventListener("change", async () => {
            const cid = courseEl.value || "";
            await fill("csource", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid));
            const sid = sourceEl.value || "";
            if (sid) {
              await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("cchapter");
            }
          });
          if ("addEventListener" in sourceEl) sourceEl.addEventListener("change", async () => {
            const sid = sourceEl.value || "";
            if (sid) {
              await fill("cchapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid));
            } else {
              resetSelect("cchapter");
            }
          });
        }

        async function fetchChallenge() {
          const majorSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("cmajor"));
          if (!majorSelect) return;
          const majorId = majorSelect.value;
          if (!majorId) { alert("رشته را انتخاب کن."); return; }
          const params = new URLSearchParams({
            clientId,
            majorId,
          });
          const maybeSetParam = (select, key) => {
            if (select && "value" in select && select.value) params.set(key, select.value);
          };
          const typeSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("ctype"));
          maybeSetParam(typeSelect, "type");
          const courseSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("ccourse"));
          maybeSetParam(courseSelect, "courseId");
          const sourceSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("csource"));
          maybeSetParam(sourceSelect, "sourceId");
          const chapterSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("cchapter"));
          maybeSetParam(chapterSelect, "chapterId");
          const r = await fetch("/api/student/challenge-next?"+params.toString());
          const d = await r.json();
          if (d.quota) applyQuotaUpdate(d.quota);
          if (!d.ok) {
            const box = document.getElementById("cbox");
            if (box) box.style.display="none";
            alert(d.message || d.error || "سؤال چالشی پیدا نشد.");
            return;
          }
          renderChallenge(d.data);
        }

        function renderChallenge(q) {
          const wrapper = document.getElementById("cbox");
          const stemEl = document.getElementById("cstem");
          const optsContainer = document.getElementById("copts");
          if (!wrapper || !stemEl || !optsContainer) return;
          wrapper.style.display="block";
          stemEl.textContent = q.stem;
          optsContainer.innerHTML = "";
          for (const o of (q.options || [])) {
            const btn = document.createElement("button");
            btn.textContent = o.label + ") " + o.text;
            btn.style.display = "block";
            btn.style.margin = "6px 0";
            btn.onclick = () => answer(q, o.label, "challenge");
            optsContainer.appendChild(btn);
          }
          const resultEl = document.getElementById("cresult");
          if (resultEl) resultEl.textContent = "";
          const nextBtn = document.getElementById("cnextBtn");
          if (nextBtn) nextBtn.onclick = () => fetchChallenge();
          wrapper.dataset.id = q.id; wrapper.dataset.type = q.type;
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
          if (d.quota) applyQuotaUpdate(d.quota);
          if (!d.ok) { alert(d.message || d.error || "پرسش تشریحی پیدا نشد."); return; }
          renderQaList([d.data]);
        }

        async function answer(q, choice, mode) {
          const qualityEl = mode==="single" ? document.getElementById("quality") : document.getElementById("cquality");
          const difficultyEl = mode==="single" ? document.getElementById("difficulty") : document.getElementById("cdifficulty");
          const quality = qualityEl && "value" in qualityEl ? (Number(qualityEl.value || "") || undefined) : undefined;
          const difficulty = difficultyEl && "value" in difficultyEl ? (Number(difficultyEl.value || "") || undefined) : undefined;
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
          if (!d.ok) { $("#sout").textContent = d.message || d.error || "خطا در دریافت آمار"; return; }
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
            if (sid) {
              await fill("x-chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid), "id", "name", true);
            } else {
              resetSelect("x-chapter", true);
            }
          };
          await upd();
          $("#x-major").addEventListener("change", upd);
          $("#x-course").addEventListener("change", async () => {
            const cid = $("#x-course").value || "";
            await fill("x-source", "/api/taxonomy/sources?courseId="+encodeURIComponent(cid), "id", "name", true);
            const sid = $("#x-source").value || "";
            if (sid) {
              await fill("x-chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid), "id", "name", true);
            } else {
              resetSelect("x-chapter", true);
            }
          });
          $("#x-source").addEventListener("change", async () => {
            const sid = $("#x-source").value || "";
            if (sid) {
              await fill("x-chapter", "/api/taxonomy/chapters?sourceId="+encodeURIComponent(sid), "id", "name", true);
            } else {
              resetSelect("x-chapter", true);
            }
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
          const talifiCap = planMeta && typeof planMeta.talifiExamMaxQuestions === 'number' ? planMeta.talifiExamMaxQuestions : null;
          if (mode === 'talifi' && talifiCap && count > talifiCap) {
            alert('در پلن فعلی حداکثر ' + talifiCap + ' سؤال تالیفی در هر آزمون مجاز است.');
            return;
          }
          const res = await fetch("/api/student/exam/start", {
            method: "POST", headers: {"content-type":"application/json"},
            body: JSON.stringify({ clientId, mode, majorId, courseId, sourceId, chapterId, count, durationMin })
          });
          const d = await res.json();
          if (d.quota) applyQuotaUpdate(d.quota);
          if (!d.ok) { alert(d.message || d.error || "خطا در شروع آزمون"); return; }
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

        function renderPlanStatus() {
          const statusEl = document.getElementById('plan-status');
          const msgEl = document.getElementById('plan-status-msg');
          if (msgEl) { msgEl.textContent = ''; msgEl.classList.remove('error'); }
          if (!statusEl) return;
          const tier = planMeta && planMeta.planTier ? planMeta.planTier : 'free';
          if (!planMeta) {
            statusEl.classList.add('muted');
            statusEl.innerHTML = 'برای مشاهده وضعیت پلن باید وارد حساب کاربری شوی.';
            return;
          }
          const info = planByTier[tier] || null;
          let baseText = '';
          if (tier === 'free') {
            baseText = 'پلن فعلی: رایگان. برای دسترسی کامل یکی از پلن‌ها را فعال کن.';
            statusEl.classList.add('muted');
          } else {
            baseText = 'پلن فعلی: ' + (info ? info.title : tier);
            if (planMeta.planExpiresAt) {
              try {
                const fa = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long' }).format(new Date(planMeta.planExpiresAt));
                baseText += ' — اعتبار تا ' + fa;
              } catch (err) {
                baseText += ' — اعتبار تا ' + new Date(planMeta.planExpiresAt).toLocaleDateString('fa-IR');
              }
            }
            statusEl.classList.remove('muted');
          }
          const blocks = ['<div>' + baseText + '</div>'];
          if (planMeta.dailyLimits) {
            const dl = planMeta.dailyLimits;
            blocks.push(
              '<div class="plan-meta-limits">سقف روزانه: ' +
              priceFmt.format(dl.randomQuestionsPerDay) +
              ' سؤال تصادفی • ' +
              priceFmt.format(dl.challengeQuestionsPerDay) +
              ' سؤال چالشی • ' +
              priceFmt.format(dl.examsPerDay) +
              ' آزمون • ' +
              priceFmt.format(dl.qaSessionsPerDay) +
              ' مرور تشریحی</div>'
            );
          }
          const usageLines = [];
          if (Array.isArray(planMeta.usage)) {
            for (const item of planMeta.usage) {
              const remain = typeof item.remaining === 'number' ? priceFmt.format(Math.max(0, item.remaining)) : 'نامحدود';
              const limit = typeof item.limit === 'number' ? priceFmt.format(item.limit) : 'نامحدود';
              usageLines.push('<span><strong>' + item.label + ':</strong> ' + remain + ' از ' + limit + ' باقی مانده</span>');
            }
          }
          if (typeof planMeta.talifiExamMaxQuestions === 'number') {
            usageLines.push('<span><strong>حداکثر سؤال تالیفی هر آزمون:</strong> ' + priceFmt.format(planMeta.talifiExamMaxQuestions) + '</span>');
          }
          if (usageLines.length) {
            blocks.push('<div class="plan-meta-usage">' + usageLines.join('') + '</div>');
          }
          if (planMeta.featureFlags) {
            const activeFlags = Object.entries(planMeta.featureFlags)
              .filter(([, enabled]) => !!enabled)
              .map(([key]) => flagLabelMap[key] || '')
              .filter(Boolean);
            if (activeFlags.length) {
              blocks.push(
                '<div class="plan-meta-tags">' +
                activeFlags.map(label => '<span>' + label + '</span>').join('') +
                '</div>'
              );
            }
          }
          statusEl.innerHTML = blocks.join('');
        }

        function initPlans() {
          renderPlanStatus();
          const statusMsgEl = document.getElementById('plan-status-msg');
          document.querySelectorAll('.plan-buy').forEach(btn => {
            btn.addEventListener('click', async () => {
              const tier = btn.dataset.tier;
              const info = tier ? planByTier[tier] : null;
              const months = Number(btn.dataset.months || '0');
              const price = Number(btn.dataset.price || '0');
              const label = btn.dataset.label || '';
              if (!tier || !info || !months) {
                alert('پلن انتخابی معتبر نیست.');
                return;
              }
              const confirmMsg = 'آیا می‌خواهی پرداخت پلن «' + info.title + '» (' + label + ') به مبلغ ' + priceFmt.format(price) + ' تومان آغاز شود؟';
              if (!confirm(confirmMsg)) return;
              btn.disabled = true;
              const originalHtml = btn.innerHTML;
              btn.innerHTML = '<span>در حال ایجاد لینک...</span>';
              if (statusMsgEl) { statusMsgEl.classList.remove('error'); statusMsgEl.textContent = 'در حال ارتباط با زرین‌پال...'; }
              try {
                const res = await fetch('/api/billing/zarinpal/create', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ planTier: tier, months })
                });
                const data = await res.json();
                if (!data.ok || !data.payUrl) {
                  const msg = data.error || 'خطا در ایجاد تراکنش';
                  throw new Error(msg);
                }
                expectBillingReturn();
                location.href = data.payUrl;
              } catch (err) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                const msg = err && err.message ? err.message : String(err) || 'خطا رخ داد';
                if (statusMsgEl) {
                  statusMsgEl.classList.add('error');
                  statusMsgEl.textContent = 'خطا: ' + msg;
                } else {
                  alert(msg);
                }
              }
            });
          });
          const handleBillingReturn = () => maybeRefreshPlanAfterBilling(true);
          window.addEventListener('focus', handleBillingReturn);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') handleBillingReturn();
          });
          handleBillingReturn();
        }

        // رویدادها
        const singleFetchBtn = document.getElementById("fetchBtn");
        if (singleFetchBtn) singleFetchBtn.addEventListener("click", fetchRandom);
        const typeSelectSingle = document.getElementById("type");
        if (typeSelectSingle) typeSelectSingle.addEventListener("change", updateSingleKonkurFields);
        const challengeFetchBtn = document.getElementById("cfetchBtn");
        if (challengeFetchBtn) challengeFetchBtn.addEventListener("click", fetchChallenge);
        const qaSearchBtn = document.getElementById("qa-search");
        if (qaSearchBtn) qaSearchBtn.addEventListener("click", loadQaList);
        const qaRandomBtn = document.getElementById("qa-random");
        if (qaRandomBtn) qaRandomBtn.addEventListener("click", fetchRandomQa);
        const statsBtn = document.getElementById("sload");
        if (statsBtn) statsBtn.addEventListener("click", loadStats);
        const examStartBtn = document.getElementById("x-start");
        if (examStartBtn) examStartBtn.addEventListener("click", startExam);
        const examPrevBtn = document.getElementById("x-prev");
        if (examPrevBtn) examPrevBtn.addEventListener("click", prevQ);
        const examNextBtn = document.getElementById("x-next");
        if (examNextBtn) examNextBtn.addEventListener("click", nextQ);
        const examSubmitBtn = document.getElementById("x-submit");
        if (examSubmitBtn) examSubmitBtn.addEventListener("click", submitExam);
        const reviewBtn = document.getElementById("x-show-review");
        if (reviewBtn) reviewBtn.addEventListener("click", loadReview);

        // تغییر فیلدهای آزمون بر اساس mode (JS خالص)
        const xmodeEl = document.getElementById("x-mode");
        if (xmodeEl) xmodeEl.addEventListener("change", toggleExamFields);

        async function initAll(){
          await initCascadesSingle();
          updateSingleKonkurFields();
          if (document.getElementById("cmajor")) { await initCascadesChallenge(); }
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
