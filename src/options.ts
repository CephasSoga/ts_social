

export enum FetchType {
    Instagram,
    Reddit,
    Twitter,
}
export namespace FetchType {
    export function fromString(str: string): FetchType {
        switch (str.toLowerCase()) {
            case 'instagram':
                return FetchType.Instagram;
            case'reddit':
                return FetchType.Reddit;
            case 'twitter':
                return FetchType.Twitter;
            default:
                throw new Error(`Invalid fetch type: ${str}`);
        }
    }
}