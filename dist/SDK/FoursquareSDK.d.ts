import { Lead } from "../interfaces/interfaces";
/**
 * Foursquare Places API SDK - Enhanced for High-Volume City Processing
 * FREE: 1,000 API calls/day (30k/month)
 * Optimized for: Processing 100+ cities efficiently with smart fallbacks
 * Enhanced: Guaranteed email OR phone for each lead with multiple contact sources
 */
export declare class FoursquareSDK {
    private apiKey;
    private baseUrl;
    private requestCount;
    private rateLimitDelay;
    constructor(apiKey: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    /**
     * Standard text + location search
     */
    private searchByTextAndLocation;
    /**
     * Geocoded location search (more accurate for specific cities)
     */
    private searchByGeocodedLocation;
    /**
     * Broader query search (remove specific terms that might be too narrow)
     */
    private searchByBroaderQuery;
    /**
     * Category-based search using Foursquare categories
     */
    private searchByCategory;
    /**
     * Fetch and process results from Foursquare API
     */
    private fetchAndProcessResults;
    /**
     * Enhance leads with additional contact information
     */
    private enhanceLeadsWithContacts;
    /**
     * Scrape website for contact information
     */
    private scrapeWebsiteContacts;
    /**
     * Search internet for business contacts
     */
    private searchInternetForContacts;
    /**
     * Alternative contact search using business directories
     */
    private alternativeContactSearch;
    /**
     * Convert location string to coordinates using OpenStreetMap
     */
    private geocodeLocation;
    /**
     * Format address from Foursquare location object
     */
    private formatAddress;
    /**
     * Clean and format phone numbers
     */
    private cleanPhone;
    /**
     * Respect rate limits to avoid 429 errors
     */
    private respectRateLimit;
}
//# sourceMappingURL=FoursquareSDK.d.ts.map