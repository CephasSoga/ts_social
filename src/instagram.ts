import {z, ZodError } from "zod";
import { ApifyClient, ActorRun } from 'apify-client';
import Config from './config';
import { info, warn, error, debug } from "./logging";
import { now, secsBackward, toDate, getFromCacheOrFetch, joinCaheKeyStr } from "./utils";
import { FetchType } from "./options";
import { Parser } from "./params";
import { LRUCache, MongoCacheFallbackClient } from "./cache";

interface Header {
    url: string,
    description:string,
    error: string,
    errorDescription: string,
    // Index signature to allow unexpected fields
    [key: string]: any; // This allows any additional properties with string keys and any type of value

}

interface MusicInfo {
    artist_name: string;
    song_name: string;
    uses_original_audio: boolean;
    should_mute_audio: boolean;
    should_mute_audio_reason: string;
    audio_id: string;
}

interface Comment {
    id: string;
    text: string;
    ownerUsername: string;
    ownerProfilePicUrl: string;
    timestamp: string; // ISO date string
    repliesCount: number;
    replies: any[]; // You can define a more specific type if needed
    likesCount: number;
    owner: any; // Define a more specific type if needed
}
interface InstagramPost {
    inputUrl: string;
    id: string;
    type: "Image" | "Video" | "Other";
    shortCode: string;
    caption: string | null;
    hashtags: string[];
    mentions: string[];
    url: string;
    commentsCount: number;
    firstComment: string;
    latestComments: Comment[];
    dimensionsHeight: number;
    dimensionsWidth: number;
    displayUrl: string;
    images: string[];
    videoUrl: string | null;
    alt: string | null;
    likesCount: number;
    videoViewCount: number | null;
    videoPlayCount: number | null;
    timestamp: string; // ISO date string
    childPosts: InstagramPost[];
    ownerFullName: string;
    ownerUsername: string;
    ownerId: string;
    productType: string;
    videoDuration: number | null;
    isSponsored: boolean;
    musicInfo: MusicInfo;
}

// Header Schema
const HeaderSchema = z.object({
    url: z.string().url(),
    description: z.string(),
    error: z.string(),
    errorDescription: z.string(),
    // Allow unexpected fields
    additionalProperties: z.record(z.unknown()), // This allows any additional properties with string keys and any type of value
});

// ... existing code ...

// MusicInfo Schema
const MusicInfoSchema = z.object({
    artist_name: z.string(),
    song_name: z.string(),
    uses_original_audio: z.boolean(),
    should_mute_audio: z.boolean(),
    should_mute_audio_reason: z.string(),
    audio_id: z.string(),
});

// Comment Schema
const CommentSchema = z.object({
    id: z.string(),
    text: z.string(),
    ownerUsername: z.string(),
    ownerProfilePicUrl: z.string().url(),
    timestamp: z.string().datetime(),
    repliesCount: z.number().nonnegative(),
    replies: z.array(z.unknown()), // Adjust as necessary
    likesCount: z.number().nonnegative(),
    owner: z.unknown(), // Adjust as necessary
});

// InstagramPost Schema
const InstagramPostSchema = z.object({
    inputUrl: z.string().url(),
    id: z.string(),
    type: z.enum(["Image", "Video", "Other"]),
    shortCode: z.string(),
    caption: z.string().nullable(),
    hashtags: z.array(z.string()),
    mentions: z.array(z.string()),
    url: z.string().url(),
    commentsCount: z.number().nonnegative(),
    firstComment: z.string(),
    latestComments: z.array(CommentSchema),
    dimensionsHeight: z.number().positive(),
    dimensionsWidth: z.number().positive(),
    displayUrl: z.string().url().nullable(),
    images: z.array(z.string().url()),
    videoUrl: z.string().url().nullable(),
    alt: z.string().nullable(),
    likesCount: z.number().nonnegative(),
    videoViewCount: z.number().nullable(),
    videoPlayCount: z.number().nullable(),
    timestamp: z.string().datetime(),
    childPosts: z.lazy((): any => InstagramPostSchema),
    ownerFullName: z.string(),
    ownerUsername: z.string(),
    ownerId: z.string(),
    productType: z.string(),
    videoDuration: z.number().nullable(),
    isSponsored: z.boolean(),
    musicInfo: MusicInfoSchema,
});

