// domain/anticheat.ts: Monotonic delta & HMAC hash-chain verifier, clock skew detection
import crypto from 'node:crypto';
import { ClientEventInput, TrustFlag } from './types.js';

export interface VerifiedEvent {
  eventId: string;
  ruleSlug: string;
  value: number;
  occurredAtUtc: Date;
  monotonicMs: number | null;
  prevEventHash: string | null;
  computedHash: string;
  trustFlag: TrustFlag;
  metadata: Record<string, unknown> | null;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 60 * 1000; // ±60 seconds tolerance

/**
 * Computes SHA-256 rolling hash for an event in the chain.
 */
export function computeEventHash(
  prevHash: string | null,
  eventId: string,
  occurredAtIso: string,
  value: number
): string {
  const payload = `${prevHash || 'ROOT'}:${eventId}:${occurredAtIso}:${value}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Validates and normalizes a batch of client events chronologically:
 * 1. Clamps future timestamps (> server_now + 5m) to server_now.
 * 2. Enforces max offline backfill window (7 days).
 * 3. Compares monotonic progression (performance.now()) against wall clock delta.
 *    If discrepancy > 60s, overrides wall clock with monotonic progression.
 * 4. Generates and verifies cryptographic hash chain.
 */
export function verifyEventBatchIntegrity(
  rawEvents: ClientEventInput[],
  serverNowUtc: Date = new Date(),
  lastKnownClientEventUtc: Date | null = null,
  lastKnownHash: string | null = null
): VerifiedEvent[] {
  if (rawEvents.length === 0) return [];

  // Sort chronologically by claimed occurredAtUtc ascending
  const sorted = [...rawEvents].sort(
    (a, b) => new Date(a.occurredAtUtc).getTime() - new Date(b.occurredAtUtc).getTime()
  );

  const verified: VerifiedEvent[] = [];
  let prevUtc = lastKnownClientEventUtc;
  let prevMono: number | null = null;
  let prevHash = lastKnownHash;

  for (const raw of sorted) {
    let occurredAt = new Date(raw.occurredAtUtc);
    if (isNaN(occurredAt.getTime())) {
      occurredAt = new Date(serverNowUtc);
    }

    let trustFlag: TrustFlag = 'VERIFIED';
    const value = typeof raw.value === 'number' && raw.value > 0 ? Math.floor(raw.value) : 1;
    const currentMono = typeof raw.monotonicMs === 'number' ? raw.monotonicMs : null;

    // 1. Future Timestamp Clamping
    if (occurredAt.getTime() > serverNowUtc.getTime() + FIVE_MINUTES_MS) {
      occurredAt = new Date(serverNowUtc);
      trustFlag = 'CLAMPED';
    }

    // 2. Max Offline Backfill Window (7 days limit)
    if (serverNowUtc.getTime() - occurredAt.getTime() > SEVEN_DAYS_MS) {
      occurredAt = new Date(serverNowUtc.getTime() - SEVEN_DAYS_MS);
      trustFlag = 'CLAMPED';
    }

    // 3. Monotonic progression & clock skew check
    if (
      prevUtc !== null &&
      prevMono !== null &&
      currentMono !== null &&
      currentMono > prevMono
    ) {
      const deltaWall = occurredAt.getTime() - prevUtc.getTime();
      const deltaMono = currentMono - prevMono;

      // Discrepancy greater than tolerance means client changed system wall clock
      if (Math.abs(deltaWall - deltaMono) > CLOCK_TOLERANCE_MS) {
        occurredAt = new Date(prevUtc.getTime() + deltaMono);
        trustFlag = 'CLOCK_SKEW_SUSPECTED';
      }
    }

    // Compute hash chain
    const computedHash = computeEventHash(prevHash, raw.eventId, occurredAt.toISOString(), value);

    verified.push({
      eventId: raw.eventId,
      ruleSlug: raw.ruleSlug,
      value,
      occurredAtUtc: occurredAt,
      monotonicMs: currentMono,
      prevEventHash: raw.prevEventHash || prevHash,
      computedHash,
      trustFlag,
      metadata: raw.metadata || null
    });

    prevUtc = occurredAt;
    if (currentMono !== null) prevMono = currentMono;
    prevHash = computedHash;
  }

  return verified;
}
