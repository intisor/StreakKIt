// db/seed.ts: Seeds initial tenants & rules for ZikFash and Alify
import crypto from 'node:crypto';
import { getDb } from '../config/db.js';

export async function seedDatabase(db = getDb()) {
  await db.migrate();

  // 1. ZikFash Tenant
  const zikfashId = '018f0000-0000-7000-8000-000000000001';
  const zikfashPk = 'pk_live_zikfash_123';
  const zikfashSk = 'sk_live_zikfash_secret';
  const zikfashSkHash = crypto.createHash('sha256').update(zikfashSk).digest('hex');

  const existingZikfash = await db.get('SELECT id FROM tenants WHERE public_key = $1', [zikfashPk]);
  if (!existingZikfash) {
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        zikfashId,
        'ZikFash Technologies',
        zikfashPk,
        zikfashSkHash,
        'https://api.zikfash.com/webhooks/streakkit',
        'whsec_zikfash_test_secret_123'
      ]
    );
    console.log('[Seed] Created tenant: ZikFash');
  }

  // ZikFash Rule: daily_tailor_log
  const existingZikfashRule = await db.get(
    'SELECT id FROM streak_rules WHERE slug = $1',
    ['daily_tailor_log']
  );
  if (!existingZikfashRule) {
    await db.execute(
      `INSERT INTO streak_rules (
        id, tenant_id, slug, name, cadence_type, target_value,
        exempt_days_bitmask, grace_period_minutes, max_freezes,
        auto_consume_freeze, at_risk_lead_minutes, milestone_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        '018f0000-0000-7000-8000-000000000002',
        zikfashId,
        'daily_tailor_log',
        'Daily Tailor Measurement & Order Log',
        'EXEMPT_DAYS',
        1,
        64, // Sundays exempt
        120, // 2-hour grace period past midnight
        2,
        1, // auto_consume_freeze: true
        180, // Fire WhatsApp bot reminder 3h before expiry (e.g. 9:00 PM WAT)
        JSON.stringify([3, 7, 14, 30, 50, 100, 365])
      ]
    );
    console.log('[Seed] Created rule: daily_tailor_log (Sundays exempt, target 1)');
  }

  // 2. Alify Tenant
  const alifyId = '018f0000-0000-7000-8000-000000000003';
  const alifyPk = 'pk_live_alify_456';
  const alifySk = 'sk_live_alify_secret';
  const alifySkHash = crypto.createHash('sha256').update(alifySk).digest('hex');

  const existingAlify = await db.get('SELECT id FROM tenants WHERE public_key = $1', [alifyPk]);
  if (!existingAlify) {
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        alifyId,
        'Alify Music & Lyric Ledger',
        alifyPk,
        alifySkHash,
        'https://api.alify.app/webhooks/streakkit',
        'whsec_alify_test_secret_456'
      ]
    );
    console.log('[Seed] Created tenant: Alify');
  }

  // Alify Rule: alify_playback
  const existingAlifyRule = await db.get(
    'SELECT id FROM streak_rules WHERE slug = $1',
    ['alify_playback']
  );
  if (!existingAlifyRule) {
    await db.execute(
      `INSERT INTO streak_rules (
        id, tenant_id, slug, name, cadence_type, target_value,
        exempt_days_bitmask, grace_period_minutes, max_freezes,
        auto_consume_freeze, at_risk_lead_minutes, milestone_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        '018f0000-0000-7000-8000-000000000004',
        alifyId,
        'alify_playback',
        'Daily Listening & Lyric Notes',
        'DAILY',
        3, // 3 tracks observed or 1 lyric saved
        0, // Daily (no days exempt)
        180, // 3-hour grace period
        2,
        1,
        120, // 2-hour lead time for at-risk notifications
        JSON.stringify([3, 7, 14, 30, 50, 100, 365])
      ]
    );
    console.log('[Seed] Created rule: alify_playback (Daily, target 3)');
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(() => {
      console.log('Seeding completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
