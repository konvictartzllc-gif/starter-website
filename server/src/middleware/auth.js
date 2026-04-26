import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config.js";

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: "Authentication service is not configured correctly." });
    const payload = jwt.verify(token, secret);
    if (payload.role !== "admin") return res.status(403).json({ error: "Forbidden: admin only" });
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireUser(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: "Authentication service is not configured correctly." });
    const payload = jwt.verify(token, secret);
    if (!["user", "admin", "affiliate"].includes(payload.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalUser(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const secret = getJwtSecret();
      if (secret) {
        req.user = jwt.verify(token, secret);
      }
    } catch {
      // ignore invalid token for optional auth
    }
  }
  return next();
}
