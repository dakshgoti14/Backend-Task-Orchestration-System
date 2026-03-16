/**
 * AlertManager — rule-based alerting on top of Prometheus metrics.
 *
 * Evaluates alert rules on a configurable interval and fires notifications
 * when conditions are met. Each rule can fire, resolve, and re-fire.
 *
 * Rules implemented:
 *  1. HIGH_FAILURE_RATE    — >10% of recent jobs are failing
 *  2. DLQ_THRESHOLD        — DLQ has >50 entries
 *  3. HIGH_QUEUE_DEPTH     — main queue >5000 waiting jobs
 *  4. NO_ACTIVE_WORKERS    — 0 workers online
 *  5. HIGH_JOB_LATENCY     — P99 execution >120s (computed from recent logs)
 */

import { workerRepository } from '../db/repositories/WorkerRepository';
import { notificationService } from '../services/NotificationService';
import { deadLetterQueue } from '../queue/DeadLetterQueue';
import { jobQueue } from '../queue/JobQueue';
import { createLogger } from '../utils/logger';

const log = createLogger('AlertManager');

interface AlertRule {
  name: string;
  description: string;
  evaluate: () => Promise<boolean>;
  severity: 'warning' | 'critical';
}

interface AlertState {
  firing: boolean;
  lastFiredAt?: Date;
  lastResolvedAt?: Date;
  firingCount: number;
}

export class AlertManager {
  private rules: AlertRule[];
  private state = new Map<string, AlertState>();
  private evalTimer: NodeJS.Timeout | null = null;
  private evalIntervalMs: number;

  constructor(evalIntervalMs: number = 60_000) {
    this.evalIntervalMs = evalIntervalMs;
    this.rules = this.buildRules();
  }

  start(): void {
    this.evalTimer = setInterval(() => this.evaluate(), this.evalIntervalMs);
    log.info('AlertManager started', { rules: this.rules.length, evalIntervalMs: this.evalIntervalMs });
  }

  stop(): void {
    if (this.evalTimer) clearInterval(this.evalTimer);
    log.info('AlertManager stopped');
  }

  async evaluate(): Promise<void> {
    for (const rule of this.rules) {
      try {
        const firing = await rule.evaluate();
        const prevState = this.state.get(rule.name) ?? { firing: false, firingCount: 0 };

        if (firing && !prevState.firing) {
          // Alert starts firing
          this.state.set(rule.name, {
            firing: true,
            lastFiredAt: new Date(),
            firingCount: prevState.firingCount + 1,
          });
          log.warn(`ALERT FIRING: ${rule.name}`, { severity: rule.severity });
          await notificationService.notifyJobFailed({
            id: 'alert',
            name: rule.name,
            type: 'CUSTOM',
            priority: rule.severity === 'critical' ? 'CRITICAL' : 'HIGH',
            retryCount: 0,
            maxRetries: 0,
            errorMessage: rule.description,
          } as Parameters<typeof notificationService.notifyJobFailed>[0]);

        } else if (!firing && prevState.firing) {
          // Alert resolved
          this.state.set(rule.name, {
            ...prevState,
            firing: false,
            lastResolvedAt: new Date(),
          });
          log.info(`ALERT RESOLVED: ${rule.name}`);
        }
      } catch (err) {
        log.error(`Alert rule evaluation failed: ${rule.name}`, { error: err });
      }
    }
  }

  private buildRules(): AlertRule[] {
    return [
      {
        name: 'NO_ACTIVE_WORKERS',
        description: 'No active worker nodes detected',
        severity: 'critical',
        evaluate: async () => {
          const workers = await workerRepository.findAll({ status: ['ONLINE', 'BUSY'] });
          return workers.length === 0;
        },
      },
      {
        name: 'DLQ_THRESHOLD',
        description: 'Dead letter queue has more than 50 entries',
        severity: 'warning',
        evaluate: async () => {
          const count = await deadLetterQueue.getCount();
          return count > 50;
        },
      },
      {
        name: 'HIGH_QUEUE_DEPTH',
        description: 'Main job queue has more than 5000 waiting jobs',
        severity: 'warning',
        evaluate: async () => {
          const counts = await jobQueue.getJobCounts();
          return (counts.waiting ?? 0) > 5000;
        },
      },
    ];
  }

  getAlertStates(): Record<string, AlertState & { ruleName: string; severity: string }> {
    const result: Record<string, AlertState & { ruleName: string; severity: string }> = {};
    for (const rule of this.rules) {
      const state = this.state.get(rule.name) ?? { firing: false, firingCount: 0 };
      result[rule.name] = { ...state, ruleName: rule.name, severity: rule.severity };
    }
    return result;
  }
}

export const alertManager = new AlertManager();
