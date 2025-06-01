import { Lead } from "../interfaces/interfaces";
/**
 * Google Custom Search API SDK
 * FREE: 100 searches/day (3k/month)
 * Best for: Finding business websites and contact info
 * Enhanced: Returns error strings instead of throwing errors
 * Rate limited: 1 second between requests for free tier
 *
 * @param query - Business type (e.g. "nail salon")
 * @param location - City or region (e.g. "Miami")
 * @returns Promise<Lead[] | string> - Leads array or error string
 */
export declare class GoogleCustomSearchSDK {
    private apiKey;
    private searchEngineId;
    private baseUrl;
    private readonly rateLimitDelay;
    private lastRequestTime;
    constructor(apiKey: string, searchEngineId: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    private enforceRateLimit;
    private processSearchItem;
    private isValidLead;
    private extractEmail;
    private extractPhone;
    private scrapeContactFromInternet;
    private extractBusinessName;
    private extractAddress;
}
//# sourceMappingURL=GoogleCustomSearchSDK.d.ts.map