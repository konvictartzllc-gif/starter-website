import { COIN_PACKS, DEX_SHOP_ITEMS, ensureDatabase } from "./db.js";
import {
  applyCors,
  corsHeaders,
  getBearerToken,
  hashPassword,
  jsonResponse,
  normalizePhone,
  readJson,
  randomToken,
  signJwt,
  textResponse,
  validateEmail,
  verifyJwt,
  verifyPassword,
} from "./security.js";
import {
  createOpenAIReply,
  createStripeCheckoutSession,
  createStripePortalSession,
  getDiagnostics,
  getProductCatalog,
  verifyStripeSignature,
} from "./providers.js";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    access_type: user.access_type,
    trialDaysLeft: user.trialDaysLeft ?? null,
  };
}

async function first(env, sql, bindings = []) {
  return env.DB.prepare(sql).bind(...bindings).first();
}

async function all(env, sql, bindings = []) {
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

async function run(env, sql, bindings = []) {
  return env.DB.prepare(sql).bind(...bindings).run();
}

async function resolveUserAccess(env, user) {
  if (!user) return null;
  if (user.role === "admin" || user.access_type === "unlimited") {
    return { ...user, access_type: "unlimited", trialDaysLeft: null };
  }

  let accessType = user.access_type;
  let trialDaysLeft = null;
  if (accessType === "trial" && user.trial_start) {
    const end = new Date(user.trial_start);
    end.setDate(end.getDate() + 3);
    const now = new Date();
    if (now > end) {
      accessType = "expired";
    } else {
      trialDaysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    }
  }
  if (accessType === "paid" && user.sub_expires && new Date() > new Date(user.sub_expires)) {
    accessType = "expired";
  }
  if (accessType !== user.access_type) {
    await run(env, "UPDATE users SET access_type = ? WHERE id = ?", [accessType, user.id]);
  }
  return { ...user, access_type: accessType, trialDaysLeft };
}

async function getCurrentUser(request, env) {
  const token = getBearerToken(request);
  if (!token || !env.JWT_SECRET) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload?.id) return null;
  const user = await first(env, "SELECT * FROM users WHERE id = ?", [payload.id]);
  return resolveUserAccess(env, user);
}

function requireAuth(user) {
  if (!user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
}

function requireAdmin(user) {
  requireAuth(user);
  if (user.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
}

function buildTokenPayload(user) {
  return { id: user.id, email: user.email, role: user.role, name: user.name };
}

async function signUserToken(env, user) {
  if (!env.JWT_SECRET) throw Object.assign(new Error("JWT_SECRET is missing."), { status: 500 });
  return signJwt(buildTokenPayload(user), env.JWT_SECRET);
}

async function upsertMemory(env, userId, key, value) {
  await run(
    env,
    "INSERT INTO user_memory (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
    [String(userId), key, value]
  );
}

async function getMemoryMap(env, userId, prefix = null) {
  const rows = prefix
    ? await all(env, "SELECT key, value FROM user_memory WHERE user_id = ? AND key LIKE ? ORDER BY key", [String(userId), `${prefix}%`])
    : await all(env, "SELECT key, value FROM user_memory WHERE user_id = ? ORDER BY key", [String(userId)]);
  return rows.reduce((accumulator, row) => {
    accumulator[row.key] = row.value;
    return accumulator;
  }, {});
}

async function ensureAffiliateRecord(env, userId) {
  const existing = await first(env, "SELECT * FROM affiliates WHERE user_id = ?", [userId]);
  if (existing) return existing;
  const promoCode = `DEX${String(userId).padStart(4, "0")}`;
  await run(env, "INSERT INTO affiliates (user_id, promo_code) VALUES (?, ?)", [userId, promoCode]);
  return first(env, "SELECT * FROM affiliates WHERE user_id = ?", [userId]);
}

async function consumeAffiliateInvite(env, inviteCode, email, userId) {
  const normalized = String(inviteCode || "").trim().toUpperCase();
  if (!normalized) return null;
  const invite = await first(env, "SELECT * FROM affiliate_invite_codes WHERE UPPER(code) = ?", [normalized]);
  if (!invite) return null;
  if (invite.used) throw Object.assign(new Error("That affiliate invite code has already been used."), { status: 409 });
  if (invite.email && invite.email.toLowerCase() !== String(email).trim().toLowerCase()) {
    throw Object.assign(new Error("That affiliate invite code is assigned to a different email address."), { status: 403 });
  }
  await run(
    env,
    "UPDATE affiliate_invite_codes SET used = 1, claimed_by = ?, used_at = datetime('now') WHERE id = ?",
    [userId, invite.id]
  );
  return invite;
}

async function rateLimit(env, request, scope, { windowMs, max }) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
  const bucket = Math.floor(Date.now() / windowMs) * windowMs;
  const key = `${scope}:${ip}:${bucket}`;
  await run(
    env,
    "INSERT INTO request_rate_limits (rate_key, bucket_start, hits, updated_at) VALUES (?, ?, 1, datetime('now')) ON CONFLICT(rate_key) DO UPDATE SET hits = hits + 1, updated_at = datetime('now')",
    [key, new Date(bucket).toISOString()]
  );
  const record = await first(env, "SELECT hits FROM request_rate_limits WHERE rate_key = ?", [key]);
  if ((record?.hits || 0) > max) {
    throw Object.assign(new Error(scope === "chat" ? "Dex is busy. Please wait a minute before sending more messages." : "Too many requests. Please try again later."), { status: 429 });
  }
}

function getSiteUrl(request, env) {
  return (env.PUBLIC_SITE_URL || `${new URL(request.url).origin}`).replace(/\/+$/, "");
}

function getDexProducts(env) {
  return {
    subscription: {
      amountCents: Number(env.DEX_PRICE_CENTS || 999),
      currency: (env.DEX_CURRENCY || "usd").toLowerCase(),
      stripePriceId: env.STRIPE_PRICE_ID || null,
    },
    coinPacks: COIN_PACKS,
    accessories: DEX_SHOP_ITEMS,
  };
}

async function handleAuthRegister(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim() || null;
  const promoCode = String(body.promoCode || "").trim().toUpperCase();
  const affiliateInviteCode = String(body.affiliateInviteCode || "").trim();

  if (!validateEmail(email)) return jsonResponse({ error: "Valid email is required." }, 400);
  if (password.length < 6) return jsonResponse({ error: "Password must be at least 6 characters." }, 400);

  const existing = await first(env, "SELECT * FROM users WHERE email = ?", [email]);
  if (existing) return jsonResponse({ error: "Email already registered" }, 409);

  let referredBy = null;
  if (promoCode) {
    const affiliate = await first(env, "SELECT id FROM affiliates WHERE promo_code = ?", [promoCode]);
    if (affiliate) referredBy = promoCode;
  }

  const isAffiliateSignup = Boolean(affiliateInviteCode);
  const result = await run(
    env,
    "INSERT INTO users (email, name, password, role, access_type, trial_start, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      email,
      name,
      await hashPassword(password),
      isAffiliateSignup ? "affiliate" : "user",
      isAffiliateSignup ? "unlimited" : "trial",
      isAffiliateSignup ? null : nowIso(),
      referredBy,
    ]
  );
  const userId = result.meta.last_row_id;
  if (affiliateInviteCode) {
    await consumeAffiliateInvite(env, affiliateInviteCode, email, userId);
    await ensureAffiliateRecord(env, userId);
  }
  if (referredBy) {
    await run(env, "UPDATE affiliates SET signups = signups + 1 WHERE promo_code = ?", [referredBy]);
  }
  const user = await resolveUserAccess(env, await first(env, "SELECT * FROM users WHERE id = ?", [userId]));
  const token = await signUserToken(env, user);
  return jsonResponse({ token, user: sanitizeUser(user) });
}

