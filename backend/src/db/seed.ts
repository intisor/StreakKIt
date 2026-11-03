// db/seed.ts: Seeds initial tenants & rules for ZikFash and Hujjify
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

  // 2. Hujjify Tenant
  const hujjifyId = '018f0000-0000-7000-8000-000000000003';
  const hujjifyPk = 'pk_live_hujjify_456';
  const hujjifySk = 'sk_live_hujjify_secret';
  const hujjifySkHash = crypto.createHash('sha256').update(hujjifySk).digest('hex');

  const existingHujjify = await db.get('SELECT id FROM tenants WHERE public_key = $1', [hujjifyPk]);
  if (!existingHujjify) {
    await db.execute(
      `INSERT INTO tenants (id, name, public_key, secret_key_hash, webhook_url, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        hujjifyId,
        'Hujjify Music & Lyric Ledger',
        hujjifyPk,
        hujjifySkHash,
        'https://api.hujjify.app/webhooks/streakkit',
        'whsec_hujjify_test_secret_456'
      ]
    );
    console.log('[Seed] Created tenant: Hujjify');
  }

  // Hujjify Rule: hujjify_playback
  const existingHujjifyRule = await db.get(
    'SELECT id FROM streak_rules WHERE slug = $1',
    ['hujjify_playback']
  );
  if (!existingHujjifyRule) {
    const tenantRow = await db.get('SELECT id FROM tenants WHERE public_key = $1', [hujjifyPk]);
    await db.execute(
      `INSERT INTO streak_rules (
        id, tenant_id, slug, name, cadence_type, target_value,
        exempt_days_bitmask, grace_period_minutes, max_freezes,
        auto_consume_freeze, at_risk_lead_minutes, milestone_days
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        '018f0000-0000-7000-8000-000000000004',
        tenantRow ? tenantRow.id : hujjifyId,
        'hujjify_playback',
        'Daily Listening & Engagement',
        'DAILY',
        1,
        0,
        180,
        2,
        1,
        120,
        JSON.stringify([3, 7, 14, 30, 50, 100, 365])
      ]
    );
    console.log('[Seed] Created rule: hujjify_playback (Daily, target 1)');
  } else {
    await db.execute(
      `UPDATE streak_rules SET target_value = 1, name = 'Daily Listening & Engagement' WHERE id = $1`,
      [existingHujjifyRule.id]
    );
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
