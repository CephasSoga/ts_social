import InstagramApifyWrapper from "./instagram";
import RedditApifyWrapper from "./reddit";
import { ClientManager, DatabaseOps } from "./db";
import Config from "./config";
import { sleep } from "./utils";


async function run(instagram: InstagramApifyWrapper, reddit: RedditApifyWrapper, ops: DatabaseOps): Promise<void> {
    try {
        const instagramResult = await instagram.collect();
        const redditResult = await reddit.collect();
        await ops.insertMany([instagramResult, redditResult]);
    } catch (error) {
        throw error;
  }
}

async function main(): Promise<void> {
    console.log("Reading configuration file...")
    const configPath = "./config.toml";
    const config = new Config(configPath);

    console.log("Building database client...");
    const clientManager = await ClientManager.new(config);

    console.log("Building database operations manager...")
    const ops = new DatabaseOps(
      clientManager.client,
      config.items.database.database_name,
      config.items.database.collection_name,
    );
    
    console.log("Scraping...");

    const instagram = new InstagramApifyWrapper(config);

    const reddit = new RedditApifyWrapper(config);

    while (true) {
        await run(instagram, reddit, ops);
        await sleep(config.items.control.sleepMs);
    }
}

(async() => ( await main()))();