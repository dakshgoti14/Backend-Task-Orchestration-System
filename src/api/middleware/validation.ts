/**
 * Request validation middleware using Joi schemas.
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

export function validate(schema: {
  body?: Joi.Schema;
  params?: Joi.Schema;
  query?: Joi.Schema;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    if (schema.body) {
      const { error } = schema.body.validate(req.body, { abortEarly: false });
      if (error) errors.push(...error.details.map((d) => d.message));
    }
    if (schema.params) {
      const { error } = schema.params.validate(req.params, { abortEarly: false });
      if (error) errors.push(...error.details.map((d) => d.message));
    }
    if (schema.query) {
      const { error } = schema.query.validate(req.query, { abortEarly: false, allowUnknown: true });
      if (error) errors.push(...error.details.map((d) => d.message));
    }

    if (errors.length > 0) {
      res.status(422).json({ error: 'Validation failed', details: errors });
      return;
    }
    next();
  };
}

// ─── Shared Joi schemas ───────────────────────────────────────────────────────

export const jobSchemas = {
  create: Joi.object({
    name: Joi.string().max(255).required(),
    description: Joi.string().max(1000).optional(),
    type: Joi.string()
      .valid(
        'HTTP_REQUEST', 'SHELL_COMMAND', 'DATA_PIPELINE',
        'EMAIL_NOTIFICATION', 'REPORT_GENERATION', 'FILE_PROCESSING',
        'DATABASE_CLEANUP', 'WEBHOOK', 'CUSTOM',
      )
      .required(),
    payload: Joi.object().required(),
    priority: Joi.string()
      .valid('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'BACKGROUND')
      .default('MEDIUM'),
    scheduledAt: Joi.date().iso().optional(),
    cronExpression: Joi.string().max(100).optional(),
    timezone: Joi.string().max(100).default('UTC'),
    timeoutMs: Joi.number().integer().min(1000).max(3_600_000).default(300_000),
    retryConfig: Joi.object({
      maxRetries: Joi.number().integer().min(0).max(10).default(3),
      retryDelay: Joi.number().integer().min(100).max(300_000).default(5000),
      retryBackoff: Joi.string().valid('FIXED', 'EXPONENTIAL', 'JITTER').default('EXPONENTIAL'),
      retryOn: Joi.array().items(Joi.string()).default([]),
    }).default(),
    dependencies: Joi.array().items(
      Joi.object({
        jobId: Joi.string().uuid().required(),
        requireStatus: Joi.array()
          .items(Joi.string().valid('COMPLETED', 'FAILED', 'CANCELLED'))
          .min(1)
          .required(),
      }),
    ).default([]),
    tags: Joi.array().items(Joi.string().max(50)).max(20).default([]),
    metadata: Joi.object().default({}),
  }),

  list: Joi.object({
    status: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.string()),
    ).optional(),
    priority: Joi.string().optional(),
    type: Joi.string().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().valid('createdAt', 'scheduledAt', 'priority', 'status').default('createdAt'),
    sortOrder: Joi.string().valid('ASC', 'DESC').default('DESC'),
    search: Joi.string().max(200).optional(),
  }),
};

export const scheduleSchemas = {
  create: Joi.object({
    name: Joi.string().max(255).required(),
    description: Joi.string().max(1000).optional(),
    cronExpression: Joi.string().max(100).required(),
    timezone: Joi.string().max(100).default('UTC'),
    jobTemplate: Joi.object({
      type: Joi.string().required(),
      payload: Joi.object().required(),
      priority: Joi.string().default('MEDIUM'),
      timeoutMs: Joi.number().default(300_000),
      retryConfig: Joi.object().default({}),
      tags: Joi.array().items(Joi.string()).default([]),
    }).required(),
  }),
};
