import { app, BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let agentProcess = null;

function resolveAgentEntry() {
  const candidates = [
    path.join(__dirname, "../../agent/dist/cli.js"),
    path.join(__dirname, "../../../packages/agent/dist/cli.js"),
    path.join(process.resourcesPath || "", "agent", "cli.js"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function startEmbeddedAgent() {
  if (process.env.TOOLMGR_SKIP_EMBEDDED_AGENT === "1") return;
  const entry = resolveAgentEntry();
  if (!entry) {
    console.warn("[toolmgr-desktop] agent entry not found; UI will expect an external agent");
    return;
  }
  agentProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TOOLMGR_IS_HUB: process.env.TOOLMGR_IS_HUB || "true",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  agentProcess.on("exit", (code) => {
    console.log("[toolmgr-desktop] embedded agent exited", code);
    agentProcess = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0f1c18",
    title: "ToolMgr",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.TOOLMGR_UI_URL || "http://127.0.0.1:5173";
  if (!app.isPackaged && process.env.TOOLMGR_UI_URL !== "file") {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  startEmbeddedAgent();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (agentProcess && !agentProcess.killed) {
    agentProcess.kill();
  }
});
