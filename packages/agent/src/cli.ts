import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import dotenv from "dotenv";
import { loadConfig, resolveMachineId } from "./config.js";
import { HubClient, startStaleMachineWatcher } from "./hub.js";
import { Orchestrator } from "./orchestrator.js";
import { startOfficeEngine, simulatorEnabled } from "./office.js";
import { startServer } from "./server.js";
import { Store } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

async function main() {
  const config = loadConfig();
  const machineId = resolveMachineId(config.dataDir);
  const store = new Store(config.dataDir);
  const orchestrator = new Orchestrator(config, store, machineId);
  await orchestrator.start();

  const office = await startOfficeEngine({
    machineId,
    machineName: config.machineName,
    os: `${os.platform()}-${os.arch()}`,
    config,
    store,
  });

  const { server } = await startServer(orchestrator, config, office, store);
  const hubClient = new HubClient(config, orchestrator);
  hubClient.start();
  const stopWatcher = startStaleMachineWatcher(orchestrator, config.isHub);

  console.log(
    `[aitoolmgr-agent] ${config.machineName} (${machineId}) http://${config.host}:${config.port} hub=${config.isHub} simulator=${simulatorEnabled()} db=${store.path}`,
  );

  const shutdown = async () => {
    console.log("[aitoolmgr-agent] shutting down...");
    hubClient.stop();
    stopWatcher();
    office.stop();
    await orchestrator.stop();
    store.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
