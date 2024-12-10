import RedditApifyWrapper from "./reddit";
import Config from "./config";
import log from "./logging";

// Run the Actor and wait for it to finish
(async () => {

  log("info", "Reading config file...");
  const confi_path = "./config.toml"
  const config = new Config(confi_path)

  const subreddit = 'news'; // Define the subreddit you want to scrape
  log("info", "Creating actor...");
  const wrapper = new RedditApifyWrapper(config);
  log("info", "Started scraping...");
  const posts = await wrapper.scrapeSubreddit(subreddit);
  // Fetch and print Actor results from the run's dataset (if any)
  posts.postData.forEach((item: any) => {
      console.dir(item);
  });
  log("info", "Done!")
})();