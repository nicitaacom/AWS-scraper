"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuckDuckGoSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * DuckDuckGo Instant Answer API SDK
 * FREE: Unlimited (no official limit)
 * Best for: Basic business info from search
 * Provides: URLs, abstracts, related topics
 * If error returns string with error message
 */
class DuckDuckGoSDK {
    endpoint = "https://api.duckduckgo.com/";
    async searchBusinesses(query, location, limit = 10) {
        // 1. Validate limit
        if (limit > 50)
            return "Recommended limit is 50 for performance";
        try {
            // 2. Construct global search query
            const q = `${query} ${location} company contact info`;
            const url = `${this.endpoint}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
            // 3. Fetch raw data
            const res = await (0, node_fetch_1.default)(url);
            if (!res.ok)
                throw new Error(res.statusText);
            const data = await res.json();
            // 4. Clean up & filter items with actual URLs
            const rawItems = [...(data.Results || []), ...(data.RelatedTopics || [])];
            const items = rawItems.filter(item => item.FirstURL && typeof item.FirstURL === "string").slice(0, limit);
            // 5. Convert raw items to leads
            const leads = [];
            for (const item of items) {
                const name = this.extractName(item.Text || "");
                if (!name)
                    continue;
                const website = item.FirstURL;
                const { email, phone } = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website);
                leads.push({
                    company: name,
                    address: this.extractAddress(item.Text || "", location),
                    phone,
                    email,
                    website
                });
            }
            // 6. Return valid leads only
            return leads.filter(lead => lead.company);
        }
        catch (error) {
            return `DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    extractName(text) {
        return text.split("-")[0].split("|")[0].trim();
    }
    extractAddress(text, location) {
        const m = text.match(new RegExp(`[^.!?]*${location}[^.!?]*`, "i"));
        return m ? m[0].trim() : location;
    }
}
exports.DuckDuckGoSDK = DuckDuckGoSDK;
