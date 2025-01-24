import InstagramApifyWrapper from "./instagram";
import RedditApifyWrapper from "./reddit";
import TwitterActorWrapper from "./twitter";
import { ClientManager, DatabaseOps } from "./db";
import { info, debug, error, warn } from "./logging";
import Config from "./config";
import { sleep } from "./utils";


async function run(instagram: InstagramApifyWrapper, reddit: RedditApifyWrapper, twitter: TwitterActorWrapper, ops: DatabaseOps): Promise<void> {
    try {
        const instagramResult = await instagram.collect();
        const redditResult = await reddit.collect();
        const twitterResult = await twitter.collect();
        await ops.insertMany([instagramResult, redditResult, twitterResult]);
    } catch (error) {
        throw error;
  }
}

async function main(): Promise<void> {
    info("Reading configuration file...")
    const configPath = "./config.toml";
    const config = new Config(configPath);

    info("Building database client...");
    const clientManager = await ClientManager.new(config);

    info("Building database operations manager...")
    const ops = new DatabaseOps(
      clientManager.client,
      config.items.database.database_name,
      config.items.database.collection_name,
    );
    
    info("Scraping...");

    const instagram = new InstagramApifyWrapper(config);

    const reddit = new RedditApifyWrapper(config);

    const twitter = new TwitterActorWrapper(config);

    while (true) {
        await run(instagram, reddit, twitter, ops);
        await sleep(config.items.control.sleepMs);
    }
}

(async() => ( await main()))();