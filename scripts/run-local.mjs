import { spawn } from "node:child_process";
import http from "node:http";

const mode = process.argv[2] === "start" ? "start" : "dev";
const HEALTH_PATH = "/api/health";

function isServerAlreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "localhost",
        port: 4000,
        path: HEALTH_PATH,
        timeout: 1200,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }

          try {
            const body = JSON.parse(raw);
            resolve(body?.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => {
      resolve(false);
    });
  });
}

function runServerScript(scriptName) {
  const child = spawn("npm", ["--prefix", "server", "run", scriptName], {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

const running = await isServerAlreadyRunning();

if (running) {
  console.log("Server already running at http://localhost:4000 (health check passed).");
  process.exit(0);
}

runServerScript(mode);
