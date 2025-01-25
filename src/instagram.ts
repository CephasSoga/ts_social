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
    limit?: number,
    from?: string,
    to?: string,
    sort?: string
    max_items?: number,
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

    constructor(config: Config, cache: LRUCache<K, V>) {
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.cache = cache;
        this.config = config
    }

    async scrapeInstagramChannel(channel: string,): Promise<InstagramActorOutput> {
        
        // Prepare Actor input
        info(`Building inputs for Actor for Channel=${channel}`);
        const input = {
            "directUrls": [
                `${this.config.items.instagramActorConfig.baseUrl}/${channel}/`
            ],
            "resultsType": this.config.items.instagramActorConfig.resultsType,
            "resultsLimit": this.config.items.instagramActorConfig.resultsLimit,
            "searchType": this.config.items.instagramActorConfig.searchType,
            "searchLimit": this.config.items.instagramActorConfig.searchLimit,
            "addParentData": this.config.items.instagramActorConfig.addParentData
        };

        info("Requesting data. Url|: " + input.directUrls);
        try {
            // Run the Actor and wait for it to finish
            info("Running Actor. | ID: " + this.config.items.apifyConfig.instagramActorId);
            const run: ActorRun = await this.client.actor(this.config.items.apifyConfig.instagramActorId).call(input);
            
            // Get the results from the Actor's dataset
            info("Some data was returned from the Actor. | Collecting...");
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            
            // Log and parse each item
            const parsedItems: InstagramActorOutput = [];
            let count = 0;
            for (const item of items) {
                //console.dir(item);
                debug(`Parsing itemn ${count++} of ${items.length}...`);
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
        } catch (error: any) {
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
    
    async scrape(
        channels: Array<string>,
        from: Date,
        to: Date,
        sort?: string,
        maxItems?: number,
    ): Promise<InstagramActorResult> {
        const results: Array<InstagramActorResultForChannel> = [];
    
        for (const channel of channels) {
            try {
                info(`Scraping channel: ${channel}`);
                const output = await this.scrapeInstagramChannel(channel);

                // Apply timestamp filtering
                const filteredOutput = this.filterByTimestamp(output, from, to);

                results.push({
                    channel,
                    output: filteredOutput,
                });

            } catch (error: any) {
                error(
                    `Failed to scrape channel: ${channel}`,
                    error instanceof InstagramScrapingError ? error : new InstagramScrapingError(error.message, channel)
                );
            }
        }
    
        // Apply sorting if specified
        if (sort) {
            info(`Sorting results by: ${sort}`);
            const validSortFields = ["likesCount", "commentsCount", "timestamp"];
            if (!validSortFields.includes(sort)) {
                throw new Error(`Invalid sort field: ${sort}. Allowed fields are ${validSortFields.join(", ")}`);
            }
    
            results.forEach((result) => {
                result.output.sort((a, b) => {
                    if (sort in a && sort in b) {
                        return (b as any)[sort] - (a as any)[sort]; // Descending order
                    }
                    return 0; // Keep the order if the field is missing
                });
            });
        }
    
        // Truncate the total number of items if maxItems is set
        if (maxItems) {
            let totalItems = 0;
            for (const result of results) {
                totalItems += result.output.length;
                if (totalItems > maxItems) {
                    const excess = totalItems - maxItems;
                    result.output = result.output.slice(0, result.output.length - excess);
                    break;
                }
            }
        }
    
        info("Scraping completed.");
        return {
            hashKey: this.generateHashKey(channels, sort ? sort : null, maxItems ?  maxItems : null),
            results,
            from,
            to,
        };
    }
    
    private filterByTimestamp(output: InstagramActorOutput, from: Date, to: Date): InstagramActorOutput {
        return output.filter((item: InstagramPost | Header | Unexpected) => {
            if ((item as InstagramPost).timestamp) {
                const timestamp = new Date((item as InstagramPost).timestamp);
                return timestamp >= from && timestamp <= to;
            }
            return false;
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
            const {fetch_type, channels, from, to, sort, max_items}: Input = JSON.parse(args)
            if (fetch_type && FetchType.fromString(fetch_type) === FetchType.Instagram) {
                try {
                    return await this.scrape(channels, toDate(from), toDate(to), sort, max_items)
                } catch (error: any) {
                    error("Failed to poll Instagram data", error);
                    throw error;
                }
            } else {
                error("Invalid fetch type", fetch_type);
                throw new Error(`Unsupported fetch type: ${fetch_type}`);
            }
        }
        const key = joinCaheKeyStr("instagram", args);
        return await getFromCacheOrFetch(key, this.cache, fetchFn);
    }


    async collect(): Promise<InstagramActorResult> {
        info("Instagram Actor is started...");

        const channels = this.config.items.instagramActorConfig.targetChannels;

        const sortValue = this.config.items.instagramActorConfig.sort;
        const sort = sortValue ? sortValue : undefined;

        const maxItemsValue = this.config.items.instagramActorConfig.maxItems;
        const maxItems = maxItemsValue ? maxItemsValue : undefined;

        const from = secsBackward(this.config.items.control.timeRangeSecs);
        const to = now();

        const result = this.scrape(channels, from, to, sort, maxItems);

        return result;
    }
}

export default InstagramApifyWrapper;
