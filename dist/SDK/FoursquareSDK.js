"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoursquareSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * Foursquare Places API SDK - Enhanced for High-Volume City Processing
 * FREE: 1,000 API calls/day (30k/month)
 * Optimized for: Processing 100+ cities efficiently with smart fallbacks
 * Enhanced: Guaranteed email OR phone for each lead with multiple contact sources
 */
class FoursquareSDK {
    apiKey;
    baseUrl = "https://api.foursquare.com/v3/places";
    requestCount = 0;
    rateLimitDelay = 500; // 0.5 seconds between requests
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 20) {
        if (!query.trim() || !location.trim())
            return "Query and location are required";
        if (!this.apiKey)
            return "API key is required";
        if (limit <= 0)
            return [];
        try {
            // 1. Rate limiting
            await this.respectRateLimit();
            // 2. Try multiple search strategies
            const searchStrategies = [
                () => this.searchByTextAndLocation(query, location, limit),
                () => this.searchByGeocodedLocation(query, location, limit),
                () => this.searchByBroaderQuery(query, location, limit)
            ];
            let allLeads = [];
            let lastError = "";
            for (const strategy of searchStrategies) {
                try {
                    const leads = await strategy();
                    if (Array.isArray(leads) && leads.length > 0) {
                        allLeads = leads;
                        break;
                    }
                }
                catch (error) {
                    lastError = error.message;
                    continue;
                }
            }
            // 3. If no leads found, try category-based search
            if (allLeads.length === 0) {
                const categoryLeads = await this.searchByCategory(query, location, limit);
                if (Array.isArray(categoryLeads)) {
                    allLeads = categoryLeads;
                }
            }
            // 4. Enhance leads with contact information
            const enhancedLeads = await this.enhanceLeadsWithContacts(allLeads, location);
            // 5. Filter leads that have at least email OR phone
            const validLeads = enhancedLeads.filter(lead => (lead.email.trim() || lead.phone.trim()) && lead.company.trim());
            return validLeads.slice(0, limit);
        }
        catch (error) {
            const errorMsg = error.message;
            if (errorMsg.includes('429')) {
                return "Rate limit exceeded - please try again later";
            }
            if (errorMsg.includes('401') || errorMsg.includes('403')) {
                return "Invalid API key or insufficient permissions";
            }
            return `Foursquare search failed: ${errorMsg}`;
        }
    }
    /**
     * Standard text + location search
     */
    async searchByTextAndLocation(query, location, limit) {
        const url = `${this.baseUrl}/search?` + new URLSearchParams({
            query: query.trim(),
            near: location.trim(),
            limit: Math.min(limit, 50).toString(),
            fields: "name,location,tel,website,categories,rating,hours,email"
        }).toString();
        return await this.fetchAndProcessResults(url);
    }
    /**
     * Geocoded location search (more accurate for specific cities)
     */
    async searchByGeocodedLocation(query, location, limit) {
        const geo = await this.geocodeLocation(location);
        if (!geo)
            return [];
        const url = `${this.baseUrl}/search?` + new URLSearchParams({
            query: query.trim(),
            ll: `${geo.lat},${geo.lon}`,
            radius: "10000", // 10km radius
            limit: Math.min(limit, 50).toString(),
            fields: "name,location,tel,website,categories,rating,hours,email"
        }).toString();
        return await this.fetchAndProcessResults(url);
    }
    /**
     * Broader query search (remove specific terms that might be too narrow)
     */
    async searchByBroaderQuery(query, location, limit) {
        // Extract main business type (e.g., "roofing contractor" -> "roofing")
        const broaderQuery = query.split(' ')[0];
        const url = `${this.baseUrl}/search?` + new URLSearchParams({
            query: broaderQuery,
            near: location.trim(),
            limit: Math.min(limit, 50).toString(),
            fields: "name,location,tel,website,categories,rating,hours,email"
        }).toString();
        return await this.fetchAndProcessResults(url);
    }
    /**
     * Category-based search using Foursquare categories
     */
    async searchByCategory(query, location, limit) {
        // Map common business types to Foursquare categories
        const categoryMap = {
            'restaurant': '13065',
            'food': '13065',
            'retail': '17000',
            'shop': '17000',
            'service': '18000',
            'professional': '18000',
            'roofing': '18000',
            'contractor': '18000',
            'repair': '18000',
            'medical': '15000',
            'health': '15000',
            'fitness': '18021',
            'automotive': '18005'
        };
        const category = Object.keys(categoryMap).find(key => query.toLowerCase().includes(key));
        if (!category)
            return [];
        const url = `${this.baseUrl}/search?` + new URLSearchParams({
            categories: categoryMap[category],
            near: location.trim(),
            limit: Math.min(limit, 50).toString(),
            fields: "name,location,tel,website,categories,rating,hours,email"
        }).toString();
        return await this.fetchAndProcessResults(url);
    }
    /**
     * Fetch and process results from Foursquare API
     */
    async fetchAndProcessResults(url) {
        await this.respectRateLimit();
        const response = await (0, node_fetch_1.default)(url, {
            headers: {
                'Authorization': this.apiKey,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Foursquare API error (${response.status}): ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.results || !Array.isArray(data.results)) {
            return [];
        }
        // Process each place into a Lead
        const leads = data.results.map((place) => ({
            company: place.name || "Unknown Business",
            address: this.formatAddress(place.location),
            phone: this.cleanPhone(place.tel || ""),
            email: place.email || "",
            website: place.website || ""
        }));
        return leads;
    }
    /**
     * Enhance leads with additional contact information
     */
    async enhanceLeadsWithContacts(leads, location) {
        const enhancedLeads = [];
        for (const lead of leads) {
            const enhanced = { ...lead };
            try {
                // 1. Scrape website for contacts if available
                if (enhanced.website && (!enhanced.email || !enhanced.phone)) {
                    const webContacts = await this.scrapeWebsiteContacts(enhanced.website);
                    enhanced.email = enhanced.email || webContacts.email;
                    enhanced.phone = enhanced.phone || webContacts.phone;
                }
                // 2. Search internet for contacts if still missing
                if (!enhanced.email || !enhanced.phone) {
                    const internetContacts = await this.searchInternetForContacts(enhanced.company, location, enhanced.address);
                    enhanced.email = enhanced.email || internetContacts.email;
                    enhanced.phone = enhanced.phone || internetContacts.phone;
                }
                // 3. Try alternative search if still no contacts
                if (!enhanced.email && !enhanced.phone) {
                    const altContacts = await this.alternativeContactSearch(enhanced.company, location);
                    enhanced.email = enhanced.email || altContacts.email;
                    enhanced.phone = enhanced.phone || altContacts.phone;
                }
            }
            catch (error) {
                // Continue with original lead if enhancement fails
            }
            enhancedLeads.push(enhanced);
            // Small delay between enhancements to avoid overwhelming external services
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return enhancedLeads;
    }
    /**
     * Scrape website for contact information
     */
    async scrapeWebsiteContacts(website) {
        try {
            const contacts = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website);
            return {
                email: contacts.email || "",
                phone: this.cleanPhone(contacts.phone || "")
            };
        }
        catch {
            return { email: "", phone: "" };
        }
    }
    /**
     * Search internet for business contacts
     */
    async searchInternetForContacts(businessName, location, address) {
        try {
            const searchQuery = `"${businessName}" ${location} ${address || ""} contact email phone`;
            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1`;
            const response = await (0, node_fetch_1.default)(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadScraper/1.0)' }
            });
            if (!response.ok)
                return { email: "", phone: "" };
            const text = await response.text();
            // Extract email and phone from search results
            const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
            const phoneMatch = text.match(/\b\+?[\d\s\-\(\)\.]{10,}\b/);
            return {
                email: emailMatch ? emailMatch[0] : "",
                phone: phoneMatch ? this.cleanPhone(phoneMatch[0]) : ""
            };
        }
        catch {
            return { email: "", phone: "" };
        }
    }
    /**
     * Alternative contact search using business directories
     */
    async alternativeContactSearch(businessName, location) {
        try {
            // Search in common business directories
            const directories = [
                `site:yelp.com "${businessName}" ${location}`,
                `site:yellowpages.com "${businessName}" ${location}`,
                `site:google.com/maps "${businessName}" ${location}`
            ];
            for (const query of directories) {
                try {
                    const response = await (0, node_fetch_1.default)(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`, {
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });
                    if (response.ok) {
                        const text = await response.text();
                        const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
                        const phoneMatch = text.match(/\b\+?[\d\s\-\(\)\.]{10,}\b/);
                        if (emailMatch || phoneMatch) {
                            return {
                                email: emailMatch ? emailMatch[0] : "",
                                phone: phoneMatch ? this.cleanPhone(phoneMatch[0]) : ""
                            };
                        }
                    }
                }
                catch {
                    continue;
                }
                // Small delay between directory searches
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            return { email: "", phone: "" };
        }
        catch {
            return { email: "", phone: "" };
        }
    }
    /**
     * Convert location string to coordinates using OpenStreetMap
     */
    async geocodeLocation(location) {
        try {
            const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
                q: location,
                format: "json",
                limit: "1"
            }).toString();
            const response = await (0, node_fetch_1.default)(url, {
                headers: { "User-Agent": "LeadScraper/1.0" }
            });
            if (!response.ok)
                return null;
            const results = await response.json();
            const first = results[0];
            return first ? { lat: first.lat, lon: first.lon } : null;
        }
        catch {
            return null;
        }
    }
    /**
     * Format address from Foursquare location object
     */
    formatAddress(location) {
        if (!location)
            return "";
        const parts = [
            location.address,
            location.locality,
            location.region,
            location.postcode,
            location.country
        ].filter((part) => typeof part === "string" && part.trim())
            .map((part) => part.trim());
        return parts.join(", ");
    }
    /**
     * Clean and format phone numbers
     */
    cleanPhone(phone) {
        if (!phone)
            return "";
        // Remove all non-digit characters except + at the beginning
        const cleaned = phone.replace(/[^\d+]/g, "");
        // Ensure phone has at least 10 digits
        const digits = cleaned.replace(/^\+/, "");
        if (digits.length < 10)
            return "";
        return cleaned;
    }
    /**
     * Respect rate limits to avoid 429 errors
     */
    async respectRateLimit() {
        this.requestCount++;
        // Progressive delay based on request count
        let delay = this.rateLimitDelay;
        if (this.requestCount > 50)
            delay = 1000; // 1 second after 50 requests
        if (this.requestCount > 100)
            delay = 2000; // 2 seconds after 100 requests
        if (this.requestCount > 200)
            delay = 3000; // 3 seconds after 200 requests
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}
exports.FoursquareSDK = FoursquareSDK;
