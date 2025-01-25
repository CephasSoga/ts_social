import { ApifyClient } from 'apify-client';
import Config from './config';
import {info, debug, error, warn} from './logging';
import { config } from 'winston';
import { FetchType } from './options';
import { now, toDate } from "./utils";
import { secsBackward } from "./utils";
import { LRUCache } from './cache';

type TwitterActorOutput = Record<any, any>;

interface TwitterActorResult {
    hash: string,
    from: Date,
    to: Date,
    outputs: TwitterActorOutput[],
}

interface Input{
    fetch_type: string,
    channels: string[],
    from: string,
    to: string,
}

class TwitterActorWrapper<K, V>{
    private client: ApifyClient;
    private cache: LRUCache<K, V>;
    private config: Config;
    private configurations;

    constructor(config: Config, cache: LRUCache<K, V>){
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.cache = cache;
        this.config = config;
        this.configurations= config.items.redditActorConfig;
    }

    async ScrapeTwitterChannel(channel: string): Promise<TwitterActorOutput> {
        info(`Scrapin channel [${channel}]...`);
        // Prepare inputs
        info("Building inputs...");
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
        info("Requesting data...")
        const run = await this.client.actor(this.config.items.apifyConfig.twitterActorId).call(input);

        // Fetch and print Actor results from the run's dataset (if any)
        debug('Results from dataset: ');
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
        items.forEach((item) => {
            debug("- " + item);
        });

        return {items};
    }

    async scrape(
        channels: Array<string>,
        from: Date,
        to: Date
    ): Promise<TwitterActorResult> {
        info("Starting scrape for multiple channels...");

        // Iterate over channels ans scrape each one
        // then aggregate result in Twitter result interface.
        const outputs: TwitterActorOutput[] = [];

        for (const channel of channels) {
            try {
                info(`Scraping channel: ${channel}`);
                
                // Update the config with the given date range
                this.config.items.twitterActorConfig.start = from.toISOString();
                this.config.items.twitterActorConfig.end = to.toISOString();
                
                // Scrape the current channel
                const output = await this.ScrapeTwitterChannel(channel);
                outputs.push(output);

                info(`Successfully scraped channel: ${channel}`);
            } catch (error: any) {
                error(`Failed to scrape channel: ${channel}.`, error);
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

        info(`Scraping complete. Generated hash: ${hash}`);
        return result;

    }

    /**
     * Helper function to generate a unique hash key for the scrape operation.
     */
    private generateHashKey(channels: Array<string>, sort: string | null, maxItems: number | null): string {
        const baseString = JSON.stringify({ channels, sort, maxItems });
        return require('crypto').createHash('md5').update(baseString).digest('hex');
    }

    async poll(args: string): Promise<TwitterActorResult> {
        const {fetch_type, channels, from, to}: Input = JSON.parse(args);
        if (fetch_type && FetchType.fromString(fetch_type) === FetchType.Twitter) {
            try {
                return await this.scrape(channels, toDate(from), toDate(to));
            } catch (error: any) {
                error(`Failed to poll Twitter actor.`, error);
                throw error;
            }
        } else {
            throw new Error(`Unsupported fecth type: ${fetch_type}`);
        }
    }

    async collect(): Promise<TwitterActorResult> {
        info("Twitter Actor is starting...");
    
        // Retrieve Twitter channels from configuration
        const channels = this.config.items.twitterActorConfig.targetChannels;
    
        // Calculate the time range for scraping
        const from = secsBackward(this.config.items.control.timeRangeSecs);
        const to = now();
    
        // Perform the scraping
        const result = await this.scrape(channels, from, to);
    
        info("Twitter Actor has completed scraping.");
        return result;
    }
}

export default TwitterActorWrapper;
