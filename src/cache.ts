import { MongoClient, Collection } from "mongodb";
import  Config from "./config";

type Document = Record<string, unknown>; // Define a generic document type
type State = 0 | 1 | 2;

class LRUCache<K, V> {
    private capacity: number;
    private cache: Map<K, V>;
    private fallbackClient: MongoCacheFallbackClient;

    constructor(capacity: number, fallbackClient: MongoCacheFallbackClient) {
        if (capacity <= 0) {
            throw new Error("Capacity must be greater than 0");
        }
        this.capacity = capacity;
        this.cache = new Map<K, V>();
        this.fallbackClient = fallbackClient;
    }

    // Get a value from the cache
    async get(key: K): Promise<V | undefined> {
        if (this.cache.has(key)) {
            const value = this.cache.get(key)!;
            // Move the accessed item to the end of the Map (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }

        // If not in cache, try MongoDB
        const fallbackValue = await this.fallbackClient.get(key as unknown as string);
        if (fallbackValue) {
            const value = fallbackValue.value as V;
            this.put(key, value); // Bring it back to the in-memory cache
            return value;
        }

        return undefined;
    }

    // Add a value to the cache
    async put(key: K, value: V): Promise<void> {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            // Remove the least recently used item
            const lruKey = this.cache.keys().next().value!;
            const lruValue = this.cache.get(lruKey)!;

            try {
                // Save evicted value to MongoDB
                await this.fallbackClient.put(lruKey as unknown as string, { value: lruValue });
            } catch (err) {
                console.error("Failed to save to MongoDB:", err);
            }

            this.cache.delete(lruKey);
        }

        // Add the new key-value pair
        this.cache.set(key, value);
    }

    // Check if a key exists
    has(key: K): boolean {
        return this.cache.has(key);
    }

    // Clear the cache
    clear(): void {
        this.cache.clear();
    }

    // Get the size of the cache
    size(): number {
        return this.cache.size;
    }
}

class MongoCacheFallbackClient {
    public state: State;
    private client: MongoClient;
    private collection: Collection;

    constructor(config: Config) {
        this.state = 0;
        this.client = new MongoClient(config.items.database.uri);
        this.collection = this.client
            .db(config.items.database.database_name)
            .collection(config.items.database.collection_name);
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
            this.state = 1;
            console.log("MongoCacheFallbackClient connected.");
        } catch (err) {
            this.state = 0;
            console.error("Failed to connect to MongoDB:", err);
        }
    }

    async get(key: string): Promise<Document | null> {
        if (this.state !== 1) {
            console.warn("MongoCacheFallbackClient is not connected.");
            return null;
        }

        try {
            return await this.collection.findOne({ key });
        } catch (err) {
            console.error("MongoDB get operation failed:", err);
            return null;
        }
    }

    async put(key: string, value: Document): Promise<void> {
        if (this.state !== 1) {
            console.warn("MongoCacheFallbackClient is not connected.");
            return;
        }

        try {
            await this.collection.updateOne(
                { key },
                { $set: value },
                { upsert: true }
            );
        } catch (err) {
            console.error("MongoDB put operation failed:", err);
        }
    }
}

export { LRUCache, MongoCacheFallbackClient };
