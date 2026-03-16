/**
 * DistributedLock — Redlock-based mutual exclusion across nodes.
 *
 * Implements the Redlock algorithm (Martin Kleppmann) for distributed locking:
 *  1. Acquire lock on N/2+1 Redis nodes (we use single node for simplicity,
 *     but the abstraction supports multi-node Redlock)
 *  2. Lock includes a random token (UUID) to prevent accidental releases
 *  3. Lock TTL prevents indefinite blockage on node crash
 *  4. Renewal extends TTL before expiry (heartbeat pattern)
 *
 * Usage:
 *   const lock = await distributedLock.tryAcquire('scheduler:leader', 30000);
 *   if (lock) { ... await distributedLock.renew('scheduler:leader', 30000); }
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';

const log = createLogger('DistributedLock');

const LOCK_PREFIX = `${config.redis.keyPrefix}lock:`;

interface LockEntry {
  token: string;
  expiresAt: number;
}

class DistributedLockClass {
  private redis: Redis;
  private locks = new Map<string, LockEntry>();

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.redis.on('error', (err) => {
      log.error('DistributedLock Redis error', { error: err });
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  /**
   * Try to acquire a lock. Returns true on success, false if already held.
   *
   * Uses SET key token NX PX ttl — atomic in Redis 2.6.12+
   */
  async tryAcquire(resource: string, ttlMs: number): Promise<boolean> {
    const key = LOCK_PREFIX + resource;
    const token = uuidv4();

    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    const acquired = result === 'OK';

    if (acquired) {
      this.locks.set(resource, { token, expiresAt: Date.now() + ttlMs });
      log.debug('Lock acquired', { resource, ttlMs });
    }

    return acquired;
  }

  /**
   * Renew a held lock's TTL. Returns false if the lock was lost (e.g., Redis restart).
   *
   * Uses a Lua script for atomic check-and-extend.
   */
  async renew(resource: string, ttlMs: number): Promise<boolean> {
    const entry = this.locks.get(resource);
    if (!entry) return false;

    const key = LOCK_PREFIX + resource;

    // Lua: only extend if the token matches (we still hold it)
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, key, entry.token, String(ttlMs));
    const renewed = result === 1;

    if (renewed) {
      entry.expiresAt = Date.now() + ttlMs;
      log.debug('Lock renewed', { resource, ttlMs });
    } else {
      this.locks.delete(resource);
      log.warn('Lock renewal failed — lock was lost', { resource });
    }

    return renewed;
  }

  /**
   * Release a held lock. Only releases if we still hold it (token match).
   */
  async release(resource: string): Promise<void> {
    const entry = this.locks.get(resource);
    if (!entry) return;

    const key = LOCK_PREFIX + resource;

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    await this.redis.eval(script, 1, key, entry.token);
    this.locks.delete(resource);
    log.debug('Lock released', { resource });
  }

  /**
   * Execute a callback while holding the lock.
   * Automatically releases on completion or error.
   */
  async withLock<T>(
    resource: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const acquired = await this.tryAcquire(resource, ttlMs);
    if (!acquired) return null;

    try {
      return await fn();
    } finally {
      await this.release(resource);
    }
  }

  isHeld(resource: string): boolean {
    const entry = this.locks.get(resource);
    return entry !== undefined && entry.expiresAt > Date.now();
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export const distributedLock = new DistributedLockClass();
