"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * SearchAPI.io SDK
 * FREE: 100 requests/month
 * Best for: Google Search results, Google Maps, Google Shopping
 * Provides: Rich search results with business info
 */
class SearchSDK {
    baseUrl = "https://www.searchapi.io/api/v1/search";
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
        if (!apiKey)
            throw new Error("SearchAPI key is required");
    }
    async searchBusinesses(query, location, limit = 10) {
        if (!query?.trim())
            return "Query parameter is required";
        if (!location?.trim())
            return "Location parameter is required";
        if (limit > 50)
            return "Recommended limit is 50 for performance";
        if (limit < 1)
            return "Limit must be at least 1";
        try {
            // 1. Search Google and Maps in parallel
            const [searchResults, mapResults] = await Promise.allSettled([
                this.performGoogleSearch(query, location, limit),
                this.performGoogleMapsSearch(query, location, Math.min(limit, 20))
            ]);
            const googleResults = searchResults.status === 'fulfilled' && typeof searchResults.value !== 'string'
                ? searchResults.value : [];
            const mapsResults = mapResults.status === 'fulfilled'
                ? mapResults.value : [];
            // 2. Process and combine results
            const leads = await this.processAllResults(googleResults, mapsResults, limit);
            const validLeads = leads.filter((lead) => lead.company?.trim());
            return validLeads.length > 0 ? validLeads : `No valid business results found for "${query}" in "${location}"`;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `SearchAPI request failed: ${errorMessage}`;
        }
    }
    async getUsage() {
        const response = await (0, node_fetch_1.default)(`https://www.searchapi.io/api/v1/account?api_key=${this.apiKey}`, {
            timeout: 10000
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    }
    async performGoogleSearch(query, location, limit) {
        const searchQuery = `${query.trim()} ${location.trim()} business contact information`;
        const params = new URLSearchParams({
            api_key: this.apiKey,
            engine: 'google',
            q: searchQuery,
            num: Math.min(limit, 10).toString(),
            gl: 'us',
            hl: 'en'
        });
        const response = await (0, node_fetch_1.default)(`${this.baseUrl}?${params.toString()}`, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SearchAPI/1.0)' }
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            return `SearchAPI HTTP ${response.status}: ${errorText}`;
        }
        const data = await response.json();
        if (data.error)
            return `SearchAPI error: ${data.error}`;
        return Array.isArray(data.organic_results) ? data.organic_results : [];
    }
    async performGoogleMapsSearch(query, location, limit) {
        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                engine: 'google_maps',
                q: `${query.trim()} ${location.trim()}`,
                type: 'search'
            });
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}?${params.toString()}`, {
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SearchAPI/1.0)' }
            });
            if (!response.ok)
                return [];
            const data = await response.json();
            return data.error ? [] : (Array.isArray(data.local_results) ? data.local_results.slice(0, limit) : []);
        }
        catch (error) {
            return [];
        }
    }
    async processAllResults(searchResults, mapResults, limit) {
        const processedCompanies = new Set();
        const allLeads = [];
        // 1. Process Maps results first (higher quality)
        for (const result of mapResults.slice(0, limit)) {
            try {
                const lead = await this.processMapResult(result);
                if (lead?.company && !processedCompanies.has(lead.company.toLowerCase())) {
                    processedCompanies.add(lead.company.toLowerCase());
                    allLeads.push(lead);
                }
            }
            catch (error) {
                // Continue on error
            }
        }
        // 2. Fill remaining slots with search results
        const remaining = limit - allLeads.length;
        if (remaining > 0) {
            for (const result of searchResults.slice(0, remaining)) {
                try {
                    const lead = await this.processSearchResult(result);
                    if (lead?.company && !processedCompanies.has(lead.company.toLowerCase())) {
                        processedCompanies.add(lead.company.toLowerCase());
                        allLeads.push(lead);
                    }
                }
                catch (error) {
                    // Continue on error
                }
            }
        }
        return allLeads.slice(0, limit);
    }
    async processMapResult(result) {
        if (!result?.title)
            return null;
        const lead = {
            company: result.title || "",
            address: result.address || "",
            phone: this.cleanPhone(result.phone || ""),
            email: await this.extractEmailFromResult(result),
            website: result.website || "",
        };
        return lead;
    }
    async processSearchResult(result) {
        if (!result || (!result.title && !result.snippet))
            return null;
        const company = this.extractCompanyName(result.title || result.snippet || "");
        const website = result.link || "";
        // Scrape contacts from website if available
        let email = "", phone = "";
        if (website) {
            try {
                const contacts = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website);
                email = contacts.email;
                phone = contacts.phone;
            }
            catch (error) {
                // Continue without contacts
            }
        }
        const lead = {
            company,
            address: this.extractAddress(result.snippet || ""),
            phone: this.cleanPhone(phone),
            email: email.toLowerCase().trim(),
            website,
        };
        return lead;
    }
    async extractEmailFromResult(result) {
        // 1. Check direct email
        if (result.contact?.email)
            return result.contact.email;
        // 2. Scrape from website
        if (result.website) {
            try {
                const contacts = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(result.website);
                return contacts.email;
            }
            catch (error) {
                return "";
            }
        }
        return "";
    }
    cleanPhone(phone) {
        if (!phone)
            return "";
        const digits = phone.replace(/[^\d]/g, "");
        if (digits.length === 10) {
            return `1${digits}`;
        }
        else if (digits.length === 11 && digits.startsWith('1')) {
            return digits;
        }
        else if (digits.length >= 10) {
            return digits.slice(0, 11);
        }
        return "";
    }
    extractCompanyName(text) {
        if (!text)
            return "";
        return text
            .split('-')[0]
            .split('|')[0]
            .replace(/\s+(LLC|Inc|Corp|Ltd|Co\.|Company|LTD|INC).*$/i, "")
            .trim();
    }
    extractAddress(text) {
        if (!text)
            return "";
        const match = text.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)[^,]*(?:,\s*[A-Za-z\s]+)?/i);
        return match ? match[0].trim() : "";
    }
}
exports.SearchSDK = SearchSDK;
