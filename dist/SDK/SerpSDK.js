"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerpSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite");
/**
 * SerpAPI SDK
 * FREE: 100 searches/month
 * Best for: Google search results with business data
 * Provides: URLs, snippets, titles, local results
 *
 * Public methods: searchBusinesses, getUsage
 * All other methods are private utilities
 */
class SerpSDK {
    apiKey;
    endpoint = "https://serpapi.com/search";
    constructor(apiKey) {
        this.apiKey = apiKey;
        if (!apiKey)
            throw new Error("SerpAPI key is required");
    }
    /**
     * Search for businesses using SerpAPI
     */
    async searchBusinesses(query, location, limit = 10) {
        // Input validation
        if (!query?.trim())
            return "Query parameter is required";
        if (!location?.trim())
            return "Location parameter is required";
        if (limit > 100)
            return "Limit exceeds free tier maximum of 100";
        if (limit < 1)
            return "Limit must be at least 1";
        try {
            // 1. Build search query and URL
            const searchQuery = `${query.trim()} ${location.trim()} contact phone email`;
            const params = new URLSearchParams({
                q: searchQuery,
                location: location.trim(),
                api_key: this.apiKey,
                num: Math.min(limit, 20).toString(),
                engine: 'google'
            });
            // 2. Make API request
            const response = await (0, node_fetch_1.default)(`${this.endpoint}?${params.toString()}`, {
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SerpAPI/1.0)' }
            });
            // 3. Handle HTTP errors
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                return `SerpAPI HTTP ${response.status}: ${errorText}`;
            }
            // 4. Parse response
            const data = await response.json();
            if (data.error)
                return `SerpAPI error: ${data.error}`;
            // 5. Extract and combine results
            const organicResults = Array.isArray(data.organic_results) ? data.organic_results : [];
            const localResults = Array.isArray(data.local_results) ? data.local_results : [];
            const allResults = [...localResults, ...organicResults]; // Prioritize local results
            if (allResults.length === 0) {
                return `No results found for "${query}" in "${location}"`;
            }
            // 6. Process results into leads
            const leads = await Promise.all(allResults.slice(0, limit).map(async (item) => {
                try {
                    const website = item.link || item.website || "";
                    const company = this.extractCompanyName(item.title || item.name || "");
                    const address = item.address || this.extractAddress(item.snippet || "", location);
                    if (!company.trim())
                        return null;
                    // Scrape contact info in parallel
                    const [email, phone] = await Promise.all([
                        website ? (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(website).catch(() => "") : "",
                        item.phone ?
                            this.cleanPhone(item.phone) :
                            website ? this.scrapePhoneFromWebsite(website).catch(() => "") : ""
                    ]);
                    return { company, address, phone, email, website };
                }
                catch (error) {
                    console.error(`Error processing SerpAPI result:`, error);
                    return null;
                }
            }));
            // 7. Filter valid leads
            const validLeads = leads.filter((lead) => lead !== null && Boolean(lead.company?.trim()));
            return validLeads.length > 0 ? validLeads : `No valid business results found for "${query}" in "${location}"`;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("SerpAPI searchBusinesses failed:", errorMessage);
            return `SerpAPI request failed: ${errorMessage}`;
        }
    }
    /**
     * Get API usage information
     */
    async getUsage() {
        try {
            const response = await (0, node_fetch_1.default)(`https://serpapi.com/account?api_key=${this.apiKey}`, {
                timeout: 10000
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error("Failed to get SerpAPI usage:", error);
            throw error;
        }
    }
    async scrapePhoneFromWebsite(website) {
        try {
            const url = website.startsWith('http') ? website : `https://${website}`;
            const response = await (0, node_fetch_1.default)(url, {
                timeout: 5000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            if (!response.ok)
                return "";
            const html = await response.text();
            const cleanText = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ");
            // Phone patterns (US format primarily)
            const phonePatterns = [
                /\b\+?1?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/,
                /\b\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/
            ];
            for (const pattern of phonePatterns) {
                const match = cleanText.match(pattern);
                if (match) {
                    const cleanedPhone = this.cleanPhone(match[0]);
                    if (cleanedPhone)
                        return cleanedPhone;
                }
            }
            return "";
        }
        catch (error) {
            console.error(`Phone scraping failed for ${website}:`, error);
            return "";
        }
    }
    cleanPhone(phone) {
        if (!phone)
            return "";
        const digits = phone.replace(/[^\d]/g, "");
        if (digits.length === 10) {
            return `1${digits}`; // Add country code for US numbers
        }
        else if (digits.length === 11 && digits.startsWith('1')) {
            return digits;
        }
        else if (digits.length >= 10) {
            return digits.slice(0, 11); // Take first 11 digits
        }
        return ""; // Invalid phone number
    }
    extractCompanyName(title) {
        if (!title)
            return "";
        return title
            .split(/[-|]/)[0] // Take everything before dash or pipe
            .replace(/\s+(LLC|Inc|Corp|Ltd|Co\.|Company|LTD|INC).*$/i, "") // Remove business suffixes
            .trim();
    }
    extractAddress(snippet, location) {
        if (!snippet)
            return location;
        // Street address patterns
        const streetPatterns = [
            /\d+\s+[\w\s]+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct)\b[^.!?]*/gi,
            new RegExp(`[^.!?]*${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^.!?]*`, "i")
        ];
        for (const pattern of streetPatterns) {
            const match = snippet.match(pattern);
            if (match && match[0]) {
                return match[0].trim();
            }
        }
        return location; // Fallback to location if no address found
    }
}
exports.SerpSDK = SerpSDK;
