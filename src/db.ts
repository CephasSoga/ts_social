import { MongoClient, Collection, Document, Db, UpdateResult } from "mongodb";
import  Config  from "./config";
import { info, debug, error, warn}  from "./logging";
import { Error } from "mongoose";

/** Define custom error types. */
enum OpError {
    FailedConnection = "FailedConnection",
    InvalidQuery = "InvalidQuery",
    InsertionError = "InsertionError",
    UpdateError = "UpdateError",
    DeletionError = "DeletionError",
    SearchError = "SearchError",
    ConversionError = "ConversionError",
}

class MongoDbError extends Error {
    constructor(public type: OpError, public message: string) {
        super(message);
        this.name = "MongoDbError";
    }
}

/** Manages MongoDB Client */
class ClientManager {
    public client: MongoClient;

    constructor(client: MongoClient) {
        this.client = client;
    }

    /** Creates a new MongoDB client from an environment variable or default URI. */
    static async new(config: Config): Promise<ClientManager> {
        const uri = config.items.database.uri;

        try {
            const client = new MongoClient(uri);

            /** Attempt to connect to MongoDB. */
            await client.connect();
            info("Connected successfully to MongoDB cluster!");

            return new ClientManager(client);
        } catch (e: any) {
            throw new MongoDbError(OpError.FailedConnection, e.message);
        }
    }

    /** Returns a reference to the MongoDB client. */
    getClient(): MongoClient {
        return this.client;
    }
}

/** Handles Database Operations. */
class DatabaseOps {
    private collection: Collection<Document>;

    constructor(client: MongoClient, database: string, collection: string) {
        const db: Db = client.db(database);
        this.collection = db.collection(collection);
    }

    /** Inserts a single document into the collection. */
    async insertOne(doc: Document): Promise<void> {
        try {
            info(`Successfully <inserted> 1 doc into ${this.collection}`);
            await this.collection.insertOne(doc);
        } catch (e: any) {
            error(`Failed to <insert> 1 doc into ${this.collection}` + " | Error: ", e);
            throw new MongoDbError(OpError.InsertionError, `Failed to insert document: ${e.message}`);
        }
    }

    /** Inserts multiple documents into the collection. */
    async insertMany(docs: Document[]): Promise<void> {
        try {
            info(`Successfully <inserted> ${docs.length} doc(s) into ${this.collection}`);
            await this.collection.insertMany(docs);
        } catch (e: any) {
            error(`Failed to <insert> ${docs.length} doc into ${this.collection}` + " | Error: ", e);
            throw new MongoDbError(OpError.InsertionError, `Failed to <insert> documents: ${e.message}`);
        }
    }

    /** Updates multiple documents based on a filter. */
    async updateMany(filter: Document, update: Document): Promise<void> {
        try {
            const updateDoc = { $set: update };
            const result: UpdateResult = await this.collection.updateMany(filter, updateDoc);
            if (result.matchedCount === 0) {
                warn(`No result matched <update> filter inside ${this.collection}`);
                throw new MongoDbError(OpError.UpdateError, "No documents matched the filter.");
            }
            info(`Successfully <updated> ${result.modifiedCount} doc(s) inside ${this.collection}`);
        } catch (e: any) {
            error(`Failed to <update> docs inside ${this.collection}` + " | Error: ", e);
            throw new MongoDbError(OpError.UpdateError, `Failed to update documents: ${e.message}`);
        }
    }

    /** Deletes multiple documents based on a filter. */
    async deleteMany(filter: Document): Promise<void> {
        try {
            const result = await this.collection.deleteMany(filter);
            if (result.deletedCount === 0) {
                warn(`No result matched <delete> filter inside ${this.collection}`);
                throw new MongoDbError(OpError.DeletionError, "No documents were deleted.");
            }
            info(`Successfully <deleted> ${result.deletedCount} doc(s) inside ${this.collection}`);
        } catch (e: any) {
            error(`Failed to <delete> docs inside ${this.collection}` + " | Error: ", e);
            throw new MongoDbError(OpError.DeletionError, `Failed to delete documents: ${e.message}`);
        }
    }

    /** Searches for documents matching a filter. */
    async search(filter: Document): Promise<Document[]> {
        try {
            const cursor = await this.collection.find(filter);
            const results: Document[] = await cursor.toArray();
            info(`Found ${results.length} matching <search> filter inside ${this.collection}`);
        return results;
        } catch (e: any) {
            error(`Failed to <search> docs inside ${this.collection}` + " | Error: ", e);
            throw new MongoDbError(OpError.SearchError, `Failed to search documents: ${e.message}`);
        }
    }

    /** Converts a Value (JSON-like) to a Document. */
    convertToDocument(value: any): Document {
        try {
            return JSON.parse(JSON.stringify(value)); // Simplified, more logic may be required for deeper conversion
        } catch (e: any) {
            throw new MongoDbError(OpError.ConversionError, `Failed to convert to document: ${e.message}`);
        }
    }
}

export { ClientManager, DatabaseOps, OpError, MongoDbError };
