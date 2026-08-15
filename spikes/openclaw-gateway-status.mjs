#!/usr/bin/env node
/** P0 spike: print desensitized OpenClaw gateway status. */
import { spawn } from "node:child_process";

const child = spawn("openclaw", ["gateway", "status", "--json"], {
  shell: process.platform === "win32",
  windowsHide: true,
});

let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (out += d.toString()));
child.on("exit", (code) => {
  try {
    const json = JSON.parse(out);
    const safe = {
      cliVersion: json.cli?.version,
      gatewayPort: json.service?.command?.programArguments?.includes("--port")
        ? json.service.command.programArguments[
            json.service.command.programArguments.indexOf("--port") + 1
          ]
        : json.service?.command?.environment?.OPENCLAW_GATEWAY_PORT,
      serviceLoaded: json.service?.loaded,
      note: "No tokens or message bodies included",
    };
    console.log(JSON.stringify(safe, null, 2));
  } catch {
    console.log(JSON.stringify({ ok: false, exit: code, hint: "gateway status parse failed" }));
  }
});
