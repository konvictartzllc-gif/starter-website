import path from "path";

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function withHttps(domain) {
  const trimmed = String(domain || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimTrailingSlash(trimmed);
  return `https://${trimmed}`;
}

export function getPublicApiBaseUrl() {
  const explicit = trimTrailingSlash(process.env.PUBLIC_API_URL);
  if (explicit) return explicit;

  const railwayStaticUrl = trimTrailingSlash(process.env.RAILWAY_STATIC_URL);
  if (railwayStaticUrl) return railwayStaticUrl;

  const railwayPublicDomain = withHttps(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayPublicDomain) return railwayPublicDomain;

  return "";
}

export function getDefaultDbPath(baseDir = process.cwd()) {
  const configured = process.env.DB_PATH?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    return path.join(baseDir, "data", "konvict.db");
  }

  return path.join(baseDir, "..", "data", "konvict.db");
}