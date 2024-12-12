import { ApifyClient } from 'apify-client';
import Config from './config';

const config = new Config('./config.toml')

// Initialize the ApifyClient with API token
const client = new ApifyClient({
    token: config.items.apifyConfig.token,
});

// Prepare Actor input
const input = {
  "keyword": "elonmusk",
  "maximum": 2,
  "retry": 2,
  "proxy": {
      "useApifyProxy": true,
      "apifyProxyGroups": [
          "RESIDENTIAL"
      ]
  }
};

(async () => {
  // Run the Actor and wait for it to finish
  const run = await client.actor("DDe3hNSgaR7I1wkOc").call(input);

  // Fetch and print Actor results from the run's dataset (if any)
  console.log('Results from dataset');
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  items.forEach((item) => {
      console.dir(item);
  });
})();