// Export the schemas for use in validation
export { InstagramPostSchema, CommentSchema, MusicInfoSchema };

type Unexpected = Record<string ,any|unknown>;
type InstagramActorOutput = Array<InstagramPost | Header | Unexpected>;

interface Input{
    fetch_type: string,
    channels: string[],
    sort?: string, 
    resultsLimit?: number,
    searchLimit?: number, 
    searchType?: string,
    from?: string,
    to?: string,
}; 

interface InstagramActorResultForChannel {
    output: InstagramActorOutput,
    channel: string,
}

interface InstagramActorResult {
    hashKey: string,
    results: Array<InstagramActorResultForChannel>
    from: Date,
    to: Date
}

class InstagramScrapingError extends Error {
    public channel?;
    public params?;
    constructor(message: string, channel?: string, params?: any) {
        super(message);
        this.name = 'InstagramScrapingError';
        this.message = message;
        this.channel = channel;
        this.params = params;
    }
}

class DataFormatError extends Error {
    public invalidFields?: Record<string, any>;
    public context?: string;
    public rawData?: any;
    public expected: any;
    public received: any;

    constructor(
        message: string,
        expected: any,
        recived: any,
        invalidFields?: Record<string, any>,
        context?: string,
        rawData?: any,
    ) {
        super(message);
        this.name = 'DataFormatError';
        this.invalidFields = invalidFields;
        this.context = context;
        this.rawData = rawData;
        this.expected = expected;
        this.received = recived;
    }
}

class InstagramApifyWrapper<K, V> {
    private client: ApifyClient;
    private cache: LRUCache<K, V>;
    private config: Config;
    private configurations;

    constructor(config: Config, cache: LRUCache<K, V>) {
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.cache = cache;
        this.config = config
        this.configurations = this.config.items.instagramActorConfig;
    }

    async scrapeInstagramChannel(
        channel: string, 
        sort?: string, 
        resultsLimit?: number,
        searchLimit?: number, 
        searchType?: string
    ): Promise<InstagramActorOutput> {
        // Prepare Actor input
        info(`Building inputs for Actor for Channel=${channel}...`);
        const input = this.builActorInput(channel, sort, resultsLimit, searchLimit, searchType);

        info("Requesting data. | Url: " + input.directUrls);
        try {
            const actorID = this.config.items.apifyConfig.instagramActorId;
            // Run the Actor and wait for it to finish
            info("Running Instagram Actor. | ID: " + actorID);
            const run: ActorRun = await this.client.actor(actorID).call(input);
            
            // Get the results from the Actor's dataset
            info("Some data was returned from the Actor. | Collecting...");
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            
            // Log and parse each item
            const parsedItems: InstagramActorOutput = [];
            let count = 0;
            for (const item of items) {
                //console.dir(item);
                debug(`Parsing itemn ${count++ +1} of ${items.length}...`);
                const parsedItem = await this.parseItem(item); // Use parseItem to handle the item
                parsedItems.push(parsedItem);
            }
        
            // Check if parsedItems contains valid results or fallback to Unexpected
            if (parsedItems.length === 0) {
                warn(
                    "No valid data found in the dataset. Fallback structure will be used...",
                    JSON.stringify(new DataFormatError(
                        "Unexpected dataset structure.",
                        { expectedType: "Array<InstagramPost | Header>" },
                        { receivedType: typeof items },
                        { invalidFields: Object.keys(items) },
                        "Parsing items failed to match expected schema.",
                        { issues: null })
                    )
                );
                return items as Unexpected[]; // Return the raw data as a fallback
            }
            // Return the successfully parsed data
            return parsedItems;

        } catch (err: any) {
            const actorError = new InstagramScrapingError(
                `Actor failed to scrape channel <${channel}>`,
                channel,
                { params: this.config.getItems() }
            );
        
            error("Scraping failed!", actorError);
            throw actorError;
        }
    }  

    async parseItem(item: any): Promise<InstagramPost | Header | Unexpected> {
        // Attempt to parse using InstagramPostSchema
        const postParseResult = InstagramPostSchema.safeParse(item);
        if (postParseResult.success) {
            return postParseResult.data; // Return the valid InstagramPost
        }
    
        // Attempt to parse using HeaderSchema
        const headerParseResult = HeaderSchema.safeParse(item);
        if (headerParseResult.success) {
            return headerParseResult.data; // Return the valid Header
        }
    
        // If both schemas fail, return the item as Unexpected
        return item as Unexpected;
    }

