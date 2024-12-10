import {z, ZodError } from "zod";
import { ApifyClient, ActorRun } from 'apify-client';
import Config from './config';
import log from './logging';

/**
 * RedditScrapingError class.
 * Custom error class for handling scraping-related errors.
 */
class RedditScrapingError extends Error {
    /**
     * RedditScrapingError class.
     * Custom error class for handling scraping-related errors.
     */
    public subreddit?;
    public params?;
    constructor(message: string, subreddit?: string, params?: any) {
        super(message);
        this.name = 'RedditScrapingError';
        this.message = message;
        this.subreddit = subreddit;
        this.params = params;
    }
}

/**
 * DataFormatError class.
 * Custom error class for handling data format validation errors.
 */
class DataFormatError extends Error {
    public invalidFields?: Record<string, any>; // Details of fields that failed validation
    public context?: string; // Context or location of the error (e.g., method name)
    public rawData?: any; // The raw data that caused the error
    public expected: any;
    public received: any;

    /**
     * Creates an instance of DataFormatError.
     * @param message - The error message.
     * @param invalidFields - Optional details about fields that failed validation.
     * @param context - Optional context information (e.g., method name or module).
     * @param rawData - Optional raw data that caused the validation error.
     */
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


/**
 * Community - if the returned data type is `community`
 * Post - if the returned datatype is `post`
 * Comment - if the returned type is `comment`
 * Null - if its null or undefined
*/
enum DataType {
    Community = "community",
    Post = "post",
    Comment = "comment",
    Null = "null",
}

/**
 * Rule interface.
 * This interface defines the structure of a rule associated with a community.
 * It includes properties such as priority, type, description, short name,
 * violation reason, HTML representation of the description, and the creation date.
 */
const RuleSchema = z.object({
    priority: z.number().nonnegative().default(0),
    kind: z.string().min(1).default("Unknown"),
    description: z.string().min(1).default("No description provided."),
    shortName: z.string().min(1).default("Unknown"),
    violationReason: z.string().min(1).default("No violation reason."),
    descriptionHtml: z.string().optional(),
    createdAt: z.string().optional().default(() => new Date().toISOString()),
});

/** Builds upon `RuleSchema`. */
type Rule = z.infer<typeof RuleSchema>;


/** CommunityData Schema.
 * This schema defines the structure of community data scraped from Reddit.
 * It includes properties such as community ID, name, display name, title, header image,
 * description, whether the community is over 18, creation date, date of scraping,
 * number of members, URL, data type, and an array of rules.
 */
const CommunityDataSchema = z.object({
    id: z.string(),
    name: z.string().min(1).default(DataType.Null),
    displayName: z.string().min(1).default(DataType.Null),
    title: z.string().default("Undefinede"),
    headerImage: z.string().optional().default(DataType.Null),
    description: z.string().optional().default(DataType.Null),
    over18: z.boolean().default(false),
    createdAt: z.string(),
    scrapedAt: z.string(),
    numberOfMembers: z.number().nonnegative().default(0),
    url: z.string().url().optional().default(""),
    dataType: z.literal(DataType.Community),
    rules: z.array(RuleSchema).default([]),
});
/** Builds upon `CommunityDataSchema`. */
type CommunityData = z.infer<typeof CommunityDataSchema>;


/**
 * PostData Schema.
 * This schema defines the structure of post data scraped from Reddit.
 * It includes properties such as post ID, parsed ID, URL, username, user ID,
 * title, community name, body content, number of comments, upvotes, and more.
 */
const PostSchema = z.object({
    id: z.string(),
    parsedId: z.string(),
    url: z.string().url(),
    username: z.string().min(1).default(DataType.Null),
    userId: z.string(),
    title: z.string(),
    communityName: z.string().min(1).default(DataType.Null),
    parsedCommunityName: z.string().min(1).default(DataType.Null),
    body: z.string(),
    html: z.string(),
    link: z.string().optional(),
    numberOfComments: z.number().nonnegative(),
    flair: z.string().nullable(),
    upVotes: z.number().nonnegative(),
    upVoteRatio: z.number().min(0).max(1),
    isVideo: z.boolean(),
    isAd: z.boolean(),
    over18: z.boolean(),
    thumbnailUrl: z.string().url(),
    createdAt: z.string(),
    scrapedAt: z.string(),
    dataType: z.literal(DataType.Post),
});
/** Builds upon `PostSchema`.*/
type Post = z.infer<typeof PostDataSchema>;

/**
 * Comment Schema.
 * This schema defines the structure of comment data scraped from Reddit.
 * It includes properties such as comment ID, parsed ID, URL, post ID, parent ID,
 * username, user ID, body content, number of replies, and more.
 */
const CommentSchema = z.object({
    id: z.string(),
    parsedId: z.string(),
    url: z.string(),
    postId: z.string(),
    parentId: z.string(),
    username: z.string(),
    userId: z.string(),
    category: z.string(),
    communityName: z.string(),
    body: z.string(),
    createdAt: z.string(),
    scrapedAt: z.string(),
    upVotes: z.number().nonnegative(),
    numberOfreplies: z.number().nonnegative(),
    html: z.string(),
    dataType: z.literal(DataType.Comment),
});
/** Builds upon the `CommentSchema`.*/
type Comment = z.infer<typeof CommentSchema>;
  
type PostData = Post | Comment;
type Unexpected = Record<string, any>
// PostData Schema (Union Type)
const PostDataSchema = z.union([PostSchema, CommentSchema]);

/**
 * RedditActorOutput interface.
 * Defines the output structure of the scrapeSubreddit method.
 */
interface RedditActorOutput {
    communityData: CommunityData | Unexpected;
    postData: PostData[] | Unexpected;
}

/**
 * RedditApifyWrapper class.
 * This class facilitates scraping data from Reddit using the Apify platform.
 * It provides methods to scrape subreddit data, including community information and posts,
 * while ensuring data validation and error handling.
 */
class RedditApifyWrapper {
    private client: ApifyClient;
    private config: Config;

