import {z, ZodError } from "zod";
import { ApifyClient, ActorRun } from 'apify-client';
import Config from './config';
import { info, debug, error, warn } from './logging';
import { getFromCacheOrFetch, joinCaheKeyStr, now, secsBackward } from "./utils";
import { FetchType } from "./options";
import { LRUCache } from "./cache";

class RedditScrapingError extends Error {
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

class DataFormatError extends Error {
    public invalidFields?: Record<string, any>; // Details of fields that failed validation
    public context?: string; // Context or location of the error (e.g., method name)
    public rawData?: any; // The raw data that caused the error
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


enum DataType {
    Community = "community",
    Post = "post",
    Comment = "comment",
    Null = "null",
}

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


interface RedditActorOutput {
    communityData: CommunityData | Unexpected;
    postData: PostData[] | Unexpected;
}

interface RedditActorResultForSubreddit {
    subreddit: string,
    output: RedditActorOutput | null,
}

interface RedditActorResult {
    hashKey: string,
    results: Array<RedditActorResultForSubreddit> | null,
    from: Date,
    to: Date,
}

interface Input {
    fetch_type: string,
    subreddits: Array<string>,
    maxComments?: number,
    maxCommunitiesCount?: number,
    maxItems?: number,
    sort?: string, 
    from: string,
    to: string,
}

class RedditApifyWrapper<K, V>{
    private client: ApifyClient;
    private cache: LRUCache<K, V>;
    private config: Config;
    private configurations;


    constructor(config: Config, cache: LRUCache<K, V>){
        this.client = new ApifyClient({
            token: config.items.apifyConfig.token
        });
        this.cache = cache;
        this.config = config
        this.configurations = this.config.items.redditActorConfig;
    }

    async scrapeSubreddit(
        subreddit: string,
        maxComments?: number,
        maxCommunitiesCount?: number,
        maxItems?: number,
        sort?: string,
    ): Promise<RedditActorOutput> {
    
        // Build Actor inputs
        info(`Building Actor inputs for subreddit=${subreddit}...`);
        const input = this.buildActorInput(subreddit, maxComments, maxCommunitiesCount, maxItems, sort);
    
       info("Requesting data. | Url: " + input.startUrls[0].url);
        try {
            const actorID = this.config.items.apifyConfig.redditActorId;
            // Run Actor and wait for result.
            info("Running Reddit Actor. | ID: " + actorID);
            const run: ActorRun = await this.client.actor(actorID).call(input);
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            // Alert for data.
            info("Some data was fetched. | Collecting...");

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
    
            info("Parsing outputs...");
            // Validate and parse the first item as CommunityData
            return await this.parseItems(items)
            
        } catch (err: any) {
            error("Failed to scrape subreddit.", err);
            throw new RedditScrapingError(
                "Reddit scraping failed",
                subreddit,
                {config: this.config.getItems()}
            );
        }
    }

    buildActorInput(
        subreddit: string,
        maxComments?: number,
        maxCommunitiesCount?: number,
        maxItems?: number,
        sort?: string,
    )
    {   
        const configurations = this.configurations;

        maxComments = maxComments? maxComments : configurations.maxComments;
        maxCommunitiesCount = maxCommunitiesCount? maxCommunitiesCount : configurations.maxCommunitiesCount;
        maxItems = maxItems? maxItems : configurations.maxItems;
        sort = sort? sort : configurations.sort

        const input = {
            "debugMode": false,
            "includeNSFW": configurations.includeNSFW,
            "maxComments": maxComments,
            "maxCommunitiesCount": maxCommunitiesCount,
            "maxItems": maxItems,
            "maxPostCount": configurations.maxPostCount,
            "maxUserCount": configurations.maxUserCount,
            "proxy": {
                "useApifyProxy": this.config.items.proxyConfig.useApifyProxy,
                "apifyProxyGroups": this.config.items.proxyConfig.apifyProxyGroups
            },
            "scrollTimeout": configurations.scrollTimeout,
            "searchComments": configurations.searchComments,
            "searchCommunities": configurations.searchCommunities,
            "searchPosts": configurations.searchPosts,
            "searchUsers": configurations.searchUsers,
            "skipComments": configurations.skipComments,
            "skipCommunity": configurations.skipCommunity,
            "skipUserPosts": configurations.skipUserPosts,
            "sort": sort,
            "startUrls": [
                {
                    "url": `https://www.reddit.com/r/${subreddit}/`,
                    "method": "GET"
                }
            ]
        }

        return input;
    }

