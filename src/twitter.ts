import { ApifyClient } from 'apify-client';
import Config from './config';
import Logger from './logging';
import { config } from 'winston';
import { now } from "./utils";
import { secsBackward } from "./utils";

type TwitterActorOutput = Record<any, any>;

interface TwitterActorResult {
    hash: string,
    from: Date,
    to: Date,
    outputs: TwitterActorOutput[],
}

class TwitterActorWrapper{
    private client: ApifyClient;
    private config: Config;
    private logger: Logger;

    constructor(config: Config){
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.config = config
        this.logger = new Logger(
            `${this.config.items.logging.dir}/${this.config.items.logging.twitterActorLogFile}`,
            this.config.items.logging.level
        );
    }

    async ScrapeTwitterChannel(channel: string): Promise<TwitterActorOutput> {
        this.logger.log("info", `Scrapin channel [${channel}]...`);
        // Prepare inputs
        this.logger.log("info", "Building inputs...");
        const input = {
            "startUrls": [
                `https://twitter.com/${channel}/`
            ],
            "searchTerms": this.config.items.twitterActorConfig.searchTerms,
            "twitterHandles": this.config.items.twitterActorConfig.twitterHandles,
            "conversationIds": this.config.items.twitterActorConfig.conversationIds,
            "maxItems": this.config.items.twitterActorConfig.maxItems,
            "sort": this.config.items.twitterActorConfig.sort,
            "tweetLanguage": this.config.items.twitterActorConfig.tweetLanguage,
            "author": this.config.items.twitterActorConfig.author,
            "inReplyTo": this.config.items.twitterActorConfig.inReplyTo,
            "mentioning": this.config.items.twitterActorConfig.mentioning,
            "geotaggedNear": this.config.items.twitterActorConfig.geotaggedNear,
            "withinRadius": this.config.items.twitterActorConfig.withinRadius,
            "geocode": this.config.items.twitterActorConfig.geocode,
            "placeObjectId": this.config.items.twitterActorConfig.placeObjectId,
            "minimumRetweets": this.config.items.twitterActorConfig.minimumRetweets,
            "minimumFavorites": this.config.items.twitterActorConfig.minimumFavorites,
            "minimumReplies": this.config.items.twitterActorConfig.minimumReplies,
            "start": this.config.items.twitterActorConfig.start,
            "end": this.config.items.twitterActorConfig.end,
            "customMapFunction": (object: any) => { return {...object} }
        };

        // Run the Actor and wait for it to finish
        this.logger.log("info", "Requesting data...")
        const run = await this.client.actor(this.config.items.apifyConfig.twitterActorId).call(input);

        // Fetch and print Actor results from the run's dataset (if any)
        console.log('Results from dataset');
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
        items.forEach((item) => {
            console.dir(item);
        });

        return {items};
    }

    async scrape(
        channels: Array<string>,
        from: Date,
        to: Date
    ): Promise<TwitterActorResult> {
        this.logger.log("info", "Starting scrape for multiple channels...");

        // Iterate over channels ans scrape each one
        // then aggregate result in Twitter result interface
        const outputs: TwitterActorOutput[] = [];

        for (const channel of channels) {
            try {
                this.logger.log("info", `Scraping channel: ${channel}`);
                
                // Update the config with the given date range
                this.config.items.twitterActorConfig.start = from.toISOString();
                this.config.items.twitterActorConfig.end = to.toISOString();
                
                // Scrape the current channel
                const output = await this.ScrapeTwitterChannel(channel);
                outputs.push(output);

                this.logger.log("info", `Successfully scraped channel: ${channel}`);
            } catch (error: any) {
                this.logger.log("error", `Failed to scrape channel: ${channel}.`, error);
            }
        }

        // Generate a hash key for the operation
        const hash = this.generateHashKey(channels, this.config.items.twitterActorConfig.sort, this.config.items.twitterActorConfig.maxItems);

        // Build the TwitterActorResult
        const result: TwitterActorResult = {
            hash,
            from,
            to,
            outputs,
        };

        this.logger.log("info", `Scraping complete. Generated hash: ${hash}`);
        return result;

    }

    /**
     * Helper function to generate a unique hash key for the scrape operation
     */
    private generateHashKey(channels: Array<string>, sort: string | null, maxItems: number | null): string {
        const baseString = JSON.stringify({ channels, sort, maxItems });
        return require('crypto').createHash('md5').update(baseString).digest('hex');
    }

    async collect(): Promise<TwitterActorResult> {
        this.logger.log("info", "Twitter Actor is starting...");
    
        // Retrieve Twitter channels from configuration
        const channels = this.config.items.twitterActorConfig.targetChannels;
    
        // Calculate the time range for scraping
        const from = secsBackward(this.config.items.control.timeRangeSecs);
        const to = now();
    
        // Perform the scraping
        const result = await this.scrape(channels, from, to);
    
        this.logger.log("info", "Twitter Actor has completed scraping.");
        return result;
    }
}

export default TwitterActorWrapper;
