/**
 * LeaderElection — coordinates which scheduler instance is the active leader.
 *
 * Algorithm:
 *  1. All instances compete for a Redis lock with a TTL
 *  2. Winner becomes leader and runs the scheduling loop
 *  3. Leader renews the lock periodically (heartbeat)
 *  4. On renewal failure, steps down and triggers a new election
 *  5. Followers poll the lock status and attempt to acquire on leader failure
 *
 * This is an eventually consistent approach — there may be brief periods
 * (up to lock TTL) where no leader exists or where two leaders think they hold
 * the lock simultaneously. The scheduler's FOR UPDATE SKIP LOCKED ensures
 * idempotent job claiming even in split-brain scenarios.
 */

import EventEmitter from 'eventemitter3';
import { distributedLock } from './DistributedLock';
import { createLogger } from '../utils/logger';
import { sleep } from '../utils/helpers';

const log = createLogger('LeaderElection');

export type LeaderRole = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';

export class LeaderElection extends EventEmitter {
  private role: LeaderRole = 'FOLLOWER';
  private lockKey: string;
  private ttlMs: number;
  private campaignIntervalMs: number;
  private renewalIntervalMs: number;
  private campaignTimer: NodeJS.Timeout | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;
  private instanceId: string;
  private isRunning = false;

  constructor(opts: {
    lockKey?: string;
    ttlMs?: number;
    instanceId?: string;
  } = {}) {
    super();
    this.lockKey = opts.lockKey ?? 'scheduler:leader';
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.campaignIntervalMs = Math.floor(this.ttlMs * 0.8);
    this.renewalIntervalMs = Math.floor(this.ttlMs * 0.5);
    this.instanceId = opts.instanceId ?? `instance_${Math.random().toString(36).slice(2)}`;
  }

  async start(): Promise<void> {
    this.isRunning = true;
    log.info('LeaderElection started', { instanceId: this.instanceId, ttlMs: this.ttlMs });
    await this.campaign();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.campaignTimer) clearTimeout(this.campaignTimer);
    if (this.renewalTimer) clearInterval(this.renewalTimer);

    if (this.role === 'LEADER') {
      await distributedLock.release(this.lockKey);
      this.role = 'FOLLOWER';
      log.info('Leader stepped down gracefully', { instanceId: this.instanceId });
    }
  }

  private async campaign(): Promise<void> {
    if (!this.isRunning) return;

    this.role = 'CANDIDATE';

    try {
      const acquired = await distributedLock.tryAcquire(this.lockKey, this.ttlMs);

      if (acquired) {
        this.becomeLeader();
      } else {
        this.becomeFollower();
        // Schedule next campaign attempt
        this.campaignTimer = setTimeout(
          () => this.campaign(),
          this.campaignIntervalMs,
        );
      }
    } catch (err) {
      log.error('Campaign failed', { error: err });
      this.role = 'FOLLOWER';
      this.campaignTimer = setTimeout(() => this.campaign(), 5000);
    }
  }

  private becomeLeader(): void {
    this.role = 'LEADER';
    log.info('Became leader', { instanceId: this.instanceId });
    this.emit('leader:acquired', { instanceId: this.instanceId });

    // Start lock renewal
    this.renewalTimer = setInterval(async () => {
      const renewed = await distributedLock.renew(this.lockKey, this.ttlMs);
      if (!renewed) {
        log.warn('Lock renewal failed — stepping down', { instanceId: this.instanceId });
        clearInterval(this.renewalTimer!);
        this.role = 'FOLLOWER';
        this.emit('leader:lost', { instanceId: this.instanceId });
        // Re-enter election after brief pause
        await sleep(2000);
        await this.campaign();
      }
    }, this.renewalIntervalMs);
  }

  private becomeFollower(): void {
    if (this.role !== 'FOLLOWER') {
      this.role = 'FOLLOWER';
      log.debug('Became follower', { instanceId: this.instanceId });
      this.emit('follower', { instanceId: this.instanceId });
    }
  }

  isLeader(): boolean {
    return this.role === 'LEADER';
  }

  getRole(): LeaderRole {
    return this.role;
  }

  getInstanceId(): string {
    return this.instanceId;
  }
}

export const leaderElection = new LeaderElection();