    async parseItems(items: any): Promise<RedditActorOutput> {
        const communityDataResult = CommunityDataSchema.safeParse(items[0]);
        const communityData = communityDataResult.success
            ? communityDataResult.data
            : (warn(
                    "Community data validation failed. Falling back to raw data.",
                    JSON.stringify({ issues: communityDataResult.error.errors })
                ),
                items[0] as Unexpected); // Fallback to raw data.

        // Validate and parse the rest as PostData[]
        const postData = await Promise.all(
            items.slice(1).map(async (item: any) => {
                try{
                    const result = PostDataSchema.safeParse(item);
                    if (result.success) {
                        return result.data;
                    } else {
                        warn("Post data validation failed.", JSON.stringify({
                            issues: result.error.errors,
                            item,
                        }));
                        return item; // Fallback to raw data
                    }
                } catch (err: any) {
                    warn(`Error parsing items. |Error: ${err}| Returning <null>...`)
                    return null;
                }
            })
        );
        return { communityData, postData };
    }

    async scrape(
        subreddits: Array<string>,
        maxComments?: number,
        maxCommunitiesCount?: number,
        maxItems?: number,
        sort?: string, 
        from?: string,
        to?: string,
    ): Promise<RedditActorResult> {
        info("Starting scrape for multiple subreddits...");
        const results: RedditActorResultForSubreddit[] = [];
        const from_ = from? new Date(from) : now();
        const to_ = to? new Date(to) : secsBackward(this.config.items.control.timeRangeSecs);
    
        // Iterate through the subreddits array and scrape each one
        for (const subreddit of subreddits) {
            try {
                info(`Scraping subreddit: ${subreddit}`);
                const data = await this.scrapeSubreddit(
                    subreddit,
                    maxComments,
                    maxCommunitiesCount,
                    maxItems,
                    sort, 
                );

                // Filter post data by timestamp
                const filteredData = this.filterByTimestamp(data, from_, to_);

                results.push({subreddit: subreddit, output: filteredData});


                info(`Successfully scraped subreddit: ${subreddit}`);
            } catch (err: any) {
                error(`Failed to scrape subreddit: ${subreddit}`, err);
                results.push({subreddit: subreddit, output: null})
            }
        }    

        info("Finished scraping all subreddits.");
        return {
            hashKey: this.generateHashKey(subreddits, sort, maxItems),
            results: results,
            from: from_,
            to: to_,
        };
    }


    private generateHashKey(subreddits: Array<string>, sort?: string | null, maxItems?: number | null): string {
        const baseString = JSON.stringify({ subreddits, sort, maxItems });
        return require('crypto').createHash('md5').update(baseString).digest('hex');
    }

    private filterByTimestamp_(
        data: Array<PostData | Unexpected>,
        from: Date,
        to: Date
    ): Array<PostData> {
        return data.filter(item => {
            if ('createdAt' in item || 'scrapedAt' in item) {
                const createdAt = item.createdAt ? new Date(item.createdAt) : null;
                const scrapedAt = item.scrapedAt ? new Date(item.scrapedAt) : null;
    
                return (
                    (createdAt && createdAt >= from && createdAt <= to) ||
                    (scrapedAt && scrapedAt >= from && scrapedAt <= to)
                );
            }
            return false; // Exclude unexpected objects
        }) as Array<PostData>;
    }
    
    private filterByTimestamp(
        output: RedditActorOutput,
        from: Date,
        to: Date
    ): RedditActorOutput {
        // Filter communityData if it's not an Unexpected type
        const communityData = 'createdAt' in output.communityData || 'scrapedAt' in output.communityData
            ? this.filterByTimestamp_([output.communityData], from, to)[0] || output.communityData
            : output.communityData;
    
        // Filter postData if it's an array of PostData
        const postData = Array.isArray(output.postData)
            ? this.filterByTimestamp_(output.postData, from, to)
            : output.postData;
    
        return { communityData, postData };
    }

    async poll( args: string): Promise<RedditActorResult> {
        const key = joinCaheKeyStr("reddit", args);
        const fetchFn = async (): Promise<RedditActorResult> => {
            const { 
                fetch_type, 
                subreddits,
                maxComments,
                maxCommunitiesCount,
                maxItems,
                sort, 
                from, 
                to }: Input = JSON.parse(args);
            if (!subreddits) {
                error("`subreddits` fields is required.");
                throw new RedditScrapingError("Missing field in parameters: `subreddit`");
            }
            if (fetch_type && FetchType.fromString(fetch_type) === FetchType.Reddit) {
                try {
                    return await this.scrape(subreddits,
                        maxComments,
                        maxCommunitiesCount,
                        maxItems,
                        sort, from, to
                    )
                } catch (err: any) {
                    error("Failed to poll for new data.", err);
                    throw err;
                }
            }
            else {
                error(`Unsupported fetch type: ${fetch_type}`)
                throw new Error(`Unsupported fetch type: ${fetch_type}`);
            }
        }

        const res = getFromCacheOrFetch(key, this.cache, fetchFn);
        return res;
    }
}
export default RedditApifyWrapper;


/**TODO: Scrape for all subreddits */