// src/lib/usage.ts
import type { PlanUsageLimits } from "./billing";

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_PREFIX = "usage:";

export type UsageIncrement = {
  action: string;
  limit: number | null | undefined;
  amount?: number;
};

export type UsageRecord = {
  action: string;
  count: number;
  limit: number | null;
  remaining: number | null;
};

type StoredUsage = {
  count: number;
  date: string;
  updatedAt: number;
};

type UsageConsumeOk = {
  ok: true;
  records: UsageRecord[];
};

type UsageConsumeErr = {
  ok: false;
  action: string;
  count: number;
  limit: number | null;
  remaining: number;
};

export type UsageConsumeResult = UsageConsumeOk | UsageConsumeErr;

function encodeEmail(email: string) {
  return encodeURIComponent(email.toLowerCase());
}

function currentDateKey() {
  const now = new Date();
  const iso = new Date(now.getTime()).toISOString();
  return iso.slice(0, 10);
}

function keyFor(email: string, action: string, dateKey = currentDateKey()) {
  return `${USAGE_PREFIX}${encodeEmail(email)}:${dateKey}:${action}`;
}

function parseStored(raw: string | null, dateKey: string): StoredUsage {
  if (!raw) {
    return { count: 0, date: dateKey, updatedAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(raw) as StoredUsage;
    if (!parsed || parsed.date !== dateKey) {
      return { count: 0, date: dateKey, updatedAt: Date.now() };
    }
    return { count: Number(parsed.count) || 0, date: dateKey, updatedAt: Date.now() };
  } catch {
    return { count: 0, date: dateKey, updatedAt: Date.now() };
  }
}

async function writeUsage(env: any, key: string, data: StoredUsage) {
  await env.DATA.put(key, JSON.stringify(data), { expirationTtl: Math.floor((2 * DAY_MS) / 1000) });
}

export async function consumeUsage(env: any, email: string, increments: UsageIncrement[]): Promise<UsageConsumeResult> {
  const dateKey = currentDateKey();
  const effective = increments.filter(inc => inc.limit !== null && inc.limit !== undefined);
  if (effective.length === 0) {
    return { ok: true, records: [] };
  }

  const nextStates: { action: string; key: string; nextCount: number; limit: number | null; remaining: number | null }[] = [];

  for (const inc of effective) {
    const amount = inc.amount ?? 1;
    if (amount <= 0) continue;
    const key = keyFor(email, inc.action, dateKey);
    const raw = await env.DATA.get(key);
    const parsed = parseStored(raw, dateKey);
    const nextCount = parsed.count + amount;
    const limit = inc.limit ?? null;
    if (limit !== null && nextCount > limit) {
      const remaining = Math.max(0, limit - parsed.count);
      return { ok: false, action: inc.action, count: parsed.count, limit, remaining };
    }
    const remaining = limit !== null ? Math.max(0, limit - nextCount) : null;
    nextStates.push({ action: inc.action, key, nextCount, limit, remaining });
  }

  const now = Date.now();
  const records: UsageRecord[] = [];
  for (const state of nextStates) {
    const stored: StoredUsage = { count: state.nextCount, date: dateKey, updatedAt: now };
    await writeUsage(env, state.key, stored);
    records.push({ action: state.action, count: state.nextCount, limit: state.limit, remaining: state.remaining });
  }

  return { ok: true, records };
}

export async function getUsageSnapshot(env: any, email: string, action: string, limit: number | null | undefined): Promise<UsageRecord> {
  if (limit === null || limit === undefined) {
    return { action, count: 0, limit: null, remaining: null };
  }
  const dateKey = currentDateKey();
  const key = keyFor(email, action, dateKey);
  const raw = await env.DATA.get(key);
  const parsed = parseStored(raw, dateKey);
  const count = parsed.count;
  const remaining = limit !== null ? Math.max(0, limit - count) : null;
  return { action, count, limit, remaining };
}

export async function getUsageSnapshots(env: any, email: string, items: UsageIncrement[]): Promise<UsageRecord[]> {
  const results: UsageRecord[] = [];
  for (const inc of items) {
    results.push(await getUsageSnapshot(env, email, inc.action, inc.limit));
  }
  return results;
}

export type PlanUsageDescriptor = {
  action: string;
  label: string;
  limit: number | null | undefined;
};

export function describeUsageForPlan(plan: { usageLimits?: PlanUsageLimits | null }): PlanUsageDescriptor[] {
  const descriptors: PlanUsageDescriptor[] = [];
  const usage = plan.usageLimits;
  if (!usage) return descriptors;

  if (usage.randomFetches.talifi !== null && usage.randomFetches.talifi !== undefined) {
    descriptors.push({ action: "random:talifi", label: "سؤال تصادفی تالیفی", limit: usage.randomFetches.talifi });
  }
  if (usage.exams.totalPerDay !== null && usage.exams.totalPerDay !== undefined) {
    descriptors.push({ action: "exam:total", label: "کل آزمون‌های روزانه", limit: usage.exams.totalPerDay });
  }
  const talifiExamLimit = usage.exams.byMode.talifi?.perDay;
  if (talifiExamLimit !== null && talifiExamLimit !== undefined) {
    descriptors.push({ action: "exam:talifi", label: "آزمون تالیفی", limit: talifiExamLimit });
  }
  return descriptors;
}