    builActorInput(
        channel: string, 
        sort?: string, 
        resultsLimit?: number,
        searchLimit?: number, 
        searchType?: string) 
    {
        // Validate sort arg.
        info("Validating Args...")
        sort = this.validateSort(sort);

        const configurations = this.configurations; 
        sort = sort? sort : configurations.sort;
        resultsLimit = resultsLimit? resultsLimit: configurations.resultsLimit;
        searchLimit = searchLimit? searchLimit: configurations.searchLimit;
        searchType = searchType? searchType: configurations.searchType;

        const input = {
            "directUrls": [
                `${configurations.baseUrl}/${channel}/`
            ],
            "resultsType": configurations.resultsType,
            "resultsLimit": resultsLimit,
            "searchType": searchType,
            "searchLimit": searchLimit,
            "addParentData": configurations.addParentData,
            "sort": sort,
        };
        return input;
    }

    validateSort(sort?: string) {
        if (sort) {
            info(`Sorting results by: ${sort}`);
            const validSortFields = ["likesCount", "commentsCount", "timestamp"];
            if (!validSortFields.includes(sort)) {
                throw new Error(`Invalid sort field: ${sort}. Allowed fields are ${validSortFields.join(", ")}`);
            }
            return sort
        }
        return undefined
    }
    
    async scrape(
        channels: Array<string>,
        sort?: string, 
        resultsLimit?: number,
        searchLimit?: number, 
        searchType?: string,
        from?: string,
        to?: string,
    ): Promise<InstagramActorResult> {
        const results: Array<InstagramActorResultForChannel> = [];
        const from_ = from? new Date(from) : now();
        const to_ = to? new Date(to) : secsBackward(this.config.items.control.timeRangeSecs);
    
        for (const channel of channels) {
            try {
                info(`Scraping channel: ${channel}`);
                const output = await this.scrapeInstagramChannel(
                    channel,
                    sort,
                    resultsLimit,
                    searchLimit,
                    searchType
                );
                // Apply timestamp filtering
                const filteredOutput = this.filterByTimestamp(output, from_, to_);

                results.push({
                    channel,
                    output: filteredOutput,
                });

            } catch (err: any) {
                error(
                    `Failed to scrape channel: ${channel}`,
                    error instanceof InstagramScrapingError ? error : new InstagramScrapingError(err.message, channel)
                );
            }
        }
    
    
        info("Scraping completed.");
        return {
            hashKey: this.generateHashKey(channels, sort ? sort : null, resultsLimit? resultsLimit : null),
            results,
            from: from_,
            to: to_,
        };
    }
    
    private filterByTimestamp(output: InstagramActorOutput, from: Date, to: Date): InstagramActorOutput {
        return output.filter((item: InstagramPost | Header | Unexpected) => {
            const itemTimestamp = (item as any).timestamp;
            if (itemTimestamp) {
                const timestamp = new Date(itemTimestamp);
                return timestamp >= from && timestamp <= to;
            }
            return true;
        });
    }

    /**
     * Helper function to generate a unique hash key for the scrape operation
     */
    private generateHashKey(channels: Array<string>, sort: string | null, maxItems: number | null): string {
        const baseString = JSON.stringify({ channels, sort, maxItems });
        return require('crypto').createHash('md5').update(baseString).digest('hex');
    }

    async poll(args: string): Promise<InstagramActorResult> {
        const fetchFn = async () => {
            const {
                fetch_type,
                channels,
                sort, 
                resultsLimit,
                searchLimit, 
                searchType,
                from,
                to}: Input = JSON.parse(args)
            if (fetch_type && FetchType.fromString(fetch_type) === FetchType.Instagram) {
                try {
                    return await this.scrape(channels, sort, 
                        resultsLimit,
                        searchLimit, 
                        searchType,
                        from,
                        to)
                } catch (err: any) {
                    error("Failed to poll Instagram data", err);
                    throw err;
                }
            } else {
                error("Invalid fetch type", fetch_type);
                throw new Error(`Unsupported fetch type: ${fetch_type}`);
            }
        }
        const key = joinCaheKeyStr("instagram", args);
        return await getFromCacheOrFetch(key, this.cache, fetchFn);
    }
}

export default InstagramApifyWrapper;