async function handleAuthLogin(request, env) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!validateEmail(email) || !password) return jsonResponse({ error: "Email and password are required." }, 400);
  const user = await first(env, "SELECT * FROM users WHERE email = ?", [email]);
  if (!user || !(await verifyPassword(password, user.password))) {
    return jsonResponse({ error: "Invalid credentials" }, 401);
  }
  const resolved = await resolveUserAccess(env, user);
  return jsonResponse({ token: await signUserToken(env, resolved), user: sanitizeUser(resolved) });
}

async function handleAuthMe(user) {
  requireAuth(user);
  return jsonResponse({ user: sanitizeUser(user) });
}

async function handleDexAccess(env, user) {
  requireAuth(user);
  const resolved = await resolveUserAccess(env, user);
  return jsonResponse({
    access_type: resolved.access_type,
    trialDaysLeft: resolved.trialDaysLeft,
    hasAccess: ["trial", "paid", "unlimited"].includes(resolved.access_type),
  });
}

async function handleDexHistory(env, user) {
  requireAuth(user);
  const rows = await all(
    env,
    "SELECT id, role, content, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [user.id]
  );
  return jsonResponse({ history: rows.reverse() });
}

async function handleDexPreferences(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const memory = await getMemoryMap(env, user.id, "pref:");
    const preferences = Object.entries(memory).map(([key, value]) => ({ key: key.replace(/^pref:/, ""), value }));
    return jsonResponse({ preferences });
  }
  const body = await readJson(request);
  if (!body.key) return jsonResponse({ error: "Preference key is required." }, 400);
  await upsertMemory(env, user.id, `pref:${body.key}`, String(body.value ?? ""));
  return jsonResponse({ ok: true });
}

async function handleDexWorkflows(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const memory = await getMemoryMap(env, user.id, "pref:workflow:");
    const workflows = Object.entries(memory).map(([key, value]) => ({ key: key.replace(/^pref:workflow:/, ""), value }));
    return jsonResponse({ workflows });
  }
  const body = await readJson(request);
  if (!body.name || !body.steps) return jsonResponse({ error: "Workflow name and steps are required." }, 400);
  await upsertMemory(env, user.id, `pref:workflow:${body.name}`, JSON.stringify(body.steps));
  return jsonResponse({ ok: true });
}

async function handleDexMemory(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") return jsonResponse({ memory: await getMemoryMap(env, user.id) });
  const body = await readJson(request);
  if (!body.key) return jsonResponse({ error: "Memory key is required." }, 400);
  await upsertMemory(env, user.id, body.key, String(body.value ?? ""));
  return jsonResponse({ ok: true });
}

