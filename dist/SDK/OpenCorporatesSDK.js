"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenCorporatesSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite"); // Assuming this utility is available
/**
 * OpenCorporates API SDK
 * FREE: 60 requests/minute (86,400/day potential)
 * Best for: B2B company data, official business records
 * Provides: Company name, registered address, incorporation date, status
 * Limitations: No phone/email, mainly corporate data
 */
class OpenCorporatesSDK {
    baseUrl = "https://api.opencorporates.com/v0.4";
    rateLimitMs = 1000; // 1 second between requests to stay under 60/min
    lastRequestTime = 0;
    /**
     * Rate limiting to respect 60 requests/minute
     */
    async rateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitMs) {
            await new Promise(resolve => setTimeout(resolve, this.rateLimitMs - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }
    /**
     * Search for businesses by name, jurisdiction, or industry
     * @param query The search query (name, jurisdiction code, or industry type)
     * @param searchType The type of search: 'name', 'jurisdiction', or 'industry'
     * @param limit The maximum number of results to return
     */
    async searchBusinesses(query, searchType, limit = 30) {
        try {
            await this.rateLimit();
            let url = `${this.baseUrl}/companies`;
            const params = new URLSearchParams({
                format: "json",
                per_page: Math.min(limit, 100).toString()
            });
            if (searchType === 'name') {
                params.append("q", query);
                url += "/search";
            }
            else if (searchType === 'jurisdiction') {
                params.append("jurisdiction_code", query);
            }
            else if (searchType === 'industry') {
                params.append("company_type", query);
            }
            else {
                return "Invalid search type. Use 'name', 'jurisdiction', or 'industry'.";
            }
            const response = await (0, node_fetch_1.default)(`${url}?${params}`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(`OpenCorporates API error: ${data.error || response.statusText}`);
            }
            if (!data.results?.companies?.length) {
                return "No businesses found for the given query.";
            }
            const companies = data.results.companies || [];
            const leads = await Promise.all(companies.map(async (company) => {
                const lead = {
                    company: company.name || "",
                    address: company.registered_address_in_full || "",
                    phone: "",
                    email: "",
                    website: ""
                };
                try {
                    const website = await this.findWebsite(company.name);
                    if (website) {
                        lead.website = website;
                        try {
                            lead.phone = await this.scrapePhoneFromWebsite(website);
                        }
                        catch { }
                        try {
                            lead.email = await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(website);
                        }
                        catch { }
                    }
                }
                catch { }
                return lead;
            }));
            return leads;
        }
        catch (error) {
            return `OpenCorporates search failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    /**
     * Find the website of a company using DuckDuckGo's API
     * @param companyName The name of the company
     */
    async findWebsite(companyName) {
        try {
            const q = `${companyName} official website`;
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
            const res = await (0, node_fetch_1.default)(url);
            if (!res.ok)
                return "";
            const data = await res.json();
            const items = [...(data.RelatedTopics || []), ...(data.Results || [])];
            if (items.length > 0 && items[0].FirstURL) {
                return items[0].FirstURL;
            }
            return "";
        }
        catch {
            return "";
        }
    }
    /**
     * Scrape phone number from a website
     * @param site The website URL to scrape
     */
    async scrapePhoneFromWebsite(site) {
        try {
            const r = await (0, node_fetch_1.default)(site, { timeout: 5000 });
            if (!r.ok)
                return "";
            const txt = await r.text();
            const clean = txt.replace(/<[^>]*>/g, " ");
            const m = clean.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
            return m ? m[0].replace(/[^\d]/g, "") : "";
        }
        catch {
            return "";
        }
    }
}
exports.OpenCorporatesSDK = OpenCorporatesSDK;
