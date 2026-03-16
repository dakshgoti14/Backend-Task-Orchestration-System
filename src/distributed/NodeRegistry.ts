/**
 * NodeRegistry — Redis-backed service discovery for all running instances.
 *
 * Each scheduler/API node registers itself here on startup so other nodes
 * can discover the current topology. Used for:
 *  - Displaying active nodes in the dashboard
 *  - Routing metrics collection
 *  - Health-aware load shedding
 *
 * Keys: btos:nodes:<instanceId> → JSON { ...NodeInfo } with TTL
 */

import Redis from 'ioredis';
import os from 'os';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';

const log = createLogger('NodeRegistry');
const NODE_KEY_PREFIX = `${config.redis.keyPrefix}nodes:`;
const NODE_TTL_SECONDS = 30; // nodes expire after 30s without heartbeat

export interface NodeInfo {
  instanceId: string;
  role: 'api' | 'scheduler' | 'worker';
  hostname: string;
  ipAddress: string;
  pid: number;
  version: string;
  startedAt: string;
  lastHeartbeatAt: string;
  isLeader: boolean;
  metadata: Record<string, unknown>;
}

class NodeRegistryClass {
  private redis: Redis;
  private instanceId: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private nodeInfo: NodeInfo | null = null;

  constructor() {
    this.instanceId = `${os.hostname()}_${process.pid}`;
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async register(
    role: NodeInfo['role'],
    isLeader: boolean = false,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    this.nodeInfo = {
      instanceId: this.instanceId,
      role,
      hostname: os.hostname(),
      ipAddress: this.getLocalIp(),
      pid: process.pid,
      version: process.env.npm_package_version ?? '1.0.0',
      startedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      isLeader,
      metadata,
    };

    await this.redis.set(
      NODE_KEY_PREFIX + this.instanceId,
      JSON.stringify(this.nodeInfo),
      'EX',
      NODE_TTL_SECONDS,
    );

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.heartbeat(), NODE_TTL_SECONDS * 400);
    log.info('Node registered', { instanceId: this.instanceId, role });
  }

  private async heartbeat(): Promise<void> {
    if (!this.nodeInfo) return;
    this.nodeInfo.lastHeartbeatAt = new Date().toISOString();
    try {
      await this.redis.set(
        NODE_KEY_PREFIX + this.instanceId,
        JSON.stringify(this.nodeInfo),
        'EX',
        NODE_TTL_SECONDS,
      );
    } catch (err) {
      log.warn('Node heartbeat failed', { error: err });
    }
  }

  async updateLeaderStatus(isLeader: boolean): Promise<void> {
    if (this.nodeInfo) {
      this.nodeInfo.isLeader = isLeader;
      await this.heartbeat();
    }
  }

  async getAllNodes(): Promise<NodeInfo[]> {
    const keys = await this.redis.keys(NODE_KEY_PREFIX + '*');
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as NodeInfo);
  }

  async deregister(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.redis.del(NODE_KEY_PREFIX + this.instanceId);
    log.info('Node deregistered', { instanceId: this.instanceId });
  }

  async disconnect(): Promise<void> {
    await this.deregister();
    await this.redis.quit();
  }

  private getLocalIp(): string {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
    return '127.0.0.1';
  }
}

export const nodeRegistry = new NodeRegistryClass();
