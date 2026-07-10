import { COIN_PACKS, DEX_SHOP_ITEMS } from "./db.js";
import { normalizePhone } from "./security.js";

function boolSummary(value, reason) {
  return value ? { configured: true, reason: "ok" } : { configured: false, reason };
}

function trimTrailingSlashes(value) {
  let next = String(value || "");
  while (next.endsWith("/")) next = next.slice(0, -1);
  return next;
}

export function getDiagnostics(env) {
  const aiConfigured = Boolean(env.OPENAI_API_KEY);
  const stripeConfigured = Boolean(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_PUBLISHABLE_KEY &&
    env.STRIPE_PRICE_ID &&
    env.STRIPE_WEBHOOK_SECRET
  );
  const emailConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  const ringCentralConfigured = Boolean(env.RC_CLIENT_ID && env.RC_CLIENT_SECRET);
  const publicSiteUrl = env.PUBLIC_SITE_URL || null;
  const clientOrigin = env.CLIENT_ORIGIN || null;

  return {
    status: "ok",
    summary: {
      providersConfigured: aiConfigured && stripeConfigured && emailConfigured && ringCentralConfigured,
      coreProvidersReady: aiConfigured && stripeConfigured,
      ringcentralReady: ringCentralConfigured,
      publicSiteUrlSet: Boolean(publicSiteUrl),
      clientOriginSet: Boolean(clientOrigin),
    },
    providers: {
      ai: { configured: aiConfigured, ready: aiConfigured, reason: aiConfigured ? "ok" : "missing_api_key", provider: "openai" },
      email: { configured: emailConfigured, ready: emailConfigured, reason: emailConfigured ? "ok" : "missing_credentials" },
      ringcentral: {
        configured: ringCentralConfigured,
        ready: ringCentralConfigured,
        reason: ringCentralConfigured ? "ok" : "missing_credentials",
        fromNumber: normalizePhone(env.RC_PHONE_NUMBER),
      },
      stripe: {
        configured: stripeConfigured,
        ready: stripeConfigured,
        reason: stripeConfigured ? "ok" : "missing_config",
        checkoutUrls: {
          success: boolSummary(env.STRIPE_SUCCESS_URL, "missing_success_url"),
          cancel: boolSummary(env.STRIPE_CANCEL_URL, "missing_cancel_url"),
          portalReturn: boolSummary(env.STRIPE_PORTAL_RETURN_URL, "missing_portal_return_url"),
        },
      },
    },
    launch: {
      site: {
        publicSiteUrl,
        publicSiteUrlStatus: boolSummary(publicSiteUrl, "missing_public_site_url"),
        clientOrigin,
        clientOriginStatus: boolSummary(clientOrigin, "missing_client_origin"),
      },
      auth: {
        jwtSecret: boolSummary(env.JWT_SECRET, "missing_jwt_secret"),
        adminEmail: boolSummary(env.ADMIN_EMAIL, "missing_admin_email"),
        adminPassword: boolSummary(env.ADMIN_PASSWORD, "missing_admin_password"),
      },
    },
    commerce: {
      dexShopItems: DEX_SHOP_ITEMS.length,
      coinPacks: Object.keys(COIN_PACKS).length,
    },
  };
}

export async function createOpenAIReply(env, messages) {
  if (!env.OPENAI_API_KEY) {
    const latestUserMessage = messages.filter((entry) => entry.role === "user").at(-1)?.content || "";
    return `Dex is running without an AI key right now, so I saved your message but can only echo it back: ${latestUserMessage}`;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.8,
      max_tokens: 500,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim() || "Dex could not generate a response.";
}

function encodeForm(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
      continue;
    }
    params.append(key, String(value));
  }
  return params;
}

async function stripeRequest(env, path, body) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed (${response.status})`);
  }
  return payload;
}

export function getProductCatalog(env) {
  const products = [
    {
      id: "subscription",
      name: "Dex AI Subscription",
      type: "subscription",
      amountCents: Number(env.DEX_PRICE_CENTS || 999),
      currency: (env.DEX_CURRENCY || "usd").toLowerCase(),
      stripePriceId: env.STRIPE_PRICE_ID || null,
    },
    ...Object.entries(COIN_PACKS).map(([id, pack]) => ({
      id,
      type: "coins",
      ...pack,
      currency: (env.DEX_CURRENCY || "usd").toLowerCase(),
    })),
  ];
  return products;
}

export async function createStripeCheckoutSession(env, options) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  const siteUrl = trimTrailingSlashes(env.PUBLIC_SITE_URL || options.siteUrl || "https://worker-autumn-cherry-0533.workers.dev");
  return stripeRequest(env, "/v1/checkout/sessions", {
    mode: options.mode,
    "line_items[0][price]": options.priceId,
    "line_items[0][quantity]": options.quantity || 1,
    success_url: `${siteUrl}${options.successPath || "/settings?billing=success"}`,
    cancel_url: `${siteUrl}${options.cancelPath || "/settings?billing=cancelled"}`,
    customer_email: options.customerEmail,
    "metadata[user_id]": options.userId,
    "metadata[purpose]": options.purpose,
  });
}

export async function createStripePortalSession(env, customerId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  const siteUrl = trimTrailingSlashes(env.STRIPE_PORTAL_RETURN_URL || env.PUBLIC_SITE_URL || "https://worker-autumn-cherry-0533.workers.dev");
  return stripeRequest(env, "/v1/billing_portal/sessions", {
    customer: customerId,
    return_url: siteUrl,
  });
}

export async function verifyStripeSignature(env, signatureHeader, rawBody) {
  const secret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret || !signatureHeader) return false;
  const entries = Object.fromEntries(signatureHeader.split(",").map((item) => item.split("=").map((part) => part.trim())));
  const timestamp = entries.t;
  const expectedSignature = entries.v1;
  if (!timestamp || !expectedSignature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const actual = Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === expectedSignature;
}