async function handleDexTasks(env, user, request, taskId = null) {
  requireAuth(user);
  if (request.method === "GET") {
    const tasks = await all(env, "SELECT * FROM task_items WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC", [user.id]);
    return jsonResponse({ tasks });
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.title) return jsonResponse({ error: "Task title is required." }, 400);
    const result = await run(
      env,
      "INSERT INTO task_items (user_id, title, details, status, kind, source, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.id, body.title, body.details || null, body.status || "open", body.kind || "task", body.source || null, body.dueAt || null]
    );
    return jsonResponse({ id: result.meta.last_row_id, ok: true }, 201);
  }
  if (!taskId) return jsonResponse({ error: "Task id is required." }, 400);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const existing = await first(env, "SELECT * FROM task_items WHERE id = ? AND user_id = ?", [taskId, user.id]);
    if (!existing) return jsonResponse({ error: "Task not found." }, 404);
    await run(
      env,
      "UPDATE task_items SET title = ?, details = ?, status = ?, kind = ?, source = ?, due_at = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [
        body.title ?? existing.title,
        body.details ?? existing.details,
        body.status ?? existing.status,
        body.kind ?? existing.kind,
        body.source ?? existing.source,
        body.dueAt ?? existing.due_at,
        taskId,
        user.id,
      ]
    );
    return jsonResponse({ ok: true });
  }
  if (request.method === "DELETE") {
    await run(env, "DELETE FROM task_items WHERE id = ? AND user_id = ?", [taskId, user.id]);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleRelationshipAliases(env, user, request, aliasId = null) {
  requireAuth(user);
  if (request.method === "GET") {
    const items = await all(env, "SELECT * FROM relationship_aliases WHERE user_id = ? ORDER BY alias", [user.id]);
    return jsonResponse({ aliases: items });
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.alias || !body.contactName) return jsonResponse({ error: "Alias and contact name are required." }, 400);
    await run(
      env,
      "INSERT INTO relationship_aliases (user_id, alias, contact_name) VALUES (?, ?, ?) ON CONFLICT(user_id, alias) DO UPDATE SET contact_name = excluded.contact_name, updated_at = datetime('now')",
      [user.id, body.alias.trim(), body.contactName.trim()]
    );
    return jsonResponse({ ok: true }, 201);
  }
  if (request.method === "DELETE") {
    await run(env, "DELETE FROM relationship_aliases WHERE id = ? AND user_id = ?", [aliasId, user.id]);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleCommunications(env, user, request, draftId = null) {
  requireAuth(user);
  if (request.method === "GET") {
    const drafts = await all(env, "SELECT * FROM communication_drafts WHERE user_id = ? ORDER BY updated_at DESC", [user.id]);
    return jsonResponse({ drafts });
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.channel || !body.targetValue || !body.body) return jsonResponse({ error: "channel, targetValue, and body are required." }, 400);
    const result = await run(
      env,
      "INSERT INTO communication_drafts (user_id, channel, target_name, target_value, subject, body, status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [user.id, body.channel, body.targetName || null, body.targetValue, body.subject || null, body.body, body.status || "pending", body.source || null]
    );
    return jsonResponse({ id: result.meta.last_row_id, ok: true }, 201);
  }
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const existing = await first(env, "SELECT * FROM communication_drafts WHERE id = ? AND user_id = ?", [draftId, user.id]);
    if (!existing) return jsonResponse({ error: "Draft not found." }, 404);
    await run(
      env,
      "UPDATE communication_drafts SET channel = ?, target_name = ?, target_value = ?, subject = ?, body = ?, status = ?, source = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [
        body.channel ?? existing.channel,
        body.targetName ?? existing.target_name,
        body.targetValue ?? existing.target_value,
        body.subject ?? existing.subject,
        body.body ?? existing.body,
        body.status ?? existing.status,
        body.source ?? existing.source,
        draftId,
        user.id,
      ]
    );
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleDexShop(env, user, request, pathname) {
  requireAuth(user);
  if (pathname === "/api/dex/shop" && request.method === "GET") {
    const coinsRow = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_coins'", [String(user.id)]);
    const colorsRow = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_colors'", [String(user.id)]);
    return jsonResponse({
      items: DEX_SHOP_ITEMS,
      coins: Number(coinsRow?.value || 0),
      colors: colorsRow?.value ? JSON.parse(colorsRow.value) : null,
    });
  }
  if (pathname === "/api/dex/shop/reward") {
    const body = await readJson(request);
    const amount = Math.max(0, Number(body.amount || 0));
    const existing = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_coins'", [String(user.id)]);
    const next = Number(existing?.value || 0) + amount;
    await upsertMemory(env, user.id, "dex_coins", String(next));
    return jsonResponse({ coins: next });
  }
  if (pathname === "/api/dex/shop/purchase") {
    const body = await readJson(request);
    const item = DEX_SHOP_ITEMS.find((entry) => entry.id === body.itemId);
    if (!item) return jsonResponse({ error: "Item not found." }, 404);
    const coinsRow = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_coins'", [String(user.id)]);
    const current = Number(coinsRow?.value || 0);
    if (current < item.price) return jsonResponse({ error: "Not enough Dex coins." }, 400);
    const next = current - item.price;
    await upsertMemory(env, user.id, "dex_coins", String(next));
    const ownedRow = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_owned_items'", [String(user.id)]);
    const owned = ownedRow?.value ? JSON.parse(ownedRow.value) : [];
    if (!owned.includes(item.id)) owned.push(item.id);
    await upsertMemory(env, user.id, "dex_owned_items", JSON.stringify(owned));
    return jsonResponse({ coins: next, ownedItems: owned });
  }
  if (pathname === "/api/dex/shop/colors") {
    const body = await readJson(request);
    await upsertMemory(env, user.id, "dex_colors", JSON.stringify(body.colors || {}));
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleDexCallEvents(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const events = await all(env, "SELECT * FROM call_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [user.id]);
    return jsonResponse({ events });
  }
  const body = await readJson(request);
  await run(env, "INSERT INTO call_events (user_id, event, caller, timestamp) VALUES (?, ?, ?, ?)", [user.id, body.event || "unknown", body.caller || "unknown", body.timestamp || nowIso()]);
  return jsonResponse({ ok: true }, 201);
}

async function handleDexPermissions(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const row = await first(env, "SELECT permissions FROM user_permissions WHERE user_id = ?", [user.id]);
    return jsonResponse({ permissions: row?.permissions ? JSON.parse(row.permissions) : {} });
  }
  const body = await readJson(request);
  await run(
    env,
    "INSERT INTO user_permissions (user_id, permissions, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at",
    [user.id, JSON.stringify(body.permissions || {})]
  );
  return jsonResponse({ ok: true });
}

async function handleDexIntegrations(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const routes = await all(env, "SELECT * FROM user_integration_routes WHERE user_id = ? ORDER BY provider, created_at DESC", [user.id]);
    return jsonResponse({ integrations: routes });
  }
  const body = await readJson(request);
  const routeKey = body.routeKey || randomToken(10);
  await run(
    env,
    "INSERT INTO user_integration_routes (user_id, provider, account_id, route_key, assigned_number, extension, permissions_json, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(route_key) DO UPDATE SET assigned_number = excluded.assigned_number, extension = excluded.extension, permissions_json = excluded.permissions_json, enabled = excluded.enabled, updated_at = datetime('now')",
    [user.id, "ringcentral", body.accountId || null, routeKey, normalizePhone(body.assignedNumber), body.extension || null, JSON.stringify(body.permissions || {}), body.enabled === false ? 0 : 1]
  );
  return jsonResponse({ ok: true, routeKey });
}

async function handleLearningHistory(env, user) {
  requireAuth(user);
  const lessons = await all(env, "SELECT * FROM learning_lessons WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [user.id]);
  const quizzes = await all(env, "SELECT * FROM learning_quiz_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [user.id]);
  return jsonResponse({ lessons, quizzes });
}

async function handleDailyLesson(env, user, request) {
  requireAuth(user);
  const body = await readJson(request);
  const topic = body.topic || body.subject || "daily focus";
  const language = body.language || "English";
  const level = body.level || "beginner";
  const content = env.OPENAI_API_KEY
    ? await createOpenAIReply(env, [
        { role: "system", content: "Create a short daily lesson with one tip and one practice prompt." },
        { role: "user", content: `Topic: ${topic}. Language: ${language}. Level: ${level}.` },
      ])
    : `Today's ${level} ${language} lesson about ${topic}: practice one clear sentence and one follow-up question.`;
  const result = await run(
    env,
    "INSERT INTO learning_lessons (user_id, topic, language, level, lesson_type, title, content) VALUES (?, ?, ?, ?, 'lesson', ?, ?)",
    [user.id, topic, language, level, `${topic} lesson`, content]
  );
  return jsonResponse({ lesson: { id: result.meta.last_row_id, topic, language, level, content } });
}

async function handleCreateQuiz(env, user, request) {
  requireAuth(user);
  const body = await readJson(request);
  const topic = body.topic || "general learning";
  const language = body.language || "English";
  const questions = [
    { id: 1, prompt: `What is one key idea you remember about ${topic}?` },
    { id: 2, prompt: `Use ${language} to write one practice sentence about ${topic}.` },
    { id: 3, prompt: `What should you review next to improve on ${topic}?` },
  ];
  return jsonResponse({ quiz: { topic, language, questions } });
}

async function handleSubmitQuiz(env, user, request) {
  requireAuth(user);
  const body = await readJson(request);
  const responses = Array.isArray(body.responses) ? body.responses : [];
  const score = responses.filter((entry) => String(entry.answer || "").trim()).length;
  const total = responses.length;
  const result = await run(
    env,
    "INSERT INTO learning_quiz_attempts (user_id, topic, language, score, total_questions, responses_json) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, body.topic || "general learning", body.language || "English", score, total, JSON.stringify(responses)]
  );
  return jsonResponse({ attempt: { id: result.meta.last_row_id, score, totalQuestions: total } });
}

async function handleDexBriefing(env, user) {
  requireAuth(user);
  const tasks = await all(env, "SELECT title, status, due_at FROM task_items WHERE user_id = ? ORDER BY due_at IS NULL, due_at ASC, updated_at DESC LIMIT 5", [user.id]);
  return jsonResponse({
    briefing: {
      date: nowIso(),
      tasks,
      message: tasks.length ? `You have ${tasks.length} active items to review today.` : "You are all caught up today.",
    },
  });
}

async function handleDexFollowUps(env, user) {
  requireAuth(user);
  const drafts = await all(env, "SELECT target_name, channel, status, updated_at FROM communication_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5", [user.id]);
  return jsonResponse({ followUps: drafts });
}

async function handleDexChat(env, user, request) {
  requireAuth(user);
  const body = await readJson(request);
  const message = String(body.message || "").trim();
  if (!message) return jsonResponse({ error: "Message is required." }, 400);
  if (!["trial", "paid", "unlimited"].includes(user.access_type)) {
    return jsonResponse({ error: "Dex access is not active for this account." }, 403);
  }

  await run(env, "INSERT INTO chat_history (user_id, role, content) VALUES (?, 'user', ?)", [user.id, message]);
  const history = await all(env, "SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", [user.id]);
  const reply = await createOpenAIReply(env, [
    { role: "system", content: "You are Dex, a helpful AI assistant for Konvict Artz users." },
    ...history.reverse(),
  ]);
  await run(env, "INSERT INTO chat_history (user_id, role, content) VALUES (?, 'assistant', ?)", [user.id, reply]);
  return jsonResponse({ reply });
}

async function handleAppointments(env, user, request) {
  requireAuth(user);
  if (request.method === "GET") {
    const appointments = await all(env, "SELECT * FROM appointments WHERE user_id = ? ORDER BY start_time ASC", [user.id]);
    return jsonResponse({ appointments });
  }
  const body = await readJson(request);
  if (!body.title || !body.startTime) return jsonResponse({ error: "title and startTime are required." }, 400);
  const result = await run(
    env,
    "INSERT INTO appointments (user_id, title, description, start_time, end_time, google_event_id) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, body.title, body.description || null, body.startTime, body.endTime || null, body.googleEventId || null]
  );
  return jsonResponse({ id: result.meta.last_row_id, ok: true }, 201);
}

async function handleBookings(env, request, user, bookingId = null) {
  if (request.method === "GET" && new URL(request.url).pathname === "/api/bookings/service-area") {
    const zip = new URL(request.url).searchParams.get("zip");
    return jsonResponse({ zip, supported: Boolean(zip), message: zip ? "Dex service area lookup is enabled for Worker deployments." : "Provide a ZIP code to validate service area." });
  }
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.service || !body.name || !body.zipCode) return jsonResponse({ error: "service, name, and zipCode are required." }, 400);
    const result = await run(
      env,
      "INSERT INTO service_bookings (service, name, email, phone, zip_code, address, preferred_date, preferred_time, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')",
      [body.service, body.name, body.email || null, normalizePhone(body.phone), body.zipCode, body.address || null, body.preferredDate || null, body.preferredTime || null, body.notes || null]
    );
    return jsonResponse({ id: result.meta.last_row_id, ok: true }, 201);
  }
  requireAdmin(user);
  if (request.method === "GET") {
    const bookings = await all(env, "SELECT * FROM service_bookings ORDER BY created_at DESC", []);
    return jsonResponse({ bookings });
  }
  const body = await readJson(request);
  const existing = await first(env, "SELECT * FROM service_bookings WHERE id = ?", [bookingId]);
  if (!existing) return jsonResponse({ error: "Booking not found." }, 404);
  await run(
    env,
    "UPDATE service_bookings SET status = ?, notes = ?, preferred_date = ?, preferred_time = ?, updated_at = datetime('now') WHERE id = ?",
    [body.status || existing.status, body.notes ?? existing.notes, body.preferredDate ?? existing.preferred_date, body.preferredTime ?? existing.preferred_time, bookingId]
  );
  return jsonResponse({ ok: true });
}

async function handleAffiliateDashboard(env, user) {
  requireAuth(user);
  const affiliate = await ensureAffiliateRecord(env, user.id);
  const recentPayments = await all(env, "SELECT amount_cents, status, affiliate_code, created_at FROM payments WHERE affiliate_code = ? ORDER BY created_at DESC LIMIT 10", [affiliate.promo_code]);
  return jsonResponse({
    affiliate: {
      ...affiliate,
      referralLink: `${env.PUBLIC_SITE_URL || "https://worker-autumn-cherry-0533.workers.dev"}/register?promo=${affiliate.promo_code}`,
      recentPayments,
    },
  });
}

async function handleAndroidDownload() {
  return jsonResponse({ error: "Android APK download is not bundled with the Worker deployment." }, 404);
}

async function handleAdminStats(env, user) {
  requireAdmin(user);
  const [users, payments, bookings, inventory, affiliates] = await Promise.all([
    first(env, "SELECT COUNT(*) AS count FROM users"),
    first(env, "SELECT COUNT(*) AS count FROM payments"),
    first(env, "SELECT COUNT(*) AS count FROM service_bookings"),
    first(env, "SELECT COUNT(*) AS count FROM inventory"),
    first(env, "SELECT COUNT(*) AS count FROM affiliates"),
  ]);
  return jsonResponse({
    stats: {
      users: users?.count || 0,
      payments: payments?.count || 0,
      bookings: bookings?.count || 0,
      inventory: inventory?.count || 0,
      affiliates: affiliates?.count || 0,
    },
  });
}

async function handleFeatureFlags(env, user, request, key = null) {
  requireAdmin(user);
  if (request.method === "GET") {
    return jsonResponse({ flags: await all(env, "SELECT * FROM feature_flags ORDER BY key", []) });
  }
  const body = await readJson(request);
  await run(
    env,
    "UPDATE feature_flags SET enabled = ?, description = COALESCE(?, description), updated_at = datetime('now') WHERE key = ?",
    [body.enabled ? 1 : 0, body.description || null, key]
  );
  return jsonResponse({ ok: true });
}

async function handleInventory(env, user, request, inventoryId = null) {
  requireAdmin(user);
  if (request.method === "GET") return jsonResponse({ inventory: await all(env, "SELECT * FROM inventory ORDER BY updated_at DESC, created_at DESC", []) });
  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body.name) return jsonResponse({ error: "Inventory name is required." }, 400);
    const result = await run(
      env,
      "INSERT INTO inventory (name, description, category, price_cents, quantity, low_threshold, image_url, square_catalog_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [body.name, body.description || null, body.category || null, Number(body.priceCents || 0), Number(body.quantity || 0), Number(body.lowThreshold || 5), body.imageUrl || null, body.squareCatalogId || null]
    );
    return jsonResponse({ id: result.meta.last_row_id, ok: true }, 201);
  }
  if (request.method === "PUT") {
    const body = await readJson(request);
    const existing = await first(env, "SELECT * FROM inventory WHERE id = ?", [inventoryId]);
    if (!existing) return jsonResponse({ error: "Inventory item not found." }, 404);
    await run(
      env,
      "UPDATE inventory SET name = ?, description = ?, category = ?, price_cents = ?, quantity = ?, low_threshold = ?, alerted = ?, image_url = ?, square_catalog_id = ?, updated_at = datetime('now') WHERE id = ?",
      [
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.category ?? existing.category,
        Number(body.priceCents ?? existing.price_cents),
        Number(body.quantity ?? existing.quantity),
        Number(body.lowThreshold ?? existing.low_threshold),
        Number(body.alerted ?? existing.alerted),
        body.imageUrl ?? existing.image_url,
        body.squareCatalogId ?? existing.square_catalog_id,
        inventoryId,
      ]
    );
    return jsonResponse({ ok: true });
  }
  if (request.method === "DELETE") {
    await run(env, "DELETE FROM inventory WHERE id = ?", [inventoryId]);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}

