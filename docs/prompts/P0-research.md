# P0：接口调查与可行性验证

先粘贴 `00-preamble.md`，再粘贴本文件。

当前阶段：P0，只做证据驱动的调查和最小验证，不开发正式产品功能。

目标：确认本机和目标环境中 Codex、Cursor、VS Code、OpenClaw 可用的公开集成面，建立后续实现的事实基础。

任务：
1. 检查仓库结构；若为空，创建 docs/research、docs/adr、spikes 和最小 README。
2. 在不泄露凭证的前提下检查已安装工具的版本和 --help。未安装的工具记录为 unavailable，不要擅自安装。
3. 查阅相应官方文档和公开类型定义，记录 URL、访问日期、工具版本、能力和限制。
4. 为以下能力建立证据矩阵：发现实例、读取状态、订阅事件、启动任务、继续任务、取消任务、处理审批、获取会话、读取 Agent/子 Agent。
5. 在 spikes 中创建可删除的最小验证程序或脚本，捕获经过脱敏的真实事件样本。
6. 对 OpenClaw 特别验证：协议版本发现、methods/events、agent + agent.wait、sessions、断线后快照恢复。
7. 不知道的字段不得补写。Fixture 必须标明工具版本并脱敏。
8. 创建 ADR：总体架构、状态可信度模型、主动连接、OpenClaw loopback。

验收：
- docs/research/evidence-matrix.md 存在且每条能力有证据或明确标记；
- 至少有 Codex、Cursor、VS Code、OpenClaw 四份研究记录；
- 不存在声称支持但没有证据的事件名；
- 本阶段不实现正式 UI 和远程执行。
