import { info, debug, error, warn } from "./logging";
import Config from "./config";
import { sleep } from "./utils";
import WebSocketServer from "./websocket";
import { LRUCache, MongoCacheFallbackClient } from "./cache";



async function main(): Promise<void> {
    try {
        info("Reading configuration file...")
        const configPath = "./config.toml";
        const config = new Config(configPath);

        info("Creating caching requirements...")
        const size = 100;
        const fallbackdb = new MongoCacheFallbackClient(config)
        
        info("Starting WebSocket server...");
        const websocketServer = new WebSocketServer(config, size, fallbackdb);
        await websocketServer.run();
    } catch (err: any) {
        error("An error occurred:", err);
    }
}

(async() => ( await main()))();