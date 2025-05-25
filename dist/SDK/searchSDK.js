"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite");
/**
 * SearchAPI.io SDK
 * FREE: 100 requests/month
 * PAID: Starting at $20/month for 2,500 searches
 * Best for: Google Search results, Google Maps, Google Shopping
 * Provides: Rich search results with business info
 */
class SearchSDK {
    apiKey;
    baseUrl = "https://www.searchapi.io/api/v1/search";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 10) {
        // 1. Validate limit
        if (limit > 50)
            return "Recommended limit is 50 for performance";
        try {
            // 2. Search for businesses using Google Search
            const searchQuery = `${query} ${location} business contact information`;
            const searchResults = await this.googleSearch(searchQuery, limit);
            if (typeof searchResults === 'string')
                return searchResults;
            // 3. Try Google Maps search for better business data
            const mapResults = await this.googleMapsSearch(query, location, Math.min(limit, 20));
            // 4. Combine and process results
            const leads = await this.processResults(searchResults, mapResults, limit);
            return leads.filter((l) => l.company);
        }
        catch (error) {
            return `SearchAPI failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async googleSearch(query, limit) {
        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                engine: 'google',
                q: query,
                num: Math.min(limit, 10).toString(), // Google allows max 10 per request
                gl: 'us', // Country
                hl: 'en' // Language
            });
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            return data.organic_results || [];
        }
        catch (error) {
            throw error;
        }
    }
    async googleMapsSearch(query, location, limit) {
        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                engine: 'google_maps',
                q: `${query} ${location}`,
                ll: '@40.7128,-74.0060,10z', // Default to NYC, adjust as needed
                type: 'search'
            });
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}?${params}`);
            if (!response.ok) {
                return []; // Fallback to empty array if Maps search fails
            }
            const data = await response.json();
            return (data.local_results || []).slice(0, limit);
        }
        catch (error) {
            return []; // Fallback to empty array on error
        }
    }
    async processResults(searchResults, mapResults, limit) {
        const leads = new Set(); // Track unique companies
        const processedLeads = [];
        // 1. Process Google Maps results first (higher quality)
        if (Array.isArray(mapResults)) {
            for (const result of mapResults.slice(0, limit)) {
                const lead = await this.processMapResult(result);
                if (lead && lead.company && !leads.has(lead.company.toLowerCase())) {
                    leads.add(lead.company.toLowerCase());
                    processedLeads.push(lead);
                }
            }
        }
        // 2. Process Google Search results
        const remaining = limit - processedLeads.length;
        if (remaining > 0) {
            for (const result of searchResults.slice(0, remaining)) {
                const lead = await this.processSearchResult(result);
                if (lead && lead.company && !leads.has(lead.company.toLowerCase())) {
                    leads.add(lead.company.toLowerCase());
                    processedLeads.push(lead);
                }
            }
        }
        return processedLeads.slice(0, limit);
    }
    async processMapResult(result) {
        try {
            return {
                company: result.title || "",
                address: result.address || "",
                phone: this.cleanPhone(result.phone || ""),
                email: await this.scrapeEmailFromResult(result),
                website: result.website || "",
            };
        }
        catch {
            return null;
        }
    }
    async processSearchResult(result) {
        try {
            const company = this.extractCompanyName(result.title || result.snippet || "");
            const website = result.link || "";
            return {
                company,
                address: this.extractAddress(result.snippet || ""),
                phone: await this.scrapePhone(website),
                email: await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(website),
                website,
            };
        }
        catch {
            return null;
        }
    }
    async scrapeEmailFromResult(result) {
        // 1. Check if email is directly available
        if (result.contact?.email)
            return result.contact.email;
        // 2. Try to scrape from website
        if (result.website) {
            return await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(result.website);
        }
        return "";
    }
    async scrapePhone(website) {
        if (!website)
            return "";
        try {
            const response = await (0, node_fetch_1.default)(website, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (!response.ok)
                return "";
            const text = await response.text();
            const cleanText = text.replace(/<[^>]*>/g, " ");
            const phoneMatch = cleanText.match(/\b\+?1?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/);
            return phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "") : "";
        }
        catch {
            return "";
        }
    }
    cleanPhone(phone) {
        return phone.replace(/[^\d]/g, "");
    }
    extractCompanyName(text) {
        // Remove common suffixes and clean up
        return text
            .split('-')[0]
            .split('|')[0]
            .replace(/\s+(LLC|Inc|Corp|Ltd|Co\.|Company).*$/i, "")
            .trim();
    }
    extractAddress(text) {
        // Look for address patterns
        const addressMatch = text.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)[^,]*(?:,\s*[A-Za-z\s]+)?/i);
        return addressMatch ? addressMatch[0].trim() : "";
    }
    /**
     * Search for businesses using Google Shopping (for e-commerce businesses)
     */
    async searchEcommerce(query, limit = 10) {
        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                engine: 'google_shopping',
                q: query,
                num: Math.min(limit, 20).toString()
            });
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}?${params}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            const leads = await Promise.all((data.shopping_results || []).slice(0, limit).map(async (result) => ({
                company: result.source || "",
                website: result.link || "",
                email: await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(result.link || ""),
                phone: await this.scrapePhone(result.link || ""),
                address: "",
                category: "E-commerce"
            })));
            return leads.filter((l) => l.company);
        }
        catch (error) {
            return `SearchAPI Shopping failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    /**
     * Get account usage information
     */
    async getUsage() {
        try {
            const response = await (0, node_fetch_1.default)(`https://www.searchapi.io/api/v1/account?api_key=${this.apiKey}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        }
        catch (error) {
            throw error;
        }
    }
}
exports.SearchSDK = SearchSDK;
