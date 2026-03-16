import rateLimit from 'express-rate-limit';
import { config } from '../../utils/config';

export const apiRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by API key / user ID if authenticated, else by IP
    if (req.user) return req.user.userId;
    return req.ip ?? 'unknown';
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    });
  },
});

// Stricter limit for bulk operations
export const bulkRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.organizationId ?? req.ip ?? 'unknown',
  handler: (req, res) => {
    res.status(429).json({ error: 'Bulk operation rate limit exceeded' });
  },
});
