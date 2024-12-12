// src/config.ts

import fs from 'fs';
import TOML from 'toml';
import { string } from 'zod';

/** Interface defining the structure of the configuration items.*/
interface ConfigItems {
  logging: {
    level: string,
    dir: string,
    redditActorLogFile: string,
    instagramActorLogFile: string
    twitterActorLogFile: string  
  },
  apifyConfig: {
    token: string,
    redditActorId: string,
    instagramActorId: string,
    twitterActorId: string,
  };

  proxyConfig: {
    useApifyProxy: boolean,
    apifyProxyGroups: string[],
  };
  redditActorConfig: {
    startUrls: string[];
    skipComments: boolean;
    skipUserPosts: boolean;
    skipCommunity: boolean;
    searchPosts: boolean;
    searchComments: boolean;
    searchCommunities: boolean;
    searchUsers: boolean;
    sort: string;
    includeNSFW: boolean;
    maxItems: number;
    maxPostCount: number;
    maxComments: number;
    maxCommunitiesCount: number;
    maxUserCount: number;
    scrollTimeout: number;
  };
  instagramActorConfig: {
    baseUrl: string[],
    targetChannels: string[],
    resultsType: string,
    resultsLimit: number,
    searchType: string,
    searchLimit: number,
    addParentData: boolean,
  };
  twitterActorConfig: {
    baseUrl: string,
    targetChannels: string[],
    searchTerms: string[],
    twitterHandles: string[]
    conversationIds: string[],
    maxItems: number,
    sort: string,
    tweetLanguage: string,
    author: string,
    inReplyTo: string,
    mentioning: string,
    geotaggedNear: string,
    withinRadius: string
    geocode: string
    placeObjectId: string
    minimumRetweets: number
    minimumFavorites: number
    minimumReplies: number
    start: string
    end: string
    customMapFunction: string
  }
}

/**Class responsible for loading and managing the configuration.*/
class Config {
  public items: ConfigItems; // Private property to hold the configuration items

  // Constructor that takes the file path of the configuration file
  constructor(filePath: string) {
    try {
      const configFile = fs.readFileSync(filePath, 'utf-8'); // Reading the config file
      this.items = TOML.parse(configFile) as ConfigItems; // Parsing the TOML file into ConfigItems
    } catch (error: any) {
      throw new Error(`Failed to load or parse config file: ${error.message}`); // Error handling
    }
  }

  // Getter for the config
  getItems(): ConfigItems {
    return this.items; // Returns the configuration items
  }
}

export default Config; // Exporting the Config class as the default export