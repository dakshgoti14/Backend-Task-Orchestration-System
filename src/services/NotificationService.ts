/**
 * NotificationService — event-driven alerting for job lifecycle events.
 *
 * Notification channels:
 *  - Webhook (HTTP POST to configured URL)
 *  - Slack (Incoming Webhooks)
 *  - Email (SMTP via stubbed handler)
 *
 * Events emitted:
 *  - job.failed        — any job failure
 *  - job.dlq           — job moved to DLQ
 *  - job.completed     — optional success notifications
 *  - scheduler.error   — scheduler internal errors
 *  - worker.lost       — worker heartbeat timeout
 */

import axios from 'axios';
import { config } from '../utils/config';
import { createLogger } from '../utils/logger';
import { Job } from '../models/Job';
import { metricsService } from '../monitoring/MetricsService';

const log = createLogger('NotificationService');

export type NotificationEvent =
  | 'job.failed'
  | 'job.dlq'
  | 'job.completed'
  | 'scheduler.error'
  | 'worker.lost'
  | 'worker.recovered';

export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: string;
  job?: {
    id: string;
    name: string;
    type: string;
    priority: string;
    retryCount: number;
    errorMessage?: string;
  };
  worker?: {
    id: string;
    hostname: string;
    lostAt: string;
  };
  message?: string;
}

export class NotificationService {
  private webhookUrl: string;

  constructor() {
    this.webhookUrl = config.monitoring.alertWebhookUrl;
  }

  async notifyJobFailed(job: Job): Promise<void> {
    const payload: NotificationPayload = {
      event: 'job.failed',
      timestamp: new Date().toISOString(),
      job: {
        id: job.id,
        name: job.name,
        type: job.type,
        priority: job.priority,
        retryCount: job.retryCount,
        errorMessage: job.errorMessage,
      },
    };

    await Promise.allSettled([
      this.sendWebhook(payload),
      this.sendSlack(payload),
    ]);
  }

  async notifyJobDLQ(job: Job): Promise<void> {
    const payload: NotificationPayload = {
      event: 'job.dlq',
      timestamp: new Date().toISOString(),
      job: {
        id: job.id,
        name: job.name,
        type: job.type,
        priority: job.priority,
        retryCount: job.retryCount,
        errorMessage: job.errorMessage,
      },
      message: `Job "${job.name}" has been moved to the dead letter queue after ${job.retryCount} attempts.`,
    };

    await Promise.allSettled([
      this.sendWebhook(payload),
      this.sendSlack(payload),
    ]);
  }

  async notifyWorkerLost(workerId: string, hostname: string): Promise<void> {
    const payload: NotificationPayload = {
      event: 'worker.lost',
      timestamp: new Date().toISOString(),
      worker: { id: workerId, hostname, lostAt: new Date().toISOString() },
      message: `Worker ${hostname} (${workerId}) has stopped sending heartbeats.`,
    };

    await Promise.allSettled([this.sendWebhook(payload), this.sendSlack(payload)]);
  }

  private async sendWebhook(payload: NotificationPayload): Promise<void> {
    if (!this.webhookUrl) return;

    try {
      await axios.post(this.webhookUrl, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      });
      log.debug('Webhook notification sent', { event: payload.event });
    } catch (err) {
      log.warn('Webhook notification failed', { event: payload.event, error: err });
    }
  }

  private async sendSlack(payload: NotificationPayload): Promise<void> {
    if (!this.webhookUrl || !this.webhookUrl.includes('slack.com')) return;

    const icons: Record<NotificationEvent, string> = {
      'job.failed':          ':x:',
      'job.dlq':             ':skull:',
      'job.completed':       ':white_check_mark:',
      'scheduler.error':     ':warning:',
      'worker.lost':         ':robot_face:',
      'worker.recovered':    ':green_heart:',
    };

    const slackPayload = {
      text: `${icons[payload.event] ?? ':bell:'} *BTOS Alert* — \`${payload.event}\``,
      attachments: [
        {
          color: payload.event.includes('failed') || payload.event.includes('dlq') ? '#FF0000' : '#36A64F',
          fields: payload.job
            ? [
                { title: 'Job', value: `${payload.job.name} (\`${payload.job.id}\`)`, short: true },
                { title: 'Type', value: payload.job.type, short: true },
                { title: 'Priority', value: payload.job.priority, short: true },
                { title: 'Retries', value: String(payload.job.retryCount), short: true },
                payload.job.errorMessage
                  ? { title: 'Error', value: payload.job.errorMessage, short: false }
                  : null,
              ].filter(Boolean)
            : [{ title: 'Message', value: payload.message ?? '', short: false }],
          footer: 'Backend Task Orchestration System',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      await axios.post(this.webhookUrl, slackPayload, { timeout: 5000 });
    } catch (err) {
      log.warn('Slack notification failed', { error: err });
    }
  }
}

export const notificationService = new NotificationService();
