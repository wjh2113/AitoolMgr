import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createId } from "@toolmgr/core";
import type { AgentConfig } from "@toolmgr/core";
import { defaultDataDir, ensureDir, hostPlatform, platformLabel } from "@toolmgr/adapters";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const dataDir = ensureDir(
    path.resolve(env.TOOLMGR_DATA_DIR || defaultDataDir("ToolMgr")),
  );

  return {
    port: Number(env.TOOLMGR_PORT || 7788),
    host: env.TOOLMGR_HOST || "127.0.0.1",
    dataDir,
    machineName:
      env.TOOLMGR_MACHINE_NAME ||
      `${os.hostname()} (${platformLabel(hostPlatform())})`,
    pairingToken: env.TOOLMGR_PAIRING_TOKEN || "change-me",
    hubUrl: env.TOOLMGR_HUB_URL || undefined,
    isHub: (env.TOOLMGR_IS_HUB || "true").toLowerCase() !== "false",
    feishuWebhookUrl: env.FEISHU_WEBHOOK_URL || undefined,
    feishuWebhookSecret: env.FEISHU_WEBHOOK_SECRET || undefined,
    cursorApiKey: env.CURSOR_API_KEY || undefined,
    cozePat: env.COZE_PAT || undefined,
    cozeBotId: env.COZE_BOT_ID || undefined,
    cozeBaseUrl: env.COZE_BASE_URL || "https://api.coze.cn",
  };
}

export function resolveMachineId(dataDir: string): string {
  const file = path.join(dataDir, "machine-id");
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8").trim();
  }
  const id = createId("machine");
  fs.writeFileSync(file, id, "utf8");
  return id;
}
