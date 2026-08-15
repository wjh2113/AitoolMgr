# P1：工程骨架、统一协议和数字办公室模拟器

先粘贴 `00-preamble.md`，再粘贴本文件。前提：P0 evidence-matrix 已存在。

目标：建立可扩展工程骨架、统一状态协议、Adapter SDK 和使用模拟数据的数字办公室 UI。

任务：
1. 建立/对齐仓库结构（可映射现有 toolMgr 包，但需 contracts + adapter-sdk + digital office）。
2. 用 TypeScript 类型（可辅以 JSON Schema）定义 Machine、ToolInstance、AgentInstance、Task、Approval、CapabilitySet、TelemetryEvent、StateSnapshot、Alert。
3. 实现 Adapter 接口和独立 SimulatorAdapter（明确 `simulated`，生产默认关闭开关）。
4. 实现状态融合最小版本：正式优先、置信度、防抖、UNKNOWN、STALLED。
5. 实现数字办公室 UI：亮屏/黑屏/黄屏/红屏/灰化/问号；Machine → Tool/Gateway → OpenClaw Agent；筛选；工位详情。
6. 添加状态机与 Schema 测试。

验收：
- 模拟事件可演示全部统一状态；
- 一个 Gateway 下多个 Agent 工位；
- UI 明确标识 simulated；
- 未接入真实工具冒充生产 Adapter。
