// domain/gamification.ts: Duolingo-in-a-Box Gamification Engine
// Manages Hearts (lives + auto-refill timer), Gems virtual currency,
// Daily XP Goal (0/20 XP with daily auto-reset + bonus gem rewards),
// and Winding Path curriculum progress.

import crypto from 'node:crypto';
import type { DbAdapter } from '../config/db.js';

export interface HeartsState {
  current: number;
  max: number;
  refillIntervalMinutes: number;
  secondsUntilNextRefill: number | null;
  secondsUntilFullRefill: number | null;
  isFull: boolean;
  outOfHearts: boolean;
}

export interface GamificationStatusDTO {
  userId: string;
  hearts: HeartsState;
  gems: {
    balance: number;
  };
  xp: {
    today: number;
    targetDaily: number;
    total: number;
    dailyGoalCompleted: boolean;
    logicalDate: string;
  };
  curriculumProgress: Record<string, number>;
}

export interface GamificationConfigInput {
  heartsMax?: number;
  heartsCurrent?: number;
  heartsRefillIntervalMinutes?: number;
  gemsBalance?: number;
  xpTargetDaily?: number;
}

/**
 * Pure function to evaluate auto-refilled hearts based on elapsed time since last consumption.
 */
export function evaluateHeartsState(
  storedCurrent: number,
  maxHearts: number,
  refillIntervalMinutes: number,
  lastConsumedAtIso: string | null,
  nowMs: number = Date.now()
): {
  effectiveCurrent: number;
  newLastConsumedAtIso: string | null;
  secondsUntilNextRefill: number | null;
  secondsUntilFullRefill: number | null;
} {
  if (storedCurrent >= maxHearts || !lastConsumedAtIso) {
    return {
      effectiveCurrent: maxHearts,
      newLastConsumedAtIso: null,
      secondsUntilNextRefill: null,
      secondsUntilFullRefill: null
    };
  }

  const lastMs = new Date(lastConsumedAtIso).getTime();
  if (Number.isNaN(lastMs) || nowMs <= lastMs) {
    const intervalSec = refillIntervalMinutes * 60;
    const missing = maxHearts - storedCurrent;
    return {
      effectiveCurrent: storedCurrent,
      newLastConsumedAtIso: lastConsumedAtIso,
      secondsUntilNextRefill: intervalSec,
      secondsUntilFullRefill: intervalSec * missing
    };
  }

  const intervalMs = refillIntervalMinutes * 60 * 1000;
  const elapsedMs = nowMs - lastMs;
  const recovered = Math.floor(elapsedMs / intervalMs);
  const effectiveCurrent = Math.min(maxHearts, storedCurrent + recovered);

  if (effectiveCurrent >= maxHearts) {
    return {
      effectiveCurrent: maxHearts,
      newLastConsumedAtIso: null,
      secondsUntilNextRefill: null,
      secondsUntilFullRefill: null
    };
  }

  const remainderMs = elapsedMs % intervalMs;
  const nextRefillMs = intervalMs - remainderMs;
  const secondsUntilNextRefill = Math.max(1, Math.ceil(nextRefillMs / 1000));
  const remainingMissingAfterNext = maxHearts - effectiveCurrent - 1;
  const secondsUntilFullRefill =
    secondsUntilNextRefill + remainingMissingAfterNext * (refillIntervalMinutes * 60);

  const advancedAnchorMs = lastMs + recovered * intervalMs;
  return {
    effectiveCurrent,
    newLastConsumedAtIso: new Date(advancedAnchorMs).toISOString(),
    secondsUntilNextRefill,
    secondsUntilFullRefill
  };
}

