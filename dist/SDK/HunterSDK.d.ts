import { Lead } from "../interfaces/interfaces";
/**
 * Hunter.io Email Finder SDK
 * ✅ FREE Plan: 25 searches/month
 * ✅ Rate Limit: 10 requests/minute (6 second delay)
 * ✅ Use case: Enrich business domains with email & phone info
 * ✅ Enhanced: Returns error strings instead of throwing errors
 * ✅ Rate limited: Built-in delays for free tier compliance
 */
export declare class HunterSDK {
    private readonly apiKey;
    private readonly endpoint;
    private readonly maxFreeRequests;
    private readonly rateLimitDelay;
    private lastRequestTime;
    constructor(apiKey: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    private enforceRateLimit;
    private isValidLead;
    private enrichLead;
    private findDomains;
    private generateFallbackDomains;
    private extractDomainsFromHtml;
    private isValidDomain;
    private extractCompanyName;
    private findEmails;
    private scrapePhone;
    private delay;
}
//# sourceMappingURL=HunterSDK.d.ts.map