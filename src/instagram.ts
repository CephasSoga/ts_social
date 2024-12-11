import {z, ZodError } from "zod";
import { ApifyClient, ActorRun } from 'apify-client';
import Config from './config';
import log from './logging';

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

class InstagramApifyWrapper {
    private client: ApifyClient;
    private config: Config;

    constructor(config: Config) {
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.config = config
    }

    async scrapeInstagramChannel(
        channel: string,
        resultsLimit: number|null = null,
        searchLimit: number|null = null,

    ): Promise<InstagramActorOutput> {
        // Prepare Actor input
        resultsLimit = resultsLimit || this.config.items.instagramActorConfig.resultsLimit;
        if (!resultsLimit) {
            throw new InstagramScrapingError(
                "No `resultsLimit` argument was provided." + 
                "You can set it either in `config.toml` or pass it as an argument to the `scrapeInstagram` method",
                channel,
                {
                    resultsLimit: resultsLimit? resultsLimit: null,
                    searchLimit: searchLimit? searchLimit: null,
                }
            );
        }

        searchLimit = searchLimit || this.config.items.instagramActorConfig.searchLimit;
        if (!searchLimit) {
            throw new InstagramScrapingError(
                "No `searchLimit` argument was provided." + 
                "You can set it either in `config.toml` or pass it as an argument to the `scrapeInstagram` method",
                channel,
                {
                    resultsLimit: resultsLimit? resultsLimit: null,
                    searchLimit: searchLimit? searchLimit: null,
                }
            );
        }

        // Prepare Actor input
        const input = {
            "directUrls": [
                `${this.config.items.instagramActorConfig.baseUrl}/${channel}/`
            ],
            "resultsType": this.config.items.instagramActorConfig.resultsType,
            "resultsLimit": resultsLimit,
            "searchType": this.config.items.instagramActorConfig.searchType,
            "searchLimit": searchLimit,
            "addParentData": this.config.items.instagramActorConfig.addParentData
        };

        try {
            // Run the Actor and wait for it to finish
            const run: ActorRun = await this.client.actor(this.config.items.apifyConfig.instagramActorId).call(input);
        
            // Fetch and print Actor results from the run's dataset (if any)
            console.log('Results from dataset');
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            
            // Log and parse each item
            const parsedItems: InstagramActorOutput = [];
            for (const item of items) {
                console.dir(item);
                const parsedItem = await this.parseItem(item); // Use parseItem to handle the item
                parsedItems.push(parsedItem);
            }
        
            // Check if parsedItems contains valid results or fallback to Unexpected
            if (parsedItems.length === 0) {
                log(
                    "warn",
                    "No valid data found in the dataset. Fallback structure will be used...",
                    new DataFormatError(
                        "Unexpected dataset structure.",
                        { expectedType: "Array<InstagramPost | Header>" },
                        { receivedType: typeof items },
                        { invalidFields: Object.keys(items) },
                        "Parsing items failed to match expected schema.",
                        { issues: null }
                    )
                );
                return items as Unexpected[]; // Return the raw data as a fallback
            }
        
            // Return the successfully parsed data
            return parsedItems;
        } catch (error) {
            const actorError = new InstagramScrapingError(
                `Actor failed to scrape channel <${channel}>`,
                channel,
                { params: this.config.getItems() }
            );
        
            log("error", "Scraping failed!", actorError);
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
}

export default InstagramApifyWrapper;