    /**
     * Creates an instance of RedditApifyWrapper.
     * @param config - Configuration settings for the Apify client, including API tokens and proxy settings.
     */
    constructor(config: Config){
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.config = config;
    }

    /**
     * Scrapes data from a specified subreddit.
     * @param subreddit - The name of the subreddit to scrape (e.g., "news").
     * @param sort - Optional sorting method (e.g., "hot", "new"). Defaults to the configured sort method.
     * @param maxItems - Optional limit on the maximum number of items to scrape. Defaults to the configured maximum.
     * @returns A promise that resolves to an object containing community data and post data.
     * @throws RedditScrapingError if the scraping process fails.
     */
    async scrapeSubreddit(
        subreddit: string,
        sort: string | null = null,
        maxItems: number | null = null
    ): Promise<RedditActorOutput> {

        sort = sort || this.config.items.redditActorConfig.sort;
        if (!sort) {
            throw new RedditScrapingError(
                "No `sort` argument was provided." + 
                "You can set it either in `config.toml` or pass it as an argument to the `scrapeSubreddit` method",
                subreddit,
                {sort: sort? sort: null, maxItems: maxItems? maxItems: null, config:this.config.getItems()}
            );
            
        }

        maxItems = maxItems || this.config.items.redditActorConfig.maxItems;
    
        log("info", "Building inputs...");
        const input = {
            startUrls: [{ url: `https://www.reddit.com/r/${subreddit}/` }],
            sort,
            maxItems,
            proxy: {
                useApifyProxy: this.config.items.proxyConfig.useApifyProxy,
                apifyProxyGroups: this.config.items.proxyConfig.apifyProxyGroups,
            },
        };
    
        try {
            const run: ActorRun = await this.client.actor("trudax/reddit-scraper-lite").call(input);
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
    
            if (!Array.isArray(items) || items.length === 0) {
                throw new DataFormatError(
                    "Unexpected format: No items returned from scraping.",
                    "exepected <Array>",
                    `received <${typeof items}>`,
                    { items }, // Include the returned items for debugging
                    "scrapeSubreddit", // Context for where the error occurred
                    input // Optionally include the input parameters that were sent
                );
            }
    
            // Validate and parse the first item as CommunityData
            const communityDataResult = CommunityDataSchema.safeParse(items[0]);
            const communityData = communityDataResult.success
                ? communityDataResult.data
                : (log(
                      "warn",
                      "Community data validation failed. Falling back to raw data.",
                      { issues: communityDataResult.error.errors }
                  ),
                  items[0] as Unexpected); // Fallback to raw data.
    
                  log("info", "Parsing outputs...");
            // Validate and parse the rest as PostData[]
            const postData = await Promise.all(
                items.slice(1).map(async (item) => {
                    try{
                        const result = PostDataSchema.safeParse(item);
                        if (result.success) {
                            return result.data;
                        } else {
                            log("warn", "Post data validation failed.", {
                                issues: result.error.errors,
                                item,
                            });
                            return item; // Fallback to raw data
                        }
                    } catch (error: any) {
                        return null;
                    }
                })
            );
            return { communityData, postData };
        } catch (error) {
            log("error", "Failed to scrape subreddit.", error);
            throw new RedditScrapingError(
                "Reddit scraping failed",
                subreddit,
                {sort: sort? sort: null, maxItems: maxItems? maxItems: null, config: this.config.getItems()}
            );
        }
    }
}

export default RedditApifyWrapper;