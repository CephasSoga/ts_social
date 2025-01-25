
import { info, debug } from "./logging";

/** 0: Pending; 1: Finished; 2: Failed; */
type Status =  0 | 1 | 2;

type Mode = "async" | "sync" | "batch" | "stream" | "none" | "unknown";


interface Caller {
    id: string;
    ipaddr: string; // Use string for IP address
    queue: number;
    status: Status;
    mode: Mode;
}

type TaskFunction  =  'aggregated_polling' |
    'real_time_market_data' |
    'real_time_blue_sky' |
    'real_time_social_media' |
    'web_search' |
    'chat_gpt' |
    'nlp' |
    'unknown';



interface LookFor {
    where_: string;
}

type TaskCount = 'single' | 'multiple' | 'batch' | 'stream' | 'none' | 'unknown';

export interface TaskArgs {
    function: TaskFunction;
    count: TaskCount;
    look_for: LookFor;
    params?: { [key: string]: any };
}

type DatabaseFunction = 'read' | 'insert' | 'update' | 'replace' | 'delete';

type ObjectCount = 'one' | 'many';

export interface DatabaseArgs {
    function: DatabaseFunction;
    count: ObjectCount;
    uri: string;
    user?: string;
    pwd?: string;
    document?: Record<string, any>;
}

type TargetService = 'database' | 'task' | 'unknown';

export interface Args {
    for_database?: DatabaseArgs;
    for_task?: TaskArgs;
}

export interface CallRequest {
    caller: Caller;
    target: TargetService;
    args: Args;
}


export class Parser {
    constructor(){}

    toJson() {}

    parseToCallRequest(s: string): CallRequest {
        let someArgs = JSON.parse(s);

        const caller: Caller = someArgs.caller;
        let for_task = undefined;
        let for_database = undefined;

        if (someArgs.target === "task") {
            const taskArgs: TaskArgs = someArgs.args;
            for_task = taskArgs;
        } else if (someArgs.target === "database") {
            const databaseArgs: DatabaseArgs = someArgs.args;
            for_database = databaseArgs;
        } else {
            throw new Error("Invalid target: " + someArgs.target);
        }
        const req = {
            caller,
            target: someArgs.target,
            args: {
                for_database,
                for_task
            }
        };
        debug("Call Request received. | Display: ", JSON.stringify(req, null, 2)); 
        return req;
    }

}
