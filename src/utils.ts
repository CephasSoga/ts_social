import { LRUCache } from "./cache";
import { info, warn } from "./logging";

export function now() : Date {
    return new Date()
}


export function secsBackward(n: number): Date {
    const time = new Date();
    time.setSeconds(time.getSeconds() - n);
    return time;
}

export function generateRandomString(n: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < n; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      result += charset[randomIndex];
    }
    return result;
};


export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function toDate(s: string|undefined): Date {
    if (!s) return new Date();
    return new Date(s);
}


export function toJsonStr(obj: any): string {
    return JSON.stringify(obj, null, 2);
}

export async function getFromCacheOrFetch<K, V>(key: string, cache: LRUCache<K, V>, fetchFn: (...args: any[]) => Promise<any>) {
    // Try to get from cache first
    info("Looking in cache for data. | Key: " + key);
    const cachedValue = await cache.get(key as unknown as K);
    if (cachedValue !== undefined) {
        info("Found data in cache. | Returning it...")
        return cachedValue;
    }

    // If not in cache, fetch it
    info("Not Found in cache. | Fetching with Actor...")
    const fetchedValue = await fetchFn();
    
    // Store in cache and return
    await cache.put(key as unknown as K, fetchedValue);
    return fetchedValue;
}

export function joinCaheKeyStr(...args: string[]): string {
    return args.join("+");
}