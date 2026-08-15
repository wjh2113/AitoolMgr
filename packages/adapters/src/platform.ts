import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type HostPlatform = "win32" | "darwin" | "linux" | "unknown";

export function hostPlatform(): HostPlatform {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "unknown";
}

export function platformLabel(p: HostPlatform = hostPlatform()): string {
  if (p === "win32") return "Windows";
  if (p === "darwin") return "macOS";
  if (p === "linux") return "Linux";
  return process.platform;
}

/** User-writable app data dir for ToolMgr on the current OS. */
export function defaultDataDir(appName = "ToolMgr"): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, "AppData", "Local");
    return path.join(base, appName);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, appName.toLowerCase());
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a CLI on PATH in a cross-platform way. */
export function which(command: string): string | null {
  const isWin = process.platform === "win32";
  const checker = isWin ? "where" : "which";
  const result = spawnSync(checker, [command], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) return null;
  const line = (result.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line || null;
}

export function commandExists(command: string): boolean {
  return Boolean(which(command));
}

export function spawnDetached(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
) {
  return spawn(command, args, {
    cwd: opts?.cwd,
    env: { ...process.env, ...opts?.env },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

/** Bring a named desktop app to the foreground (Windows / macOS). */
export function focusApp(appName: string): boolean {
  if (process.platform === "win32") {
    const ps = `
$name = ${JSON.stringify(appName)};
$shell = New-Object -ComObject WScript.Shell;
if (-not $shell.AppActivate($name)) {
  Get-Process | Where-Object { $_.MainWindowTitle -like "*$name*" } |
    ForEach-Object { $shell.AppActivate($_.Id) | Out-Null }
}
`;
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  }

  if (process.platform === "darwin") {
    // Prefer exact app name; fall back to bundle id patterns for Cursor.
    const script =
      appName.toLowerCase() === "cursor"
        ? `tell application "Cursor" to activate`
        : `tell application ${JSON.stringify(appName)} to activate`;
    spawn("osascript", ["-e", script], { stdio: "ignore" });
    return true;
  }

  // Linux: best-effort via wmctrl if present
  if (which("wmctrl")) {
    spawn("wmctrl", ["-a", appName], { stdio: "ignore" });
    return true;
  }
  return false;
}

export function openUrl(url: string) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { windowsHide: true, stdio: "ignore" });
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore" });
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore" });
}
