import { Lead } from "../interfaces/interfaces";
/**
 * SerpAPI SDK
 * FREE: 100 searches/month
 * Best for: Google search results with business data
 * Provides: URLs, snippets, titles, local results
 * Returns string if error
 *
 * CRITICAL REQUIREMENT: Every lead MUST have at least email OR phone
 *
 * @example
 * const sdk = new SerpSDK("SERPAPI_KEY")
 * const leads = await sdk.searchBusinesses(
 *   "coffee shop",
 *   "24783, Osterrönfeld, Germany",
 *   10
 * )
 *
 * @returns Promise<Lead[] | string> - Array of leads or error message
 */
export declare class SerpSDK {
    private apiKey;
    private endpoint;
    constructor(apiKey: string);
    /**
     * Search for businesses using SerpAPI
     * @param query - Business type, e.g. "nail salon"
     * @param location - Full location string, e.g. "24783, Osterrönfeld, Germany"
     * @param limit - Max results (1–100)
     */
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    /** Wraps SerpAPI call with AbortController timeout */
    private callSerp;
    /** Convert location string to lat/lon via OSM Nominatim */
    private geocodeLocation;
    /** Scrapes phone from a website URL */
    private scrapePhoneFromWebsite;
    /** Normalize phone string to digits */
    private cleanPhone;
    private extractCompanyName;
    private extractAddress;
}
//# sourceMappingURL=SerpSDK.d.ts.map