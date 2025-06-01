import { Lead } from "../interfaces/interfaces";
/**
 * RapidAPI Web Scraper SDK
 * FREE: Varies by plan (check RapidAPI dashboard)
 * Best for: Scraping business information from websites
 * Enhanced: Uses web scraping to find contact information
 */
export declare class RapidSDK {
    private baseUrl;
    private apiKey;
    constructor(apiKey: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    private scrapeSearchResults;
    private extractCompanyName;
    private extractContactsFromContent;
    private extractEmailFromText;
    private extractPhoneFromText;
    private cleanPhone;
    private cleanUrl;
}
//# sourceMappingURL=RapidSDK.d.ts.map