async function handleAdminAffiliates(env, user) {
  requireAdmin(user);
  const affiliates = await all(
    env,
    "SELECT affiliates.*, users.email, users.name FROM affiliates JOIN users ON users.id = affiliates.user_id ORDER BY affiliates.created_at DESC",
    []
  );
  return jsonResponse({ affiliates });
}

async function handleAffiliateInvites(env, user, request, inviteId = null) {
  requireAdmin(user);
  if (request.method === "GET") {
    const invites = await all(env, "SELECT * FROM affiliate_invite_codes ORDER BY created_at DESC", []);
    return jsonResponse({ invites });
  }
  if (request.method === "POST" && !inviteId) {
    const body = await readJson(request);
    const code = String(body.code || randomToken(6)).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    await run(
      env,
      "INSERT INTO affiliate_invite_codes (code, email, name, created_by, expires_at) VALUES (?, ?, ?, ?, ?)",
      [code, body.email || null, body.name || null, user.id, body.expiresAt || null]
    );
    return jsonResponse({ code, ok: true }, 201);
  }
  const invite = await first(env, "SELECT * FROM affiliate_invite_codes WHERE id = ?", [inviteId]);
  if (!invite) return jsonResponse({ error: "Affiliate invite not found." }, 404);
  return jsonResponse({ ok: true, invite });
}

