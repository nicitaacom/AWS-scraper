"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuckDuckGoSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite");
/**
 * DuckDuckGo Instant Answer API SDK
 * FREE: Unlimited (no official limit)
 * Best for: Basic business info from search
 * Provides: URLs, abstracts, related topics
 * If error returns string wtih error message
 */
class DuckDuckGoSDK {
    endpoint = "https://api.duckduckgo.com/";
    async searchBusinesses(query, location, limit = 10) {
        // 1. Validate limit
        if (limit > 50)
            return "Recommended limit is 50 for performance";
        try {
            // 2. Construct search query
            // e.g https://api.duckduckgo.com/?q=123&format=json&no_html=1&skip_disambig=1
            const q = `${query} ${location} business contact`;
            const url = `${this.endpoint}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
            // 3. Fetch data
            const res = await (0, node_fetch_1.default)(url);
            if (!res.ok)
                throw new Error(res.statusText);
            const data = await res.json();
            // 4. Process results
            const items = [...(data.RelatedTopics || []), ...(data.Results || [])];
            const leads = await Promise.all(items.slice(0, limit).map(async (item) => ({
                company: this.extractName(item.Text || ""),
                address: this.extractAddress(item.Text || "", location),
                phone: item.FirstURL ? await this.scrapePhone(item.FirstURL) : "",
                email: item.FirstURL ? await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(item.FirstURL) : "",
                website: item.FirstURL || ""
            })));
            // 5. Filter valid leads
            return leads.filter((l) => l.company);
        }
        catch (error) {
            return `DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async scrapePhone(site) {
        try {
            // 1. Fetch website content
            const r = await (0, node_fetch_1.default)(site, { timeout: 5000 });
            if (!r.ok)
                return "";
            // 2. Extract phone number
            const txt = await r.text();
            const clean = txt.replace(/<[^>]*>/g, " ");
            const m = clean.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
            return m ? m[0].replace(/[^\d]/g, "") : "";
        }
        catch {
            return "";
        }
    }
    extractName(text) {
        return text.split('-')[0].split('|')[0].trim();
    }
    extractAddress(text, location) {
        const m = text.match(new RegExp(`[^.!?]*${location}[^.!?]*`, "i"));
        return m ? m[0].trim() : location;
    }
}
exports.DuckDuckGoSDK = DuckDuckGoSDK;
