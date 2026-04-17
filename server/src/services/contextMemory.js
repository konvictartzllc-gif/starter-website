/**
 * Dex v2 - Context Memory Service
 * Manages conversation context and session memory for improved AI responses.
 * @version 2.0.0
 */

const Redis = require('redis');
const { v4: uuidv4 } = require('uuid');

const MAX_CONTEXT_LENGTH = 20;
const SESSION_TTL = 3600;

class ContextMemory {
    constructor(redisClient) {
          this.client = redisClient || Redis.createClient(process.env.REDIS_URL);
          this.prefix = 'dex:ctx:';
    }

  async createSession(userId) {
        const sessionId = uuidv4();
        const key = `${this.prefix}${userId}:${sessionId}`;
        await this.client.set(key, JSON.stringify({
                id: sessionId,
                userId,
                messages: [],
                metadata: { createdAt: Date.now(), lastActive: Date.now() }
        }), { EX: SESSION_TTL });
        return sessionId;
  }

  async addMessage(userId, sessionId, role, content) {
        const key = `${this.prefix}${userId}:${sessionId}`;
        const raw = await this.client.get(key);
        if (!raw) throw new Error('Session not found or expired');
        const session = JSON.parse(raw);
        session.messages.push({ role, content, timestamp: Date.now() });
        if (session.messages.length > MAX_CONTEXT_LENGTH) {
                session.messages = session.messages.slice(-MAX_CONTEXT_LENGTH);
        }
        session.metadata.lastActive = Date.now();
        await this.client.set(key, JSON.stringify(session), { EX: SESSION_TTL });
        return session;
  }

  async getContext(userId, sessionId) {
        const key = `${this.prefix}${userId}:${sessionId}`;
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
  }

  async clearSession(userId, sessionId) {
        const key = `${this.prefix}${userId}:${sessionId}`;
        return this.client.del(key);
  }

  async getSummary(userId, sessionId) {
        const ctx = await this.getContext(userId, sessionId);
        if (!ctx || ctx.messages.length === 0) return '';
        return ctx.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  }
}

module.exports = ContextMemory;
