/**
 * Authentication middleware — supports both JWT bearer tokens and API keys.
 *
 * Authorization flow:
 *  1. Extract token from Authorization header (Bearer <token> or ApiKey <key>)
 *  2. JWT: verify signature and expiry
 *  3. API key: hash and compare against database; check scope
 *  4. Attach decoded identity to req.user
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, TABLES } from '../../db/index';
import { config } from '../../utils/config';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthMiddleware');

export interface AuthUser {
  userId: string;
  organizationId: string;
  email: string;
  role: string;
  scopes: string[];
  authType: 'jwt' | 'apikey';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    try {
      let user: AuthUser;

      if (authHeader.startsWith('Bearer ')) {
        user = await verifyJWT(authHeader.slice(7));
      } else if (authHeader.startsWith('ApiKey ')) {
        user = await verifyApiKey(authHeader.slice(7));
      } else {
        res.status(401).json({ error: 'Invalid authorization scheme (use Bearer or ApiKey)' });
        return;
      }

      // Check required scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every((s) => user.scopes.includes(s));
        if (!hasAllScopes) {
          res.status(403).json({
            error: 'Insufficient permissions',
            required: requiredScopes,
            granted: user.scopes,
          });
          return;
        }
      }

      req.user = user;
      next();
    } catch (err) {
      const error = err as Error;
      if (error.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'Token expired' });
        return;
      }
      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
      log.warn('Auth error', { error: error.message });
      res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

async function verifyJWT(token: string): Promise<AuthUser> {
  const decoded = jwt.verify(token, config.auth.jwtSecret) as {
    sub: string;
    organizationId: string;
    email: string;
    role: string;
    scopes: string[];
  };

  return {
    userId: decoded.sub,
    organizationId: decoded.organizationId,
    email: decoded.email,
    role: decoded.role,
    scopes: decoded.scopes ?? ['jobs:read', 'jobs:write'],
    authType: 'jwt',
  };
}

async function verifyApiKey(rawKey: string): Promise<AuthUser> {
  if (!rawKey || rawKey.length < 8) throw new Error('Invalid API key format');

  const prefix = rawKey.slice(0, 8);

  const apiKeyRows = await db(TABLES.API_KEYS)
    .join(TABLES.USERS, `${TABLES.API_KEYS}.user_id`, `${TABLES.USERS}.id`)
    .where(`${TABLES.API_KEYS}.key_prefix`, prefix)
    .where(`${TABLES.API_KEYS}.is_active`, true)
    .whereRaw(`(${TABLES.API_KEYS}.expires_at IS NULL OR ${TABLES.API_KEYS}.expires_at > NOW())`)
    .select(
      `${TABLES.API_KEYS}.id as api_key_id`,
      `${TABLES.API_KEYS}.key_hash`,
      `${TABLES.API_KEYS}.scopes`,
      `${TABLES.API_KEYS}.organization_id`,
      `${TABLES.USERS}.id as user_id`,
      `${TABLES.USERS}.email`,
      `${TABLES.USERS}.role`,
    );

  for (const row of apiKeyRows) {
    const matches = await bcrypt.compare(rawKey, row.key_hash);
    if (matches) {
      // Update last_used_at async (fire-and-forget)
      db(TABLES.API_KEYS)
        .where({ id: row.api_key_id })
        .update({ last_used_at: new Date() })
        .catch(() => {});

      return {
        userId: row.user_id,
        organizationId: row.organization_id,
        email: row.email,
        role: row.role,
        scopes: row.scopes,
        authType: 'apikey',
      };
    }
  }

  throw new Error('Invalid API key');
}

/**
 * Generate a signed JWT for a user (used by login endpoint).
 */
export function generateToken(user: Omit<AuthUser, 'authType'>): string {
  return jwt.sign(
    {
      sub: user.userId,
      organizationId: user.organizationId,
      email: user.email,
      role: user.role,
      scopes: user.scopes,
    },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn },
  );
}
