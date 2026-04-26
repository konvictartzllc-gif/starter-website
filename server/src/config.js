import fs from "fs";
import path from "path";

function parseSecretContent(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const envStyleMatch = trimmed.match(/^JWT_SECRET\s*=\s*(.+)$/m);
  if (envStyleMatch) {
    return envStyleMatch[1].trim().replace(/^['"]|['"]$/g, "") || null;
  }

  return trimmed;
}

function readSecretFile(filePath) {
  try {
    const value = fs.readFileSync(filePath, "utf8");
    return parseSecretContent(value);
  } catch {
    return null;
  }
}

function getJwtSecretCandidates() {
  const cwd = process.cwd();
  return [
    process.env.JWT_SECRET?.trim() || null,
    process.env.JWT_SECRET_FILE ? readSecretFile(process.env.JWT_SECRET_FILE) : null,
    readSecretFile("/etc/secrets/JWT_SECRET"),
    readSecretFile(path.join("/etc/secrets", ".env")),
    readSecretFile(path.join(cwd, "JWT_SECRET")),
    readSecretFile(path.join(cwd, ".env")),
    readSecretFile(path.join(cwd, "env", ".env")),
    readSecretFile(path.join(cwd, "..", "JWT_SECRET")),
    readSecretFile(path.join(cwd, "..", ".env")),
    readSecretFile(path.join(cwd, "..", "env", ".env")),
  ];
}

export function getJwtSecret() {
  return getJwtSecretCandidates().find(Boolean) || null;
}

export function requireJwtSecret() {
  const secret = getJwtSecret();
  if (!secret) {
    const attempted = [
      "process.env.JWT_SECRET",
      "process.env.JWT_SECRET_FILE",
      "/etc/secrets/JWT_SECRET",
      "/etc/secrets/.env",
      `${process.cwd()}\\JWT_SECRET`,
      `${process.cwd()}\\.env`,
      `${process.cwd()}\\env\\.env`,
      `${path.join(process.cwd(), "..")}\\JWT_SECRET`,
      `${path.join(process.cwd(), "..")}\\.env`,
      `${path.join(process.cwd(), "..", "env")}\\.env`,
    ];
    throw new Error(
      `JWT_SECRET is missing. Checked: ${attempted.join(", ")}.`
    );
  }
  return secret;
}
