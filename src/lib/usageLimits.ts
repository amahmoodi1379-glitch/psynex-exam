// src/lib/usageLimits.ts
import type { SessionPayload } from "./auth";

export type UsageField = "exams" | "talifiExams" | "randomTalifi" | "contentCreation";

export type UsageCounters = Record<UsageField, number>;

export type DailyUsageLimit = {
  maxExamsPerDay: number | null;
  maxTalifiExamsPerDay: number | null;
  maxTalifiRandomPerDay: number | null;
  maxTalifiQuestionsPerExamFree: number | null;
  maxContentCreationsPerDay: number | null;
};

const EMPTY_COUNTERS: UsageCounters = {
  exams: 0,
  talifiExams: 0,
  randomTalifi: 0,
  contentCreation: 0,
};

export const DAILY_USAGE_LIMITS: Record<SessionPayload["planTier"], DailyUsageLimit> = {
  free: {
    maxExamsPerDay: 3,
    maxTalifiExamsPerDay: 1,
    maxTalifiRandomPerDay: 5,
    maxTalifiQuestionsPerExamFree: 15,
    maxContentCreationsPerDay: 0,
  },
  pro1: {
    maxExamsPerDay: 12,
    maxTalifiExamsPerDay: 8,
    maxTalifiRandomPerDay: 60,
    maxTalifiQuestionsPerExamFree: null,
    maxContentCreationsPerDay: 20,
  },
  pro2: {
    maxExamsPerDay: 16,
    maxTalifiExamsPerDay: 12,
    maxTalifiRandomPerDay: 80,
    maxTalifiQuestionsPerExamFree: null,
    maxContentCreationsPerDay: 35,
  },
  pro3: {
    maxExamsPerDay: 20,
    maxTalifiExamsPerDay: 16,
    maxTalifiRandomPerDay: 100,
    maxTalifiQuestionsPerExamFree: null,
    maxContentCreationsPerDay: 50,
  },
};

function usageKey(email: string, dayKey: string) {
  return `usage:${email}:${dayKey}`;
}

function cloneCounters(base: Partial<UsageCounters> | null | undefined): UsageCounters {
  return {
    ...EMPTY_COUNTERS,
    ...(base || {}),
  };
}

export function getDailyUsageLimits(tier: SessionPayload["planTier"]): DailyUsageLimit {
  return DAILY_USAGE_LIMITS[tier] || DAILY_USAGE_LIMITS.free;
}

export function formatUsageDateKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function readUsageCounters(env: any, email: string, dayKey: string): Promise<UsageCounters> {
  const raw = await env.DATA.get(usageKey(email, dayKey));
  if (!raw) return cloneCounters(null);
  try {
    const parsed = JSON.parse(raw) as Partial<UsageCounters>;
    return cloneCounters(parsed);
  } catch {
    return cloneCounters(null);
  }
}

const LIMIT_KEY_BY_FIELD: Record<UsageField, keyof DailyUsageLimit> = {
  exams: "maxExamsPerDay",
  talifiExams: "maxTalifiExamsPerDay",
  randomTalifi: "maxTalifiRandomPerDay",
  contentCreation: "maxContentCreationsPerDay",
};

export function isLimitReached(
  limits: DailyUsageLimit,
  field: UsageField,
  counters: UsageCounters,
  nextIncrement = 1,
): boolean {
  const key = LIMIT_KEY_BY_FIELD[field];
  const max = limits[key];
  if (max === null) return false;
  const current = counters[field] ?? 0;
  return current + nextIncrement - 1 >= max;
}

export async function incrementUsageCounter(
  env: any,
  email: string,
  dayKey: string,
  field: UsageField,
  amount = 1,
  current?: UsageCounters | null,
): Promise<UsageCounters> {
  const counters = cloneCounters(current);
  counters[field] = (counters[field] ?? 0) + amount;
  await env.DATA.put(usageKey(email, dayKey), JSON.stringify(counters), {
    expirationTtl: 60 * 60 * 24 * 3,
  });
  return counters;
}