async function handleAdminCreateAffiliate(env, user, request) {
  requireAdmin(user);
  const body = await readJson(request);
  if (!validateEmail(body.email)) return jsonResponse({ error: "Valid affiliate email is required." }, 400);
  const existing = await first(env, "SELECT * FROM users WHERE email = ?", [String(body.email).trim().toLowerCase()]);
  let userId = existing?.id;
  if (!existing) {
    const result = await run(
      env,
      "INSERT INTO users (email, name, password, role, access_type) VALUES (?, ?, ?, 'affiliate', 'unlimited')",
      [String(body.email).trim().toLowerCase(), body.name || null, await hashPassword(body.password || randomToken(10))]
    );
    userId = result.meta.last_row_id;
  } else {
    await run(env, "UPDATE users SET role = 'affiliate', access_type = 'unlimited' WHERE id = ?", [existing.id]);
  }
  const affiliate = await ensureAffiliateRecord(env, userId);
  return jsonResponse({ affiliate }, 201);
}

async function handleAdminUsers(env, user) {
  requireAdmin(user);
  const users = await all(env, "SELECT id, email, name, phone, role, access_type, trial_start, sub_expires, created_at FROM users ORDER BY created_at DESC", []);
  return jsonResponse({ users });
}

async function handleAdminUserAccess(env, user, request, userId) {
  requireAdmin(user);
  const body = await readJson(request);
  await run(env, "UPDATE users SET access_type = ?, sub_expires = ? WHERE id = ?", [body.accessType || "none", body.subExpires || null, userId]);
  return jsonResponse({ ok: true });
}

async function handleAdminIntegrationRoutes(env, user) {
  requireAdmin(user);
  const routes = await all(
    env,
    "SELECT user_integration_routes.*, users.email, users.name FROM user_integration_routes JOIN users ON users.id = user_integration_routes.user_id ORDER BY user_integration_routes.updated_at DESC",
    []
  );
  return jsonResponse({ routes });
}

