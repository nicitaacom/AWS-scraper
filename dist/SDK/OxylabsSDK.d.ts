import { Lead } from "../interfaces/interfaces";
/**
 * Oxylabs Web Scraper SDK
 * ✅ Real-time web scraping with residential proxies
 * ✅ Rate Limit: 3s delays for stability
 * ✅ Use case: Scrape business domains and contacts
 * ✅ Returns error strings instead of throwing
 */
export declare class OxylabsSDK {
    private readonly username;
    private readonly password;
    private readonly endpoint;
    private readonly rateLimitDelay;
    private lastRequestTime;
    constructor(username: string, password: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    private enforceRateLimit;
    private isValidLead;
    private enrichLead;
    private findDomains;
    private scrapeGoogleSearch;
    private scrapeContactsFromDomain;
    private makeOxylabsRequest;
    private generateFallbackDomains;
    private isValidDomain;
    private extractCompanyName;
}
//# sourceMappingURL=OxylabsSDK.d.ts.map