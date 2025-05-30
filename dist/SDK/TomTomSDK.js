"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TomTomSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * TomTom Places API SDK
 * FREE: 2,500 requests/day
 * Best for: Comprehensive POI and business data
 * Provides: Name, address, phone, categories
 * Enhanced: Scrapes emails from websites when available
 * If error returns string wtih error message
 */
class TomTomSDK {
    apiKey;
    baseUrl = "https://api.tomtom.com/search/2";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    // Search businesses by query and location
    async searchBusinesses(query, location, limit = 100) {
        if (limit > 100)
            return "Recommended limit is 100 for performance";
        const locationData = await this.getCoordinatesFromLocation(location);
        if (typeof locationData === "string")
            return locationData;
        const { lat, lon, countryCode, entityType } = locationData;
        const params = new URLSearchParams({
            key: this.apiKey,
            query,
            countrySet: countryCode,
            limit: Math.min(limit, 100).toString(),
            categorySet: this.getBusinessCategories(),
            extendedPostalCodesFor: "Addr,POI",
        });
        if (entityType !== "Country") {
            params.append("lat", lat.toString());
            params.append("lon", lon.toString());
            params.append("radius", "50000"); // 50 km radius
        }
        try {
            let response = await (0, node_fetch_1.default)(`${this.baseUrl}/poiSearch/${encodeURIComponent(query)}.json?${params}`);
            if (!response.ok)
                return `TomTom API error: ${response.status} - ${response.statusText}`;
            let data = await response.json();
            if (!data.results?.length) {
                // Fallback: retry without categorySet if no results
                params.delete("categorySet");
                response = await (0, node_fetch_1.default)(`${this.baseUrl}/poiSearch/${encodeURIComponent(query)}.json?${params}`);
                if (!response.ok)
                    return `TomTom API error: ${response.status} - ${response.statusText}`;
                data = await response.json();
            }
            if (!data.results?.length)
                return "No businesses found for the given query and location";
            const leads = await Promise.all(data.results.map(async (poi) => ({
                company: poi.poi?.name || "",
                address: this.formatAddress(poi.address),
                phone: this.cleanPhone(poi.poi?.phone || ""),
                email: poi.poi?.url ? (await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(poi.poi.url)).email : "",
                website: poi.poi?.url || "",
            })));
            return leads.filter((lead) => lead.company);
        }
        catch (error) {
            return `TomTom search failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    // Get coordinates and additional data from location string
    async getCoordinatesFromLocation(location) {
        try {
            const params = new URLSearchParams({ key: this.apiKey, query: location, limit: "1" });
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/geocode/${encodeURIComponent(location)}.json?${params}`);
            if (!response.ok)
                return `Geocoding failed: ${response.status} - ${response.statusText}`;
            const data = await response.json();
            if (!data.results?.length)
                return "No coordinates found for location";
            const result = data.results[0];
            return {
                lat: result.position.lat,
                lon: result.position.lon,
                countryCode: result.address.countryCode,
                entityType: result.type === "Geography" ? result.entityType : "Other",
            };
        }
        catch (error) {
            return `Geocoding error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    // Get business category codes
    getBusinessCategories() {
        return ["7315", "7321", "7374", "7313", "9361", "7328", "7302", "7318", "7377", "9663"].join(",");
    }
    // Format address from API response
    formatAddress(address) {
        if (!address)
            return "";
        const parts = [
            address.streetNumber,
            address.streetName,
            address.municipality,
            address.countrySubdivision,
            address.postalCode,
            address.country,
        ].filter(Boolean);
        return parts.join(", ");
    }
    // Clean phone number
    cleanPhone(phone) {
        return phone.replace(/[^\d]/g, "");
    }
}
exports.TomTomSDK = TomTomSDK;