async function handleAdminAssignIntegration(env, user, request) {
  requireAdmin(user);
  const body = await readJson(request);
  if (!body.userId) return jsonResponse({ error: "userId is required." }, 400);
  const routeKey = body.routeKey || randomToken(10);
  await run(
    env,
    "INSERT INTO user_integration_routes (user_id, provider, account_id, route_key, assigned_number, extension, permissions_json, enabled) VALUES (?, 'ringcentral', ?, ?, ?, ?, ?, ?) ON CONFLICT(route_key) DO UPDATE SET assigned_number = excluded.assigned_number, extension = excluded.extension, permissions_json = excluded.permissions_json, enabled = excluded.enabled, updated_at = datetime('now')",
    [body.userId, body.accountId || null, routeKey, normalizePhone(body.assignedNumber), body.extension || null, JSON.stringify(body.permissions || {}), body.enabled === false ? 0 : 1]
  );
  return jsonResponse({ ok: true, routeKey });
}

async function handleAdminInventoryCheck(env, user) {
  requireAdmin(user);
  const lowItems = await all(env, "SELECT * FROM inventory WHERE quantity <= low_threshold ORDER BY quantity ASC", []);
  return jsonResponse({ lowItems });
}

async function handleAdminSendPromo(user) {
  requireAdmin(user);
  return jsonResponse({ ok: true, message: "Promo sending is configured as an external provider step in Workers deployments." });
}

async function handleAdminEmailTest(user) {
  requireAdmin(user);
  return jsonResponse({ ok: true, message: "SMTP verification should be validated through /api/diagnostics/providers in the Worker deployment." });
}

async function handlePaymentsProducts(env) {
  return jsonResponse({ products: getProductCatalog(env), dex: getDexProducts(env) });
}

async function handleSubscriptionCheckout(env, user, request, packId = null) {
  requireAuth(user);
  const products = getProductCatalog(env);
  const siteUrl = getSiteUrl(request, env);
  if (packId) {
    const pack = COIN_PACKS[packId];
    if (!pack || !env.STRIPE_PRICE_ID) return jsonResponse({ error: "Coin checkout is not configured for this Worker deployment." }, 400);
    const session = await createStripeCheckoutSession(env, {
      mode: "payment",
      priceId: env[`STRIPE_COIN_PRICE_${packId.toUpperCase()}`] || env.STRIPE_PRICE_ID,
      quantity: 1,
      customerEmail: user.email,
      userId: user.id,
      purpose: `coins:${packId}`,
      siteUrl,
      successPath: "/shop?checkout=success",
      cancelPath: "/shop?checkout=cancelled",
    });
    return jsonResponse({ url: session.url, id: session.id, products });
  }
  if (!env.STRIPE_PRICE_ID) return jsonResponse({ error: "Stripe subscription price is not configured." }, 400);
  const session = await createStripeCheckoutSession(env, {
    mode: "subscription",
    priceId: env.STRIPE_PRICE_ID,
    quantity: 1,
    customerEmail: user.email,
    userId: user.id,
    purpose: "subscription",
    siteUrl,
  });
  await run(env, "UPDATE users SET stripe_checkout_session_id = ? WHERE id = ?", [session.id, user.id]);
  return jsonResponse({ url: session.url, id: session.id, products });
}

async function handleProductCheckout(env, user, request, productId) {
  requireAuth(user);
  const quantity = Math.max(1, Number((await readJson(request)).quantity || 1));
  const item = await first(env, "SELECT * FROM inventory WHERE id = ?", [productId]);
  if (!item) return jsonResponse({ error: "Product not found." }, 404);
  if (!env.STRIPE_PRICE_ID) return jsonResponse({ error: "Stripe product checkout requires a configured price id." }, 400);
  const session = await createStripeCheckoutSession(env, {
    mode: "payment",
    priceId: env.STRIPE_PRICE_ID,
    quantity,
    customerEmail: user.email,
    userId: user.id,
    purpose: `inventory:${productId}`,
    siteUrl: getSiteUrl(request, env),
    successPath: "/shop?checkout=success",
    cancelPath: "/shop?checkout=cancelled",
  });
  return jsonResponse({ url: session.url, id: session.id, item });
}

async function handleBillingPortal(env, user) {
  requireAuth(user);
  if (!user.stripe_customer_id) return jsonResponse({ error: "No Stripe customer is linked to this account yet." }, 400);
  const session = await createStripePortalSession(env, user.stripe_customer_id);
  return jsonResponse({ url: session.url });
}

async function handlePaymentStatus(env, user) {
  requireAuth(user);
  const resolved = await resolveUserAccess(env, user);
  const payments = await all(env, "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", [user.id]);
  return jsonResponse({
    access_type: resolved.access_type,
    trialDaysLeft: resolved.trialDaysLeft,
    stripeCustomerId: resolved.stripe_customer_id,
    stripeSubscriptionId: resolved.stripe_subscription_id,
    payments,
  });
}

async function handleStripeWebhook(env, request) {
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  if (!(await verifyStripeSignature(env, signature, rawBody))) {
    return jsonResponse({ error: "Invalid Stripe signature." }, 400);
  }
  const payload = JSON.parse(rawBody);
  const object = payload.data?.object || {};
  const userId = Number(object.metadata?.user_id || 0);
  if (payload.type === "checkout.session.completed" && userId) {
    const purpose = object.metadata?.purpose || "subscription";
    if (purpose === "subscription") {
      await run(
        env,
        "UPDATE users SET access_type = 'paid', stripe_customer_id = ?, stripe_subscription_id = ?, stripe_checkout_session_id = ?, sub_expires = ? WHERE id = ?",
        [object.customer || null, object.subscription || null, object.id || null, nowIso(), userId]
      );
    }
    const existingPayment = await first(
      env,
      "SELECT id FROM payments WHERE stripe_checkout_session_id = ? OR stripe_payment_intent_id = ? LIMIT 1",
      [object.id || null, object.payment_intent || null]
    );
    if (existingPayment) {
      await run(
        env,
        "UPDATE payments SET stripe_subscription_id = ?, amount_cents = ?, currency = ?, status = ?, affiliate_code = ? WHERE id = ?",
        [object.subscription || null, Number(object.amount_total || 0), object.currency || "usd", "completed", object.metadata?.affiliate_code || null, existingPayment.id]
      );
    } else {
      await run(
        env,
        "INSERT INTO payments (user_id, stripe_payment_intent_id, stripe_checkout_session_id, stripe_subscription_id, amount_cents, currency, status, affiliate_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, object.payment_intent || null, object.id || null, object.subscription || null, Number(object.amount_total || 0), object.currency || "usd", "completed", object.metadata?.affiliate_code || null]
      );
    }
    if (purpose.startsWith("coins:")) {
      const pack = COIN_PACKS[purpose.split(":")[1]];
      if (pack) {
        const coinsRow = await first(env, "SELECT value FROM user_memory WHERE user_id = ? AND key = 'dex_coins'", [String(userId)]);
        await upsertMemory(env, userId, "dex_coins", String(Number(coinsRow?.value || 0) + pack.coins));
      }
    }
  }
  return jsonResponse({ received: true });
}

