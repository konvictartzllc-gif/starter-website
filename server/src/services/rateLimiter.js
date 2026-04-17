/**
 * Dex v2 - Rate Limiter Service
 * Token-bucket rate limiting with per-user and global thresholds.
 * @version 2.0.0
 */

const Redis = require('redis');

const DEFAULTS = {
    windowMs: 60 * 1000,
    maxRequests: 60,
    burstLimit: 10,
    cooldownMs: 30 * 1000
};

class RateLimiter {
    constructor(redisClient, options = {}) {
          this.client = redisClient || Redis.createClient(process.env.REDIS_URL);
          this.config = { ...DEFAULTS, ...options };
          this.prefix = 'dex:rl:';
    }

  async checkLimit(userId, endpoint = 'global') {
        const key = `${this.prefix}${userId}:${endpoint}`;
        const now = Date.now();
        const windowStart = now - this.config.windowMs;

      await this.client.zRemRangeByScore(key, 0, windowStart);
        const requestCount = await this.client.zCard(key);

      if (requestCount >= this.config.maxRequests) {
              const oldest = await this.client.zRange(key, 0, 0, { REV: false });
              const retryAfter = oldest.length
                ? Math.ceil((parseInt(oldest[0]) + this.config.windowMs - now) / 1000)
                        : Math.ceil(this.config.cooldownMs / 1000);

          return {
                    allowed: false,
                    remaining: 0,
                    retryAfter,
                    limit: this.config.maxRequests
          };
      }

      await this.client.zAdd(key, { score: now, value: `${now}` });
        await this.client.expire(key, Math.ceil(this.config.windowMs / 1000));

      return {
              allowed: true,
              remaining: this.config.maxRequests - requestCount - 1,
              retryAfter: 0,
              limit: this.config.maxRequests
      };
  }

  middleware(endpoint = 'global') {
        return async (req, res, next) => {
                const userId = req.user?.id || req.ip;
                const result = await this.checkLimit(userId, endpoint);

                res.set('X-RateLimit-Limit', result.limit);
                res.set('X-RateLimit-Remaining', result.remaining);

                if (!result.allowed) {
                          res.set('Retry-After', result.retryAfter);
                          return res.status(429).json({
                                      success: false,
                                      error: { message: 'Too many requests', retryAfter: result.retryAfter }
                          });
                }
                next();
        };
  }

  async resetUser(userId) {
        const keys = await this.client.keys(`${this.prefix}${userId}:*`);
        if (keys.length > 0) await this.client.del(keys);
  }
}

module.exports = RateLimiter;
