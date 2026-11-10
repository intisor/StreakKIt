// api/routes/ai.ts: AI-Native Agent Skills & Instructions for Claude, Cursor, Codex, and Antigravity
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find repo root reliably across dev and dist
function findRepoRoot(): string {
  let cur = __dirname;
  while (cur && cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'docs', 'llms.txt'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();

export async function registerAiRoutes(fastify: FastifyInstance) {
  /**
   * GET /llms.txt
   * Machine-readable documentation standard for LLMs and AI coding assistants.
   */
  fastify.get('/llms.txt', async (_request: FastifyRequest, reply: FastifyReply) => {
    const filePath = path.join(REPO_ROOT, 'docs', 'llms.txt');
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return reply.type('text/plain; charset=utf-8').send(content);
    } catch (_) {
      return reply.type('text/plain; charset=utf-8').send(
        '# StreakKit\nCode-first retention & habit engine with zero dashboards.\nVisit https://intisor.github.io/StreakKIt/ for full docs.'
      );
    }
  });

  /**
   * GET /v1/ai/skills
   * Returns list and content of all supported AI Agent Skills (Claude, Cursor, Codex, Antigravity).
   */
  fastify.get('/v1/ai/skills', async (_request: FastifyRequest, reply: FastifyReply) => {
    const skills = [
      {
        id: 'claude',
        name: 'Claude Code',
        filename: 'CLAUDE.md',
        description: 'Context instructions for Claude Code CLI and Anthropic models.',
        installCommand: 'curl -fsSL https://intisor.github.io/StreakKIt/skills/claude.md > CLAUDE.md'
      },
      {
        id: 'cursor',
        name: 'Cursor IDE',
        filename: '.cursorrules',
        description: 'Rules and MDC directives for Cursor IDE.',
        installCommand: 'curl -fsSL https://intisor.github.io/StreakKIt/skills/cursor.md > .cursorrules'
      },
      {
        id: 'codex',
        name: 'OpenAI Codex & GitHub Copilot',
        filename: '.github/copilot-instructions.md',
        description: 'Custom instructions for Copilot and Codex completions.',
        installCommand: 'curl -fsSL https://intisor.github.io/StreakKIt/skills/codex.md > .github/copilot-instructions.md'
      },
      {
        id: 'antigravity',
        name: 'Antigravity / Universal Agent',
        filename: 'skills/streakkit/SKILL.md',
        description: 'Antigravity standard agent skill with YAML frontmatter.',
        installCommand: 'curl -fsSL https://intisor.github.io/StreakKIt/skills/streakkit.md > SKILL.md'
      }
    ];

    return reply.status(200).send({
      message: 'StreakKit AI-Native Skills for Autonomous Agents',
      availableSkills: skills
    });
  });

  /**
   * GET /v1/ai/skills/:agent
   * Serves the specific agent skill file (e.g. /v1/ai/skills/claude, /v1/ai/skills/cursor)
   */
  fastify.get(
    '/v1/ai/skills/:agent',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agent } = request.params as { agent: string };
      const query = request.query as { format?: string };

      let filePath = '';
      switch (agent.toLowerCase()) {
        case 'claude':
          filePath = path.join(REPO_ROOT, 'CLAUDE.md');
          break;
        case 'cursor':
          filePath = path.join(REPO_ROOT, '.cursorrules');
          break;
        case 'codex':
        case 'copilot':
          filePath = path.join(REPO_ROOT, '.github', 'copilot-instructions.md');
          break;
        case 'antigravity':
        case 'skill':
          filePath = path.join(REPO_ROOT, 'skills', 'streakkit', 'SKILL.md');
          break;
        default:
          filePath = path.join(REPO_ROOT, 'docs', 'skills', 'streakkit.md');
          break;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (query.format === 'json') {
          return reply.status(200).send({ agent, content });
        }
        return reply.type('text/markdown; charset=utf-8').send(content);
      } catch (err: any) {
        return reply.status(404).send({ error: `Skill not found for agent: ${agent}` });
      }
    }
  );
}
