import fs from "fs";

function readSecretFile(path) {
  try {
    const value = fs.readFileSync(path, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function getJwtSecret() {
  return (
    process.env.JWT_SECRET?.trim() ||
    readSecretFile("/etc/secrets/JWT_SECRET") ||
    readSecretFile("JWT_SECRET") ||
    null
  );
}

export function requireJwtSecret() {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error("JWT_SECRET is missing. Set the environment variable or provide a Render Secret File named JWT_SECRET.");
  }
  return secret;
}
