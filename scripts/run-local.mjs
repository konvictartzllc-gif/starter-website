import { spawn } from "node:child_process";
import http from "node:http";

const mode = process.argv[2] === "start" ? "start" : "dev";
const HEALTH_PATH = "/api/health";

function isServerAlreadyRunning() {
  return new Promisejavascript
const http = require('http');

const HEALTH_PATH = '/health';

const gpt35TurboReq = http.get(
  {
    hostname: "localhost",
    port: 3001,
    path: HEALTH_PATH
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log(JSON.parse(data));
    });
  }
);
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
      }
  ;
}gpt-3.5-turbo
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => {
      resolve(false);
    });
  ;


function runServerScript(scriptName) {
  const child = spawn("npm", ["--prefix", "server", "run", scriptName], {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code || 0); // Changed '??' to '||' for compatibility
  });
}

const running = await isServerAlreadyRunning();

if (running) {
  console.log("Server already running at http://localhost:3001 (health check passed).");
  process.exit(0);
}

runServerScript(mode);
