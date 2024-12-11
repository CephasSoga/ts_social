import RedditApifyWrapper from "./reddit";
import Config from "./config";
import Logger from "./logging";

const logger = new Logger(
  "logs", "index.log"
);

// Run the Actor and wait for it to finish
(async () => {

  logger.log("info", "Reading config file...");
  const confi_path = "./config.toml"
  const config = new Config(confi_path)

  const subreddit = 'news'; // Define the subreddit you want to scrape
  logger.log("info", "Creating actor...");
  const wrapper = new RedditApifyWrapper(config);
  logger.log("info", "Started scraping...");
  const posts = await wrapper.scrapeSubreddit(subreddit);
  // Fetch and print Actor results from the run's dataset (if any)
  posts.postData.forEach((item: any) => {
      console.dir(item);
      console.log("\n*****ID: ", item.id, "\n")
  });
  logger.log("info", "Done!")
})();