async function handleVoiceWebhook(env, request, provider) {
  const contentType = request.headers.get("content-type") || "";
  let payload = {};
  if (contentType.includes("application/x-www-form-urlencoded")) {
    payload = Object.fromEntries((await request.formData()).entries());
  } else if (contentType.includes("application/json")) {
    payload = await readJson(request);
  }
  await run(
    env,
    "INSERT INTO call_messages (user_id, caller, phone_number, message, handled) VALUES (?, ?, ?, ?, 0)",
    [1, payload.From || payload.caller || provider, payload.To || payload.phone || null, JSON.stringify(payload)]
  );
  if (provider === "twilio") {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Dex has received your ${payload.SpeechResult ? "voice message" : "request"}.</Say></Response>`, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }
  return jsonResponse({ ok: true, provider });
}

async function routeApi(request, env) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api") return jsonResponse({ status: "ok", service: "Dex Cloudflare Worker API", routes: { health: "/api/health", diagnostics: "/api/diagnostics/providers" } });
  if (pathname === "/api/health") return jsonResponse({ status: "ok", service: "Dex Cloudflare Worker" });
  if (pathname === "/api/diagnostics/providers") return jsonResponse(getDiagnostics(env));

  await ensureDatabase(env);
  if (pathname !== "/api/payments/webhook") {
    await rateLimit(env, request, pathname === "/api/dex/chat" ? "chat" : "api", {
      windowMs: pathname === "/api/dex/chat" ? 60_000 : 15 * 60_000,
      max: pathname === "/api/dex/chat" ? Number(env.CHAT_RATE_LIMIT_PER_MINUTE || 60) : Number(env.API_RATE_LIMIT_PER_15_MINUTES || 300),
    });
  }
  const user = await getCurrentUser(request, env);

  if (pathname === "/api/auth/register" && request.method === "POST") return handleAuthRegister(request, env);
  if (pathname === "/api/auth/login" && request.method === "POST") return handleAuthLogin(request, env);
  if (pathname === "/api/auth/me" && request.method === "GET") return handleAuthMe(user);
  if (pathname === "/api/auth/phone" && request.method === "PUT") {
    requireAuth(user);
    const body = await readJson(request);
    await run(env, "UPDATE users SET phone = ? WHERE id = ?", [normalizePhone(body.phone), user.id]);
    return jsonResponse({ ok: true });
  }
  if (pathname === "/api/auth/ota/request" && request.method === "POST") {
    requireAuth(user);
    const code = randomToken(4).slice(0, 6).toUpperCase();
    await run(env, "INSERT INTO ota_codes (user_id, code, action, expires_at, used) VALUES (?, ?, ?, ?, 0)", [user.id, code, "general", new Date(Date.now() + 10 * 60_000).toISOString()]);
    return jsonResponse({ code, ok: true });
  }

  if (pathname === "/api/dex/access" && request.method === "GET") return handleDexAccess(env, user);
  if (pathname === "/api/dex/history" && request.method === "GET") return handleDexHistory(env, user);
  if (pathname === "/api/dex/preferences" && (request.method === "GET" || request.method === "POST")) return handleDexPreferences(env, user, request);
  if (pathname === "/api/dex/workflows" && (request.method === "GET" || request.method === "POST")) return handleDexWorkflows(env, user, request);
  if (pathname === "/api/dex/memory" && (request.method === "GET" || request.method === "POST")) return handleDexMemory(env, user, request);
  if (pathname === "/api/dex/tasks" && (request.method === "GET" || request.method === "POST")) return handleDexTasks(env, user, request);
  if (pathname.match(/^\/api\/dex\/tasks\/\d+$/) && (request.method === "PATCH" || request.method === "DELETE")) return handleDexTasks(env, user, request, Number(pathname.split("/").at(-1)));
  if (pathname === "/api/dex/relationship-aliases" && (request.method === "GET" || request.method === "POST")) return handleRelationshipAliases(env, user, request);
  if (pathname.match(/^\/api\/dex\/relationship-aliases\/\d+$/) && request.method === "DELETE") return handleRelationshipAliases(env, user, request, Number(pathname.split("/").at(-1)));
  if (pathname === "/api/dex/communications" && (request.method === "GET" || request.method === "POST")) return handleCommunications(env, user, request);
  if (pathname.match(/^\/api\/dex\/communications\/\d+$/) && request.method === "PATCH") return handleCommunications(env, user, request, Number(pathname.split("/").at(-1)));
  if (pathname.startsWith("/api/dex/shop") && request.method !== "OPTIONS") return handleDexShop(env, user, request, pathname);
  if (pathname === "/api/dex/call-events" && (request.method === "GET" || request.method === "POST")) return handleDexCallEvents(env, user, request);
  if (pathname === "/api/dex/permissions" && (request.method === "GET" || request.method === "POST")) return handleDexPermissions(env, user, request);
  if (pathname === "/api/dex/integrations" && request.method === "GET") return handleDexIntegrations(env, user, request);
  if (pathname === "/api/dex/integrations/ringcentral" && request.method === "POST") return handleDexIntegrations(env, user, request);
  if (pathname === "/api/dex/learning/history" && request.method === "GET") return handleLearningHistory(env, user);
  if (pathname === "/api/dex/learning/daily-lesson" && request.method === "POST") return handleDailyLesson(env, user, request);
  if (pathname === "/api/dex/learning/quiz" && request.method === "POST") return handleCreateQuiz(env, user, request);
  if (pathname === "/api/dex/learning/quiz/submit" && request.method === "POST") return handleSubmitQuiz(env, user, request);
  if (pathname === "/api/dex/briefing" && request.method === "GET") return handleDexBriefing(env, user);
  if (pathname === "/api/dex/follow-ups" && request.method === "GET") return handleDexFollowUps(env, user);
  if (pathname === "/api/dex/chat" && request.method === "POST") return handleDexChat(env, user, request);
  if (pathname === "/api/dex/appointment" && request.method === "POST") return handleAppointments(env, user, request);
  if (pathname === "/api/dex/appointments" && request.method === "GET") return handleAppointments(env, user, request);

  if (pathname === "/api/payments/products" && request.method === "GET") return handlePaymentsProducts(env);
  if ((pathname === "/api/payments/subscribe" || pathname === "/api/payments/checkout-session") && request.method === "POST") return handleSubscriptionCheckout(env, user, request);
  if (pathname === "/api/payments/coins-checkout" && request.method === "POST") {
    const packId = String((await readJson(request)).packId || "");
    return handleSubscriptionCheckout(env, user, request, packId);
  }
  if (pathname.match(/^\/api\/payments\/products\/\d+\/checkout$/) && request.method === "POST") return handleProductCheckout(env, user, request, Number(pathname.split("/")[4]));
  if (pathname === "/api/payments/portal" && request.method === "POST") return handleBillingPortal(env, user);
  if (pathname === "/api/payments/status" && request.method === "GET") return handlePaymentStatus(env, user);
  if (pathname === "/api/payments/webhook" && request.method === "POST") return handleStripeWebhook(env, request);

  if (pathname === "/api/bookings/service-area" && request.method === "GET") return handleBookings(env, request, user);
  if (pathname === "/api/bookings" && request.method === "POST") return handleBookings(env, request, user);
  if (pathname === "/api/bookings/admin" && request.method === "GET") return handleBookings(env, request, user);
  if (pathname.match(/^\/api\/bookings\/admin\/\d+$/) && request.method === "PATCH") return handleBookings(env, request, user, Number(pathname.split("/").at(-1)));

  if (pathname === "/api/affiliate/dashboard" && request.method === "GET") return handleAffiliateDashboard(env, user);
  if (pathname === "/api/affiliate/android/download" && request.method === "GET") return handleAndroidDownload();

  if (pathname === "/api/admin/stats" && request.method === "GET") return handleAdminStats(env, user);
  if (pathname === "/api/admin/feature-flags" && request.method === "GET") return handleFeatureFlags(env, user, request);
  if (pathname.match(/^\/api\/admin\/feature-flags\/[^/]+$/) && request.method === "PATCH") return handleFeatureFlags(env, user, request, decodeURIComponent(pathname.split("/").at(-1)));
  if (pathname === "/api/admin/inventory" && (request.method === "GET" || request.method === "POST")) return handleInventory(env, user, request);
  if (pathname.match(/^\/api\/admin\/inventory\/\d+$/) && (request.method === "PUT" || request.method === "DELETE")) return handleInventory(env, user, request, Number(pathname.split("/").at(-1)));
  if (pathname === "/api/admin/affiliates" && request.method === "GET") return handleAdminAffiliates(env, user);
  if (pathname === "/api/admin/affiliate-invites" && request.method === "GET") return handleAffiliateInvites(env, user, request);
  if (pathname === "/api/admin/affiliate-invites/create" && request.method === "POST") return handleAffiliateInvites(env, user, request);
  if (pathname.match(/^\/api\/admin\/affiliate-invites\/\d+\/resend$/) && request.method === "POST") return handleAffiliateInvites(env, user, request, Number(pathname.split("/")[4]));
  if (pathname === "/api/admin/affiliates/create" && request.method === "POST") return handleAdminCreateAffiliate(env, user, request);
  if (pathname === "/api/admin/users" && request.method === "GET") return handleAdminUsers(env, user);
  if (pathname.match(/^\/api\/admin\/users\/\d+\/access$/) && request.method === "PATCH") return handleAdminUserAccess(env, user, request, Number(pathname.split("/")[4]));
  if (pathname === "/api/admin/integrations/routes" && request.method === "GET") return handleAdminIntegrationRoutes(env, user);
  if (pathname === "/api/admin/integrations/ringcentral/assign" && request.method === "POST") return handleAdminAssignIntegration(env, user, request);
  if (pathname === "/api/admin/check-inventory" && request.method === "POST") return handleAdminInventoryCheck(env, user);
  if (pathname === "/api/admin/send-promo" && request.method === "POST") return handleAdminSendPromo(user);
  if (pathname === "/api/admin/email/test" && request.method === "POST") return handleAdminEmailTest(user);

  if (pathname === "/api/twilio/voice" && request.method === "POST") return handleVoiceWebhook(env, request, "twilio");
  if (pathname === "/api/twilio/voice/message" && request.method === "POST") return handleVoiceWebhook(env, request, "twilio");
  if (pathname === "/api/twilio/voice/recording" && request.method === "POST") return handleVoiceWebhook(env, request, "twilio");
  if (pathname === "/api/ringcentral/voice" && request.method === "POST") return handleVoiceWebhook(env, request, "ringcentral");

  return jsonResponse({ error: "Not found." }, 404);
}

async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/health") return jsonResponse({ status: "ok", service: "Dex Cloudflare Worker" });
  if (url.pathname === "/oauth/callback") {
    return jsonResponse({
      status: "ok",
      provider: "ringcentral",
      message: "Cloudflare Worker OAuth callback is reachable.",
      hasCode: Boolean(url.searchParams.get("code")),
      error: url.searchParams.get("error"),
      state: url.searchParams.get("state"),
    });
  }
  if (url.pathname.startsWith("/api/")) return routeApi(request, env);
  if (url.pathname === "/api") return routeApi(request, env);
  if (env.ASSETS?.fetch) {
    return env.ASSETS.fetch(request);
  }
  if (url.pathname === "/") return textResponse("Dex Cloudflare Worker is running.");
  return jsonResponse({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    try {
      const response = await routeRequest(request, env);
      return applyCors(response, headers);
    } catch (error) {
      const status = error?.status || 500;
      return applyCors(
        jsonResponse(
          {
            error: status === 500 ? "Internal server error" : error.message,
            detail: env.NODE_ENV === "production" ? undefined : error.stack || String(error),
          },
          status
        ),
        headers
      );
    }
  },
};
