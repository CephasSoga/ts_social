import { ApifyClient } from 'apify-client';
import Config from './config';
import Logger from './logging';
import { config } from 'winston';

type TwitterActorOutput = Record<any, any>;

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
        // Prepare inputs
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
        const run = await this.client.actor("61RPP7dywgiy0JPD0").call(input);

        // Fetch and print Actor results from the run's dataset (if any)
        console.log('Results from dataset');
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
        items.forEach((item) => {
            console.dir(item);
        });

        return {items};
    }
}

export default TwitterActorWrapper;
