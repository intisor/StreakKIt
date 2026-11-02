// api/middleware/auth.ts: Tenant API key verification (public & secret keys)
import crypto from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../config/db.js';
import { Tenant } from '../../domain/types.js';

export interface AuthenticatedRequest extends FastifyRequest {
  tenant?: Tenant;
  authType?: 'PUBLIC' | 'SECRET';
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7).trim();
  const db = getDb();

  if (token.startsWith('pk_live_') || token.startsWith('pk_test_')) {
    // Public Key Lookup
    const tenantRow = await db.get(
      'SELECT id, name, public_key, secret_key_hash, webhook_url, webhook_secret, created_at FROM tenants WHERE public_key = $1',
      [token]
    );

    if (!tenantRow) {
      return reply.status(401).send({ error: 'Invalid public API key' });
    }

    (request as AuthenticatedRequest).tenant = {
      id: tenantRow.id,
      name: tenantRow.name,
      publicKey: tenantRow.public_key,
      secretKeyHash: tenantRow.secret_key_hash,
      webhookUrl: tenantRow.webhook_url,
      webhookSecret: tenantRow.webhook_secret,
      createdAt: tenantRow.created_at
    };
    (request as AuthenticatedRequest).authType = 'PUBLIC';
    return;
  }

  if (token.startsWith('sk_live_') || token.startsWith('sk_test_')) {
    // Secret Key Lookup (Hashed)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tenantRow = await db.get(
      'SELECT id, name, public_key, secret_key_hash, webhook_url, webhook_secret, created_at FROM tenants WHERE secret_key_hash = $1',
      [tokenHash]
    );

    if (!tenantRow) {
      return reply.status(401).send({ error: 'Invalid secret API key' });
    }

    (request as AuthenticatedRequest).tenant = {
      id: tenantRow.id,
      name: tenantRow.name,
      publicKey: tenantRow.public_key,
      secretKeyHash: tenantRow.secret_key_hash,
      webhookUrl: tenantRow.webhook_url,
      webhookSecret: tenantRow.webhook_secret,
      createdAt: tenantRow.created_at
    };
    (request as AuthenticatedRequest).authType = 'SECRET';
    return;
  }

  return reply.status(401).send({ error: 'Unrecognized API key format. Expected pk_live_ or sk_live_' });
}

export async function requireSecretKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await authenticateApiKey(request, reply);
  if ((request as AuthenticatedRequest).authType !== 'SECRET') {
    return reply.status(403).send({ error: 'This endpoint requires a secret API key (sk_live_...)' });
  }
}
