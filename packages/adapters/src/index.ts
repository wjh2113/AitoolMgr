export * from "./types.js";
export * from "./platform.js";
export * from "./fake.js";
export * from "./codex.js";
export * from "./cursor.js";
export * from "./claude.js";
export * from "./coze.js";

import type { AdapterContext, ToolAdapter } from "./types.js";
import { FakeAdapter } from "./fake.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { ClaudeCodeAdapter } from "./claude.js";
import { CozeAdapter } from "./coze.js";

export function createAdapters(ctx: AdapterContext): ToolAdapter[] {
  return [
    new FakeAdapter(ctx),
    new CodexAdapter(ctx),
    new CursorAdapter(ctx),
    new ClaudeCodeAdapter(ctx),
    new CozeAdapter(ctx),
  ];
}
