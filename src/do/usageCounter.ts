// src/do/usageCounter.ts
import type { UsageCounters, UsageField } from "../lib/usageLimits";

type DurableObjectStateLike = {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

type StorageShape = {
  counters: UsageCounters;
};

function sanitizeCounters(input: Partial<UsageCounters> | null | undefined): UsageCounters {
  return {
    exams: Number(input?.exams || 0),
    talifiExams: Number(input?.talifiExams || 0),
    randomTalifi: Number(input?.randomTalifi || 0),
    contentCreation: Number(input?.contentCreation || 0),
  };
}

export class UsageCounterDurableObject {
  constructor(private readonly state: DurableObjectStateLike) {}

  private async readState(): Promise<UsageCounters> {
    const stored = await this.state.storage.get<StorageShape>("state");
    return sanitizeCounters(stored?.counters);
  }

  private async writeState(counters: UsageCounters): Promise<UsageCounters> {
    await this.state.storage.put("state", { counters });
    return counters;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || pathname !== "/counters") {
      return new Response("not_found", { status: 404 });
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad_request", { status: 400 });
    }

    const action = String(payload?.action || "");
    if (action === "read") {
      const counters = await this.readState();
      return this.json(counters);
    }

    if (action === "increment") {
      const field = payload?.field as UsageField | undefined;
      const amount = Number(payload?.amount ?? 1);
      if (!field || !Number.isFinite(amount)) {
        return new Response("bad_request", { status: 400 });
      }
      return await this.state.blockConcurrencyWhile(async () => {
        const counters = await this.readState();
        counters[field] = (counters[field] ?? 0) + amount;
        const updated = await this.writeState(counters);
        return this.json(updated);
      });
    }

    return new Response("bad_request", { status: 400 });
  }

  private json(data: UsageCounters) {
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
