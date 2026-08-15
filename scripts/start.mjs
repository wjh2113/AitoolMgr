#!/usr/bin/env node
/**
 * Cross-platform ToolMgr launcher (Windows / macOS / Linux).
 * Starts agent + desktop UI, or agent-only with --agent-only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const agentOnly = process.argv.includes("--agent-only");
const uiOnly = process.argv.includes("--ui-only");

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
}

function ensureBuilt() {
  const agentCli = path.join(root, "packages/agent/dist/cli.js");
  if (!fs.existsSync(agentCli)) {
    console.log("[toolmgr] building packages…");
    const result = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "build"],
      { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
    );
    return new Promise((resolve, reject) => {
      result.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("build failed"))));
    });
  }
  return Promise.resolve();
}

const children = [];

async function main() {
  await ensureBuilt();
  console.log(`[toolmgr] platform=${process.platform} arch=${process.arch}`);

  if (!uiOnly) {
    children.push(run("npm", ["run", "start:agent"]));
  }
  if (!agentOnly) {
    // Give agent a moment on cold start
    await new Promise((r) => setTimeout(r, 800));
    children.push(run("npm", ["run", "dev:desktop"]));
  }

  const shutdown = () => {
    for (const child of children) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
