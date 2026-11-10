// tests/ai.test.ts: Tests for AI Agent Skills, llms.txt, and Agent Directives
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/config/db.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildServer } from '../src/server.js';

describe('AI-Native Agent Skills & llms.txt Directives', () => {
  let app: any;

  before(async () => {
    const db = getDb();
    await db.migrate();
    await seedDatabase(db);
    app = await buildServer();
  });

  it('1. GET /llms.txt returns machine-readable LLM specification with 200 OK', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/llms.txt'
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/plain'));
    assert.ok(res.body.includes('Machine-Readable LLM Directives'));
    assert.ok(res.body.includes('Do not create an external dashboard account'));
  });

  it('2. GET /v1/ai/skills returns full catalog of agent skills', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ai/skills'
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.availableSkills));
    assert.equal(data.availableSkills.length, 4);

    const ids = data.availableSkills.map((s: any) => s.id);
    assert.ok(ids.includes('claude'));
    assert.ok(ids.includes('cursor'));
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('antigravity'));
  });

  it('3. GET /v1/ai/skills/:agent returns plain markdown instructions for each agent', async () => {
    // Claude
    const claudeRes = await app.inject({ method: 'GET', url: '/v1/ai/skills/claude' });
    assert.equal(claudeRes.statusCode, 200);
    assert.ok(claudeRes.body.includes('StreakKit — Claude Code Agent Guide'));

    // Cursor
    const cursorRes = await app.inject({ method: 'GET', url: '/v1/ai/skills/cursor' });
    assert.equal(cursorRes.statusCode, 200);
    assert.ok(cursorRes.body.includes('StreakKit Cursor Rules'));

    // Codex
    const codexRes = await app.inject({ method: 'GET', url: '/v1/ai/skills/codex' });
    assert.equal(codexRes.statusCode, 200);
    assert.ok(codexRes.body.includes('GitHub Copilot & OpenAI Codex Instructions'));

    // Antigravity
    const antiRes = await app.inject({ method: 'GET', url: '/v1/ai/skills/antigravity' });
    assert.equal(antiRes.statusCode, 200);
    assert.ok(antiRes.body.includes('name: streakkit'));
  });

  it('4. GET /v1/ai/skills/:agent?format=json returns JSON format', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/ai/skills/claude?format=json' });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.agent, 'claude');
    assert.ok(typeof json.content === 'string');
    assert.ok(json.content.includes('StreakKit'));
  });
});