export function resolveLocalLogicalDate(timezone: string = 'UTC', now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export class GamificationService {
  constructor(private readonly db: DbAdapter) {}

  private async ensureUserRow(tenantId: string, externalUserId: string, logicalDate: string) {
    let row = await this.db.get<any>(
      `SELECT * FROM user_gamification WHERE tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    if (!row) {
      const id = crypto.randomUUID();
      await this.db.execute(
        `INSERT INTO user_gamification (
          id, tenant_id, external_user_id, hearts_current, hearts_max,
          hearts_refill_interval_minutes, last_heart_consumed_at,
          gems_balance, xp_today, xp_target_daily, xp_total,
          last_xp_logical_date, curriculum_progress
        ) VALUES ($1, $2, $3, 5, 5, 240, NULL, 50, 0, 20, 0, $4, '{}')`,
        [id, tenantId, externalUserId, logicalDate]
      );
      row = await this.db.get<any>(
        `SELECT * FROM user_gamification WHERE id = $1`,
        [id]
      );
    }

    return row;
  }

  async getStatus(
    tenantId: string,
    externalUserId: string,
    timezone: string = 'UTC',
    nowMs: number = Date.now()
  ): Promise<GamificationStatusDTO> {
    const logicalDate = resolveLocalLogicalDate(timezone, new Date(nowMs));
    const row = await this.ensureUserRow(tenantId, externalUserId, logicalDate);

    // Evaluate heart auto-refills
    const heartEval = evaluateHeartsState(
      Number(row.hearts_current),
      Number(row.hearts_max),
      Number(row.hearts_refill_interval_minutes),
      row.last_heart_consumed_at,
      nowMs
    );

    // Evaluate Daily XP rollover
    let xpToday = Number(row.xp_today);
    if (row.last_xp_logical_date !== logicalDate) {
      xpToday = 0;
    }

    // Persist if heart count or logical date changed
    if (
      heartEval.effectiveCurrent !== Number(row.hearts_current) ||
      row.last_xp_logical_date !== logicalDate
    ) {
      await this.db.execute(
        `UPDATE user_gamification
         SET hearts_current = $1,
             last_heart_consumed_at = $2,
             xp_today = $3,
             last_xp_logical_date = $4,
             updated_at = $5
         WHERE id = $6`,
        [
          heartEval.effectiveCurrent,
          heartEval.newLastConsumedAtIso,
          xpToday,
          logicalDate,
          new Date(nowMs).toISOString(),
          row.id
        ]
      );
    }

    const targetDaily = Number(row.xp_target_daily) || 20;
    let curriculumProgress: Record<string, number> = {};
    try {
      curriculumProgress = JSON.parse(row.curriculum_progress || '{}');
    } catch {
      curriculumProgress = {};
    }

    return {
      userId: externalUserId,
      hearts: {
        current: heartEval.effectiveCurrent,
        max: Number(row.hearts_max),
        refillIntervalMinutes: Number(row.hearts_refill_interval_minutes),
        secondsUntilNextRefill: heartEval.secondsUntilNextRefill,
        secondsUntilFullRefill: heartEval.secondsUntilFullRefill,
        isFull: heartEval.effectiveCurrent >= Number(row.hearts_max),
        outOfHearts: heartEval.effectiveCurrent <= 0
      },
      gems: {
        balance: Number(row.gems_balance)
      },
      xp: {
        today: xpToday,
        targetDaily,
        total: Number(row.xp_total),
        dailyGoalCompleted: xpToday >= targetDaily,
        logicalDate
      },
      curriculumProgress
    };
  }

  async consumeHeart(
    tenantId: string,
    externalUserId: string,
    count: number = 1,
    timezone: string = 'UTC',
    nowMs: number = Date.now()
  ): Promise<GamificationStatusDTO> {
    const status = await this.getStatus(tenantId, externalUserId, timezone, nowMs);
    const row = await this.db.get<any>(
      `SELECT * FROM user_gamification WHERE tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    const deduct = Math.max(1, count);
    const nextHearts = Math.max(0, status.hearts.current - deduct);
    const wasFull = status.hearts.current >= status.hearts.max;
    const nextConsumedAt =
      nextHearts < status.hearts.max
        ? wasFull || !row.last_heart_consumed_at
          ? new Date(nowMs).toISOString()
          : row.last_heart_consumed_at
        : null;

    await this.db.execute(
      `UPDATE user_gamification
       SET hearts_current = $1,
           last_heart_consumed_at = $2,
           updated_at = $3
       WHERE id = $4`,
      [nextHearts, nextConsumedAt, new Date(nowMs).toISOString(), row.id]
    );

    return this.getStatus(tenantId, externalUserId, timezone, nowMs);
  }

  async refillHearts(
    tenantId: string,
    externalUserId: string,
    method: 'GEMS' | 'PRACTICE' | 'AD' | 'FREE',
    gemCost: number = 50,
    timezone: string = 'UTC',
    nowMs: number = Date.now()
  ): Promise<GamificationStatusDTO> {
    const status = await this.getStatus(tenantId, externalUserId, timezone, nowMs);
    const row = await this.db.get<any>(
      `SELECT * FROM user_gamification WHERE tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    let nextGems = status.gems.balance;
    let nextHearts = status.hearts.current;
    let nextConsumedAt = row.last_heart_consumed_at;

    if (method === 'GEMS') {
      if (nextGems < gemCost) {
        const err = new Error(`Insufficient gems: required ${gemCost}, available ${nextGems}`);
        (err as any).statusCode = 400;
        throw err;
      }
      nextGems -= gemCost;
      nextHearts = status.hearts.max;
      nextConsumedAt = null;
    } else if (method === 'PRACTICE' || method === 'AD') {
      nextHearts = Math.min(status.hearts.max, status.hearts.current + 1);
      if (nextHearts >= status.hearts.max) {
        nextConsumedAt = null;
      }
    } else {
      nextHearts = status.hearts.max;
      nextConsumedAt = null;
    }

    await this.db.execute(
      `UPDATE user_gamification
       SET hearts_current = $1,
           last_heart_consumed_at = $2,
           gems_balance = $3,
           updated_at = $4
       WHERE id = $5`,
      [nextHearts, nextConsumedAt, nextGems, new Date(nowMs).toISOString(), row.id]
    );

    return this.getStatus(tenantId, externalUserId, timezone, nowMs);
  }

  async addXp(
    tenantId: string,
    externalUserId: string,
    amount: number,
    options?: {
      unitId?: string;
      timezone?: string;
      dailyTargetOverride?: number;
      nowMs?: number;
    }
  ): Promise<GamificationStatusDTO & { bonusGemsAwarded: number; dailyGoalJustCompleted: boolean }> {
    const nowMs = options?.nowMs ?? Date.now();
    const timezone = options?.timezone ?? 'UTC';
    const status = await this.getStatus(tenantId, externalUserId, timezone, nowMs);
    const row = await this.db.get<any>(
      `SELECT * FROM user_gamification WHERE tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    const xpDelta = Math.max(0, amount);
    const targetDaily = options?.dailyTargetOverride ?? status.xp.targetDaily;
    const prevToday = status.xp.today;
    const nextToday = prevToday + xpDelta;
    const nextTotal = status.xp.total + xpDelta;

    const dailyGoalJustCompleted = prevToday < targetDaily && nextToday >= targetDaily;
    const bonusGemsAwarded = dailyGoalJustCompleted ? 10 : 0;
    const nextGems = status.gems.balance + bonusGemsAwarded;

    const progress = { ...status.curriculumProgress };
    if (options?.unitId) {
      progress[options.unitId] = (progress[options.unitId] || 0) + 1;
    }

    await this.db.execute(
      `UPDATE user_gamification
       SET xp_today = $1,
           xp_target_daily = $2,
           xp_total = $3,
           gems_balance = $4,
           curriculum_progress = $5,
           updated_at = $6
       WHERE id = $7`,
      [
        nextToday,
        targetDaily,
        nextTotal,
        nextGems,
        JSON.stringify(progress),
        new Date(nowMs).toISOString(),
        row.id
      ]
    );

    const updated = await this.getStatus(tenantId, externalUserId, timezone, nowMs);
    return {
      ...updated,
      bonusGemsAwarded,
      dailyGoalJustCompleted
    };
  }

  async transactGems(
    tenantId: string,
    externalUserId: string,
    amount: number,
    type: 'AWARD' | 'SPEND',
    timezone: string = 'UTC'
  ): Promise<GamificationStatusDTO> {
    const status = await this.getStatus(tenantId, externalUserId, timezone);
    const row = await this.db.get<any>(
      `SELECT * FROM user_gamification WHERE tenant_id = $1 AND external_user_id = $2`,
      [tenantId, externalUserId]
    );

    const delta = Math.abs(amount);
    if (type === 'SPEND' && status.gems.balance < delta) {
      const err = new Error(`Insufficient gems: required ${delta}, available ${status.gems.balance}`);
      (err as any).statusCode = 400;
      throw err;
    }

    const nextBalance = type === 'AWARD' ? status.gems.balance + delta : status.gems.balance - delta;
    await this.db.execute(
      `UPDATE user_gamification
       SET gems_balance = $1,
           updated_at = $2
       WHERE id = $3`,
      [nextBalance, new Date().toISOString(), row.id]
    );

    return this.getStatus(tenantId, externalUserId, timezone);
  }

  async updateConfig(
    tenantId: string,
    externalUserId: string,
    config: GamificationConfigInput,
    timezone: string = 'UTC'
  ): Promise<GamificationStatusDTO> {
    const logicalDate = resolveLocalLogicalDate(timezone);
    const row = await this.ensureUserRow(tenantId, externalUserId, logicalDate);

    const heartsMax = config.heartsMax !== undefined ? Math.max(1, config.heartsMax) : Number(row.hearts_max);
    const heartsCurrent = config.heartsCurrent !== undefined
      ? Math.min(heartsMax, Math.max(0, config.heartsCurrent))
      : Math.min(heartsMax, Number(row.hearts_current));
    const intervalMin = config.heartsRefillIntervalMinutes !== undefined
      ? Math.max(1, config.heartsRefillIntervalMinutes)
      : Number(row.hearts_refill_interval_minutes);
    const gemsBalance = config.gemsBalance !== undefined
      ? Math.max(0, config.gemsBalance)
      : Number(row.gems_balance);
    const xpTargetDaily = config.xpTargetDaily !== undefined
      ? Math.max(1, config.xpTargetDaily)
      : Number(row.xp_target_daily);

    await this.db.execute(
      `UPDATE user_gamification
       SET hearts_max = $1,
           hearts_current = $2,
           hearts_refill_interval_minutes = $3,
           gems_balance = $4,
           xp_target_daily = $5,
           updated_at = $6
       WHERE id = $7`,
      [heartsMax, heartsCurrent, intervalMin, gemsBalance, xpTargetDaily, new Date().toISOString(), row.id]
    );

    return this.getStatus(tenantId, externalUserId, timezone);
  }
}
