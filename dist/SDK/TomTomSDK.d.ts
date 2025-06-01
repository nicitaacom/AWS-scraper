import { Lead } from "../interfaces/interfaces";
/**
 * TomTom Places API SDK
 * FREE: 2,500 requests/day
 * Best for: Comprehensive POI and business data
 * Provides: Name, address, phone, categories
 * Enhanced: Scrapes emails from websites when available
 * If error returns string wtih error message
 */
export declare class TomTomSDK {
    private apiKey;
    private baseUrl;
    constructor(apiKey: string);
    searchBusinesses(query: string, location: string, limit?: number): Promise<Lead[] | string>;
    private getCoordinatesFromLocation;
    private getBusinessCategories;
    private formatAddress;
    private cleanPhone;
}
//# sourceMappingURL=TomTomSDK.d.ts.map