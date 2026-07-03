const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : encoder.encode(String(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signHmac(secret, value) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function textResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}

export function buildAllowedOrigins(env) {
  const defaults = [
    "https://www.konvict-artz.com",
    "https://konvict-artz.com",
    "https://worker-autumn-cherry-0533.workers.dev",
  ];
  const configured = [
    env.PUBLIC_SITE_URL,
    env.CLIENT_ORIGIN,
    ...(env.ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => String(origin || "").trim())
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...configured]));
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = buildAllowedOrigins(env);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Stripe-Signature",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

export function applyCors(response, headers) {
  const nextHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => nextHeaders.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function randomToken(size = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return toBase64Url(bytes);
}

export async function hashPassword(password) {
  const salt = randomToken(16);
  const iterations = 210000;
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations,
      hash: "SHA-256",
    },
    material,
    256
  );
  return `pbkdf2$${iterations}$${salt}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith("pbkdf2$")) return false;
  const [, iterationsRaw, salt, expected] = storedHash.split("$");
  const iterations = Number(iterationsRaw || 0);
  if (!iterations || !salt || !expected) return false;
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations,
      hash: "SHA-256",
    },
    material,
    256
  );
  return toBase64Url(new Uint8Array(bits)) === expected;
}

export async function signJwt(payload, secret, expiresInSeconds = 7 * 24 * 60 * 60) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedBody = toBase64Url(JSON.stringify(body));
  const message = `${encodedHeader}.${encodedBody}`;
  const signature = await signHmac(secret, message);
  return `${message}.${signature}`;
}

export async function verifyJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = parts;
  const validSignature = await signHmac(secret, `${encodedHeader}.${encodedBody}`);
  if (validSignature !== signature) return null;
  const payload = JSON.parse(decoder.decode(fromBase64Url(encodedBody)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function getBearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export function normalizePhone(value) {
  const input = String(value || "").trim();
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+")) return `+${digits}`;
  return input;
}
