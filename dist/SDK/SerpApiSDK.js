"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerpApiSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite");
/**
 * SerpAPI SDK
 * FREE: 100 searches/month
 * Best for: Google search results with business data
 * Provides: URLs, snippets, titles, local results
 */
class SerpApiSDK {
    apiKey;
    endpoint = "https://serpapi.com/search";
    constructor(apiKey) { this.apiKey = apiKey; }
    async searchBusinesses(query, location, limit = 10) {
        if (limit > 100)
            return "Limit exceeds free tier maximum of 100";
        try {
            const q = `${query} ${location} contact phone email`;
            const url = `${this.endpoint}?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&api_key=${this.apiKey}&num=${Math.min(limit, 20)}`;
            const res = await (0, node_fetch_1.default)(url);
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.error || res.statusText);
            const items = [...(data.organic_results || []), ...(data.local_results || [])];
            const leads = await Promise.all(items.slice(0, limit).map(async (item) => {
                const site = item.link || item.website || "";
                const name = this.extractName(item.title || item.name || "");
                const address = item.address || this.extractAddress(item.snippet || "", location);
                const [email, phone] = await Promise.all([
                    site ? (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(site) : "",
                    item.phone ? this.cleanPhone(item.phone) : site ? this.scrapePhone(site) : ""
                ]);
                return { company: name, address, phone, email, website: site };
            }));
            return leads.filter(l => l.company);
        }
        catch (error) {
            console.error("SerpAPI failed:", error);
            return error.message;
        }
    }
    async scrapePhone(site) {
        try {
            const r = await (0, node_fetch_1.default)(site, { timeout: 5000 });
            if (!r.ok)
                return "";
            const txt = await r.text();
            const clean = txt.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ");
            const patterns = [/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g];
            for (const p of patterns) {
                const m = clean.match(p);
                if (m)
                    return this.cleanPhone(m[0]);
            }
            return "";
        }
        catch {
            return "";
        }
    }
    cleanPhone(phone) {
        const clean = phone.replace(/[^\d]/g, "");
        return clean.length === 10 ? `1${clean}` : clean.length >= 10 ? clean : "";
    }
    extractName(title) {
        return title.replace(/\s*[-|].*/, "").trim();
    }
    extractAddress(snippet, location) {
        const pats = [/\d+\s+\w+\s+(St|Ave|Rd|Blvd|Dr)/gi, new RegExp(`[^.!?]*${location}[^.!?]*`, "i")];
        for (const p of pats) {
            const m = snippet.match(p);
            if (m)
                return m[0].trim();
        }
        return location;
    }
}
exports.SerpApiSDK = SerpApiSDK;
