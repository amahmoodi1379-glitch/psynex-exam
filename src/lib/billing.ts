// src/lib/billing.ts
import type { SessionPayload } from "./auth";

export type PlanDuration = {
  id: "monthly" | "quarterly" | "semiannual";
  label: string;
  months: number;
  priceTomans: number;
  savingsLabel?: string;
};

export type PlanDailyLimits = {
  randomQuestionsPerDay: number;
  challengeQuestionsPerDay: number;
  examsPerDay: number;
  qaSessionsPerDay: number;
};

export type PlanUsageLimits = {
  randomFetches: Record<"konkur" | "talifi" | "qa", number | null>;
  challengeFetches: {
    enabled: boolean;
    perType: Record<"konkur" | "talifi", number | null>;
  };
  comboActions?: Record<string, number | null>;
  exams: {
    totalPerDay: number | null;
    byMode: {
      konkur?: number | null;
      mixed?: number | null;
      talifi?: { perDay: number | null; maxQuestions?: number | null } | null;
    };
  };
  talifiAuthoredPerDay: number | null;
  qaPostsPerDay: number | null;
  statsAccess: boolean;
};

export type PlanFeatureFlags = {
  qaBank: boolean;
  challengeHub: boolean;
  examBuilder: boolean;
  analytics: boolean;
  prioritySupport: boolean;
  aiCoach: boolean;
};

export const PLAN_CATALOG = {
  free: {
    title: "پلن رایگان",
    subtitle: "دسترسی اولیه با سقف محدود برای آشنایی با سامانه",
    description: "می‌توانی با بانک سؤال کنکور تمرین کنی و روزانه چند سؤال تالیفی و یک آزمون تالیفی کوتاه بسازی.",
    highlight: false,
    available: false,
    features: [
      "گرفتن سؤال‌های کنکور بدون محدودیت",
      "تا ۵ سؤال تالیفی تصادفی در روز",
      "یک آزمون تالیفی کوتاه با حداکثر ۱۵ سؤال در روز",
    ],
    dailyLimits: {
      randomQuestionsPerDay: 40,
      challengeQuestionsPerDay: 0,
      examsPerDay: 2,
      qaSessionsPerDay: 5,
    } as PlanDailyLimits,
    usageLimits: {
      randomFetches: { konkur: null, talifi: 5, qa: null },
      challengeFetches: { enabled: false, perType: { konkur: 0, talifi: 0 } },
      exams: {
        totalPerDay: null,
        byMode: {
          konkur: null,
          mixed: null,
          talifi: { perDay: 1, maxQuestions: 15 },
        },
      },
      talifiAuthoredPerDay: 0,
      qaPostsPerDay: 0,
      statsAccess: false,
    } as PlanUsageLimits,
    featureFlags: {
      qaBank: false,
      challengeHub: false,
      examBuilder: true,
      analytics: false,
      prioritySupport: false,
      aiCoach: false,
    } as PlanFeatureFlags,
    durations: [] as PlanDuration[],
  },
  level1: {
    title: "سطح ۱ — شروع هوشمند",
    subtitle: "برای ساختن عادت مطالعه منظم و پوشش کامل مباحث پایه",
    description: "پلنی متعادل برای دانش‌آموزانی که می‌خواهند به شکل روزانه با بانک سؤال تمرین کنند و پیشرفت خود را رصد نمایند.",
    highlight: false,
    available: true,
    features: [
      "دسترسی کامل به بانک سؤال کنکور و تالیفی",
      "تحلیل پیشرفت با گزارش‌های روزانه پایه",
      "ساخت آزمون شخصی تا سه بار در روز",
      "پشتیبانی استاندارد درون‌سیستم",
    ],
    dailyLimits: {
      randomQuestionsPerDay: 120,
      challengeQuestionsPerDay: 0,
      examsPerDay: 3,
      qaSessionsPerDay: 20,
    } as PlanDailyLimits,
    usageLimits: {
      randomFetches: { konkur: null, talifi: 50, qa: null },
      challengeFetches: { enabled: false, perType: { konkur: 0, talifi: 0 } },
      comboActions: {},
      exams: {
        totalPerDay: 3,
        byMode: {
          konkur: null,
          mixed: null,
          talifi: { perDay: 3, maxQuestions: null },
        },
      },
      talifiAuthoredPerDay: 50,
      qaPostsPerDay: 20,
      statsAccess: false,
    } as PlanUsageLimits,
    featureFlags: {
      qaBank: true,
      challengeHub: false,
      examBuilder: true,
      analytics: false,
      prioritySupport: false,
      aiCoach: false,
    } as PlanFeatureFlags,
    durations: [
      { id: "monthly", label: "۱ ماهه", months: 1, priceTomans: 70_000 },
      { id: "quarterly", label: "۳ ماهه", months: 3, priceTomans: 190_000, savingsLabel: "٪۱۰ صرفه‌جویی" },
      { id: "semiannual", label: "۶ ماهه", months: 6, priceTomans: 350_000, savingsLabel: "به‌صرفه‌ترین" },
    ] as PlanDuration[],
  },
  level2: {
    title: "سطح ۲ — جهش حرفه‌ای",
    subtitle: "برای دانش‌آموزانی که به دنبال تحلیل عمیق و تمرین فشرده هستند",
    description: "با این سطح به ابزارهای تحلیلی پیشرفته، محدودیت‌های بالاتر و پشتیبانی اولویت‌دار دسترسی پیدا می‌کنی.",
    highlight: true,
    available: true,
    features: [
      "همه امکانات سطح ۱ بدون محدودیت نرم",
      "آنالیز پیشرفته عملکرد و گزارش‌های هوشمند",
      "ساخت تا ۶ آزمون زمان‌بندی‌شده در روز",
      "پشتیبانی اولویت‌دار و مشاوره کوتاه",
    ],
    dailyLimits: {
      randomQuestionsPerDay: 300,
      challengeQuestionsPerDay: 120,
      examsPerDay: 6,
      qaSessionsPerDay: 60,
    } as PlanDailyLimits,
    usageLimits: {
      randomFetches: { konkur: null, talifi: 200, qa: null },
      challengeFetches: { enabled: true, perType: { konkur: null, talifi: null } },
      comboActions: { "combo:talifi_challenge": 200 },
      exams: {
        totalPerDay: 10,
        byMode: {
          konkur: null,
          mixed: null,
          talifi: { perDay: 10, maxQuestions: null },
        },
      },
      talifiAuthoredPerDay: 200,
      qaPostsPerDay: 50,
      statsAccess: true,
    } as PlanUsageLimits,
    featureFlags: {
      qaBank: true,
      challengeHub: true,
      examBuilder: true,
      analytics: true,
      prioritySupport: true,
      aiCoach: true,
    } as PlanFeatureFlags,
    durations: [
      { id: "monthly", label: "۱ ماهه", months: 1, priceTomans: 120_000 },
      { id: "quarterly", label: "۳ ماهه", months: 3, priceTomans: 320_000, savingsLabel: "٪۱۲ صرفه‌جویی" },
      { id: "semiannual", label: "۶ ماهه", months: 6, priceTomans: 600_000, savingsLabel: "محبوب‌ترین برای رتبه‌برترها" },
    ] as PlanDuration[],
  },
  level3: {
    title: "سطح ۳ — حرفه‌ای پلاس",
    subtitle: "پلن ویژه با امکانات سفارشی برای رتبه‌های برتر و مدارس",
    description: "در حال آماده‌سازی پلتفرمی اختصاصی با برنامه‌ریزی شخصی‌سازی‌شده، داشبورد مربی و ابزارهای تیمی.",
    highlight: false,
    available: false,
    comingSoonText: "به‌زودی با امکانات اختصاصی",
    features: [
      "دسترسی جامع به بانک سؤال و تحلیل‌های سطح ۲",
      "پشتیبانی اختصاصی و جلسات مربیگری",
      "هماهنگی گروهی و داشبورد مدرسه/مشاور",
    ],
    dailyLimits: {
      randomQuestionsPerDay: 600,
      challengeQuestionsPerDay: 240,
      examsPerDay: 12,
      qaSessionsPerDay: 120,
    } as PlanDailyLimits,
    usageLimits: {
      randomFetches: { konkur: null, talifi: null, qa: null },
      challengeFetches: { enabled: true, perType: { konkur: null, talifi: null } },
      exams: {
        totalPerDay: 20,
        byMode: {
          konkur: null,
          mixed: null,
          talifi: { perDay: 20, maxQuestions: null },
        },
      },
      talifiAuthoredPerDay: 400,
      qaPostsPerDay: 120,
      statsAccess: true,
    } as PlanUsageLimits,
    featureFlags: {
      qaBank: true,
      challengeHub: true,
      examBuilder: true,
      analytics: true,
      prioritySupport: true,
      aiCoach: true,
    } as PlanFeatureFlags,
    durations: [] as PlanDuration[],
  },
} as const;

