import WebSocket from 'ws';
import { TaskArgs, CallRequest, Parser } from './params';
import { info, error, warn, debug } from './logging';
import InstagramApifyWrapper from "./instagram";
import RedditApifyWrapper from "./reddit";
import TwitterActorWrapper from "./twitter";
import Config from "./config";
import { LRUCache, MongoCacheFallbackClient } from './cache';


const REQUEST_SUCCUESS: number = 200;
const REQUEST_FAILED: number = 400;
const NOT_ALLOWED: number = 500;
const REQUEST_TIMEOUT: number = 408;
const REQUEST_CANCELED: number = 499;
const REQUEST_INTERNAL_ERROR: number = 503;
const NOT_FOUND: number = 404;     
const REQUEST_RATE_LIMITED: number = 429;
const CACHE_SIZE: number = 1000;

type Params = {[key: string]: any;} | undefined;
type SeverFunction = (args: Params) => Promise<any> | undefined;

class WebSocketServer<K, V> {
    private config: Config;
    private socket: WebSocket.Server;
    private cache: LRUCache<K, V>;
    private database: MongoCacheFallbackClient;
    private functions: Map<string, SeverFunction> = new Map<string, SeverFunction>();
    private parser: Parser = new Parser();

    constructor (config: Config, cacheCapacity: number, database: MongoCacheFallbackClient) {
        const protocol = config.items.websocket.protocol;
        const host = config.items.websocket.host;
        const port = config.items.websocket.port;
        const address = `${protocol}://${host}:${port}`;

        this.database = database;
        this.cache = new LRUCache(cacheCapacity, this.database);

        this.config = config;
        this.socket = new WebSocket.Server({port: port});
        this.functions.set(
            'instagram_polling', async (args: Params) => {
                const wraper = new InstagramApifyWrapper(this.config, this.cache);
                try {
                    return await wraper.poll(JSON.stringify(args));
                } catch (err: any) {
                    error(`Error while polling Instagram: ${err.message}`);
                    throw error;
                }
            }
        );
        this.functions.set(
            'reddit_polling', async (args: Params) => {
                const wraper = new RedditApifyWrapper(this.config, this.cache);
                try {
                    return await wraper.poll(JSON.stringify(args));
                } catch (err: any) {
                    error(`Error while polling Reddit: ${err.message}`);
                    throw err;
                }
            }
        ); 
        this.functions.set(
            'twitter_polling', async (args: Params) => {
                const wraper = new TwitterActorWrapper(this.config, this.cache);
                try {
                    return await wraper.poll(JSON.stringify(args));
                } catch (err: any) {
                    error(`Error while polling Twitter: ${err.message}`);
                    throw error;
                }

            }
        );
        //this.setupHandlers();
    }
    
    private setupHandlers()  {
        this.socket.on('open', this.handleOpen.bind(this));
        this.socket.on('close', this.handleClose.bind(this));
        this.socket.on('error', this.handleError.bind(this));
        this.socket.on('message', this.handleMessage.bind(this));
    }

    /**
     * Starts the WebSocket server and listens for incoming connections.
     */
    public async run(): Promise<void> {
        const protocol = this.config.items.websocket.protocol;
        const host = this.config.items.websocket.host;
        const port = this.config.items.websocket.port;

        info(`Starting WebSocket server at ${protocol}://${host}:${port}...`);

        this.socket.on('connection', async (ws: WebSocket) => {
            info('New client connected.');

            ws.on('open', async () => {
                await this.handleOpen();
            });
            
            ws.on('message', async (message: string) => {
                await this.handleMessage(ws, message);
            });

            ws.on('close', async () => {
                await this.handleClose();
            });

            ws.on('error', async (err: Error) => {
                await this.handleError(err);
            });
        });

        info(`WebSocket server is running on ${protocol}://${host}:${port}.`);
    }

    async handleOpen() {
        info('WebSocket connection is open.');
    }

    async handleClose() {
        info('WebSocket connection is closed.');
    }

    async handleError(err: Error) {
        error('WebSocket connection error:', err);
    }

