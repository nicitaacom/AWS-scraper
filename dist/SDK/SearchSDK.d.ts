import { Lead } from "../interfaces/interfaces";
/**
 * SearchAPI.io SDK
 * FREE: 100 requests/month
 * Best for: Google Search results, Google Maps, Google Shopping
 * Provides: Rich search results with business info
 */
export declare class SearchSDK {
    private baseUrl;
    private apiKey;
    constructor(apiKey: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    getUsage(): Promise<any>;
    private performGoogleSearch;
    private performGoogleMapsSearch;
    private processAllResults;
    private processMapResult;
    private processSearchResult;
    private extractEmailFromResult;
    private cleanPhone;
    private extractCompanyName;
    private extractAddress;
}
//# sourceMappingURL=SearchSDK.d.ts.map