export type PlanTier = keyof typeof PLAN_CATALOG;
export type PlanDefinition = (typeof PLAN_CATALOG)[PlanTier];

export function getPlanDuration(plan: PlanDefinition, months: number): PlanDuration | null {
  return plan.durations.find(d => d.months === months) ?? null;
}

export function getPlanDefinition(tier: string | null | undefined): (PlanDefinition & { tier: PlanTier }) | null {
  if (!tier) return null;
  const key = tier as PlanTier;
  if (!PLAN_CATALOG[key]) return null;
  return { tier: key, ...PLAN_CATALOG[key] };
}

export function monthsToMs(months: number): number {
  const daysPerMonth = 30;
  return months * daysPerMonth * 24 * 60 * 60 * 1000;
}

export type BillingRecord = {
  authority: string;
  email: string;
  planTier: PlanTier;
  durationId: PlanDuration["id"];
  durationLabel: string;
  months: number;
  amountTomans: number;
  amountRials: number;
  status: "pending" | "verified" | "failed";
  createdAt: number;
  callbackUrl: string;
  refId?: string;
  verifiedAt?: number;
  statusMessage?: string;
};

const TX_PREFIX = "billing:txn:";
const TX_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function txKey(authority: string) {
  return `${TX_PREFIX}${authority}`;
}

export async function saveBillingRequest(env: any, record: BillingRecord) {
  await env.DATA.put(txKey(record.authority), JSON.stringify(record), { expirationTtl: TX_TTL_SECONDS });
}

export async function getBillingRequest(env: any, authority: string): Promise<BillingRecord | null> {
  const raw = await env.DATA.get(txKey(authority));
  return raw ? JSON.parse(raw) as BillingRecord : null;
}

export async function updateBillingRequest(env: any, authority: string, patch: Partial<BillingRecord>): Promise<BillingRecord | null> {
  const current = await getBillingRequest(env, authority);
  if (!current) return null;
  const next: BillingRecord = { ...current, ...patch };
  await env.DATA.put(txKey(authority), JSON.stringify(next), { expirationTtl: TX_TTL_SECONDS });
  return next;
}

export function describePlanForSession(planTier: SessionPayload["planTier"]): string {
  const def = getPlanDefinition(planTier);
  return def ? def.title : "پلن رایگان";
}