    async handleMessage (ws: WebSocket, message: string): Promise<void> {
        try {
            // Process the request and prepare a response
            const resp = await this.respond(message)   
            // Send the JSON response back to the client
            ws.send(resp.toJson());
        } catch (err: any) {
            error('Error responding to client:', error);
            ws.send(WebSocketServer.error(Outcome.Failure, "Request could not be processed.", err).toJson());
        }
            
    }

    async respond(s: string): Promise<ServerResponse>{
        info("Received Request. | Parsing...");
        try {
            const req: CallRequest = this.parser.parseToCallRequest(s);
            debug("Parsed request. | Json: " + JSON.stringify(req, null, 2));
            if (!req) {
                return WebSocketServer.error(
                    Outcome.Failure, 
                    "Invalid JSON object. The JSON you pass to the socket is supposed to meet a specific interface."
                );
            }
            info("Checking permissions...");
            if (req.target !== "task") {
                return WebSocketServer.error(
                    Outcome.NotAllowed, 
                    "You are trying to perfoorm a task this socket does not support" 
                    + req.target
                );
            }
            debug("Checked.")
            if (!req.args.for_task  || req.args.for_task!.function !== "aggregated_polling") {
                return WebSocketServer.error(
                    Outcome.NotAllowed, 
                    "This socket only supports the 'aggregated_polling' function."
                );
            }
            const taskArgs: TaskArgs = req.args.for_task!;
            debug("args: " + JSON.stringify(taskArgs, null, 2));
            const res = await this.handle(taskArgs);
            debug("Server Response: " + res.status);
            return WebSocketServer.success(res);
        } catch (err: any) {
            return WebSocketServer.error(
                Outcome.Failure, 
                "Failed to make a response for the request.", 
                err
            );
        }
    }

    async handle(args: TaskArgs): Promise<ServerResponse> {
        info("Handling request...");
        debug("Extracting function key...")
        const where_ = args.look_for.where_;
        debug("Extracted function key: " + where_);
        if (!where_) {
            return WebSocketServer.error(
                Outcome.Failure, 
                "The 'where_' field is required."
            );
        }
        info("Extracting Args...");
        const params = args.params;
        if (!params) {
            return WebSocketServer.error(
                Outcome.Failure, 
                "The 'params' field is required."
            );
        }
        debug("Params: ", JSON.stringify(params, null, 2));
        try {
            const func = this.mapFunc(where_);
            if (!func) {
                throw new Error(`No function found for ${where_}`);
            }
            const res = await func(params);
            return WebSocketServer.success(res);
        } catch (err: any) {
            return WebSocketServer.error(Outcome.Failure, "Request failed.", err.message);
        } 
    }

    mapFunc(where_: string): SeverFunction {
        return this.functions.get(where_) as SeverFunction
    }

    public static success(message?: any): ServerResponse {
        return new ServerResponse(REQUEST_SUCCUESS, message);
    }

    public static error(outcome: Outcome, message: any, reason?: string|any): ServerResponse {
        let status;
        switch (outcome){
            case Outcome.Failure: status = REQUEST_FAILED; break;
            case Outcome.NotAllowed: status = NOT_ALLOWED; break;
            case Outcome.Timeout: status = REQUEST_TIMEOUT; break;
            case Outcome.Canceled: status = REQUEST_CANCELED; break;
            case Outcome.InternalError: status = REQUEST_INTERNAL_ERROR; break;
            case Outcome.NotFound: status = NOT_FOUND; break;
            case Outcome.RateLimited: status = REQUEST_RATE_LIMITED; break
            default: status = REQUEST_FAILED; break;
        }

        return new ServerResponse(status, message, reason);
    }
}

enum Outcome {
    Failure,
    NotAllowed,
    Timeout,
    Canceled,
    InternalError,
    NotFound,
    RateLimited,
}

class ServerResponse {
    public status: number;
    public message?: any;
    public reason?: string; 

    constructor(status: number, message?: any, reason?: string) {
        this.status = status;
        this.message = message;
        this.reason = reason;
    }

    toJson(): String {
        return JSON.stringify(this, null, 2);
    }
}

export default WebSocketServer;
