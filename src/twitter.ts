import { ApifyClient } from 'apify-client';
import Config from './config';
import {info, debug, error, warn} from './logging';
import { config } from 'winston';
import { FetchType } from './options';
import { getFromCacheOrFetch, joinCaheKeyStr, now, toDate } from "./utils";
import { secsBackward } from "./utils";
import { LRUCache } from './cache';

type TwitterActorOutput = Record<any, any>;

interface TwitterActorResult {
    hash: string,
    from: Date,
    to: Date,
    outputs: TwitterActorOutput,
}

interface Input{
    fetch_type: string,
    channels: string[],
    searchTerms?: string[], 
    maxItems?: number, 
    sort?: string, 
    lang?: string, 
    author?: string,
    inReplyTo?: string,
    mentioning?: string,
    minimumRetweets?: number,
    minimumFavorites?: number,
    minimumReplies?: number,
    from?: string,
    to?: string
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
        this.configurations= config.items.twitterActorConfig;
    }

    async scrape(
        channels: string[],
        searchTerms?: string[], 
        maxItems?: number, 
        sort?: string, 
        lang?: string, 
        author?: string,
        inReplyTo?: string,
        mentioning?: string,
        minimumRetweets?: number,
        minimumFavorites?: number,
        minimumReplies?: number,
        from?: string,
        to?: string,
    ): Promise<TwitterActorResult> {
        // Prepare inputs
        info(`Building Actor inputs for channel=${channels}..."`);
        const input = this.buildInput(
            channels,
            searchTerms, 
            maxItems, 
            sort, 
            lang, 
            author,
            inReplyTo,
            mentioning,
            minimumRetweets,
            minimumFavorites,
            minimumReplies,
            from,
            to,
        );

        let outputs: TwitterActorOutput  = {}

        // Run the Actor and wait for it to finish
        info(`Requesting data | Url: ${input.startUrls[0]}...`)
        try {
            const run = await this.client.actor(this.config.items.apifyConfig.twitterActorId).call(input);

            // Fetch and print Actor results from the run's dataset (if any)
            debug('Results from dataset: ');
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            items.forEach((item) => {
                debug("- " + item);
            });

            outputs = {items};
        } catch (err: any) {
            error(`Error scrapping channel=${channels} | Returning an <empty> object...`, err);
            outputs = {};
        }

        const hash = this.generateHashKey(channels, sort? sort: null, maxItems? maxItems: null);
        const from_ = from? toDate(from) : secsBackward(this.config.items.control.timeRangeSecs);
        const to_ = to? toDate(to) : now();
        // Build the TwitterActorResult
        const result: TwitterActorResult = {
            hash,
            from: from_,
            to: to_,
            outputs,
        };

        info(`Scraping complete. Generated hash: ${hash}`);
        return result;
    }

    makeUrl(channel: string): string {
        return `https://twitter.com/${channel}/`;
    }

    buildInput(
        channels: string[], 
        searchTerms?: string[], 
        maxItems?: number, 
        sort?: string, 
        lang?: string, 
        author?: string,
        inReplyTo?: string,
        mentioning?: string,
        minimumRetweets?: number,
        minimumFavorites?: number,
        minimumReplies?: number,
        from?: string,
        to?: string, 
    ) {
        const configurations = this.configurations;

        // Default values for possibly undefined args.
        maxItems = maxItems? maxItems : configurations.maxItems;
        sort = sort? this.validateSort(sort!) : configurations.sort;
        const from_ = from? toDate(from) : secsBackward(this.config.items.control.timeRangeSecs);
        const to_ = to? toDate(to) : now();

        // make startUrls
       const urls = []
        for (const channel of channels) {
            let url = this.makeUrl(channel);
            urls.push(url);
        }

        const input = {
            "startUrls": urls,
            "searchTerms": searchTerms,
            "twitterHandles": configurations.twitterHandles,
            "conversationIds": configurations.conversationIds,
            "maxItems": maxItems,
            "sort": sort,
            "tweetLanguage": lang,
            "author": author,
            "inReplyTo":inReplyTo,
            "mentioning": mentioning,
            "minimumRetweets": minimumRetweets,
            "minimumFavorites": minimumFavorites,
            "minimumReplies": minimumReplies,
            "start": from_,
            "end": to_,
            "customMapFunction": (object: any) => { return {...object} }
        };
        return input;
    }

    validateSort(sort?: string) {
        if (sort) {
            info(`Sorting results by: ${sort}`);
            const validSortFields = ["Latest"] //Add more valid strings here;
            if (!validSortFields.includes(sort)) {
                throw new Error(`Invalid sort field: ${sort}. Allowed fields are ${validSortFields.join(", ")}`);
            }
            return sort
        }
        return undefined
    }

    /**
     * Helper function to generate a unique hash key for the scrape operation.
     */
    private generateHashKey(channels: Array<string>, sort: string | null, maxItems: number | null): string {
        const baseString = JSON.stringify({ channels, sort, maxItems });
        return require('crypto').createHash('md5').update(baseString).digest('hex');
    }

    async poll(args: string): Promise<TwitterActorResult> {
        const fetchFn = async(): Promise<TwitterActorResult> => {
                const {
                fetch_type,
                channels,
                searchTerms, 
                maxItems, 
                sort, 
                lang, 
                author,
                inReplyTo,
                mentioning,
                minimumRetweets,
                minimumFavorites,
                minimumReplies,
                from,
                to,
            }: Input = JSON.parse(args);
            if (fetch_type && FetchType.fromString(fetch_type) === FetchType.Twitter) {
                try {
                    return await this.scrape(channels,
                        searchTerms, 
                        maxItems, 
                        sort, 
                        lang, 
                        author,
                        inReplyTo,
                        mentioning,
                        minimumRetweets,
                        minimumFavorites,
                        minimumReplies,
                        from,
                        to);
                } catch (error: any) {
                    error(`Failed to poll Twitter actor.`, error);
                    throw error;
                }
            } else {
                throw new Error(`Unsupported fecth type: ${fetch_type}`);
            }
        }

        const key = joinCaheKeyStr("twitter", args);
        const res = await getFromCacheOrFetch(key, this.cache, fetchFn);
        return res;
    }
}

export default TwitterActorWrapper;
