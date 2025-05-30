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
 * If error returns string wtih error message
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
     * Validate and normalize search type
     * @param searchType The search type to validate
     * @returns A valid search type or null if invalid
     */
    validateSearchType(searchType) {
        const validTypes = ['name', 'jurisdiction', 'industry'];
        // Direct match
        if (validTypes.includes(searchType)) {
            return searchType;
        }
        // Normalize common variations
        const normalized = searchType.toLowerCase().trim();
        switch (normalized) {
            case 'company':
            case 'business':
            case 'firm':
            case 'organization':
            case 'org':
                return 'name';
            case 'location':
            case 'region':
            case 'country':
            case 'state':
                return 'jurisdiction';
            case 'sector':
            case 'category':
            case 'type':
            case 'business_type':
                return 'industry';
            default:
                return null;
        }
    }
    /**
     * Search for businesses by name, jurisdiction, or industry
     * @param query The search query (name, jurisdiction code, or industry type)
     * @param searchType The type of search: 'name', 'jurisdiction', 'industry', or variations
     * @param limit The maximum number of results to return
     */
    async searchBusinesses(query, searchType, limit = 30) {
        try {
            // Validate and normalize search type
            const validSearchType = this.validateSearchType(searchType);
            if (!validSearchType) {
                console.warn(`⚠️ OpenCorporates: Invalid search type '${searchType}'. Defaulting to 'name' search.`);
                // Default to name search as fallback
                return this.searchBusinesses(query, 'name', limit);
            }
            await this.rateLimit();
            let url = `${this.baseUrl}/companies`;
            const params = new URLSearchParams({
                format: "json",
                per_page: Math.min(limit, 100).toString()
            });
            if (validSearchType === 'name') {
                params.append("q", query);
                url += "/search";
            }
            else if (validSearchType === 'jurisdiction') {
                params.append("jurisdiction_code", query);
            }
            else if (validSearchType === 'industry') {
                params.append("company_type", query);
            }
            console.log(`🔍 OpenCorporates: Searching ${validSearchType} for "${query}"`);
            const response = await (0, node_fetch_1.default)(`${url}?${params}`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(`OpenCorporates API error: ${data.error || response.statusText}`);
            }
            if (!data.results?.companies?.length) {
                return "No businesses found for the given query.";
            }
            const companies = data.results.companies || [];
            console.log(`✅ OpenCorporates: Found ${companies.length} companies`);
            const leads = await Promise.all(companies.map(async (company) => {
                const lead = {
                    company: company.company?.name || company.name || "",
                    address: company.company?.registered_address_in_full || company.registered_address_in_full || "",
                    phone: "",
                    email: "",
                    website: ""
                };
                // Enhanced website finding and contact info scraping
                try {
                    const website = await this.findWebsite(lead.company);
                    if (website) {
                        lead.website = website;
                        console.log(`🌐 Found website for ${lead.company}: ${website}`);
                        // Try to scrape phone and email
                        try {
                            const phone = await this.scrapePhoneFromWebsite(website);
                            if (phone)
                                lead.phone = phone;
                        }
                        catch (error) {
                            console.warn(`⚠️ Could not scrape phone from ${website}:`, error);
                        }
                        try {
                            const email = await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(website);
                            if (email)
                                lead.email = email;
                        }
                        catch (error) {
                            console.warn(`⚠️ Could not scrape email from ${website}:`, error);
                        }
                    }
                }
                catch (error) {
                    console.warn(`⚠️ Could not find website for ${lead.company}:`, error);
                }
                return lead;
            }));
            return leads.filter(lead => lead.company); // Filter out empty company names
        }
        catch (error) {
            const errorMessage = `OpenCorporates search failed: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`❌ OpenCorporates error:`, errorMessage);
            return errorMessage;
        }
    }
    /**
     * Overloaded method to maintain backward compatibility with specific search types
     */
    async searchByName(query, limit = 30) {
        return this.searchBusinesses(query, 'name', limit);
    }
    async searchByJurisdiction(query, limit = 30) {
        return this.searchBusinesses(query, 'jurisdiction', limit);
    }
    async searchByIndustry(query, limit = 30) {
        return this.searchBusinesses(query, 'industry', limit);
    }
    /**
     * Find the website of a company using DuckDuckGo's API
     * @param companyName The name of the company
     */
    async findWebsite(companyName) {
        if (!companyName)
            return "";
        try {
            const q = `${companyName} official website`;
            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
            const res = await (0, node_fetch_1.default)(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (!res.ok)
                return "";
            const data = await res.json();
            const items = [...(data.RelatedTopics || []), ...(data.Results || [])];
            if (items.length > 0 && items[0].FirstURL) {
                const website = items[0].FirstURL;
                // Basic URL validation
                if (website.startsWith('http://') || website.startsWith('https://')) {
                    return website;
                }
            }
            return "";
        }
        catch (error) {
            console.warn(`⚠️ Could not find website for ${companyName}:`, error);
            return "";
        }
    }
    /**
     * Scrape phone number from a website
     * @param site The website URL to scrape
     */
    async scrapePhoneFromWebsite(site) {
        if (!site)
            return "";
        try {
            const r = await (0, node_fetch_1.default)(site, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (!r.ok)
                return "";
            const txt = await r.text();
            const clean = txt.replace(/<[^>]*>/g, " ");
            // Enhanced phone number regex patterns
            const phonePatterns = [
                /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // Standard US format
                /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // Simple US format
                /\b\+\d{1,3}\s?\d{1,4}\s?\d{1,4}\s?\d{1,4}\b/g // International format
            ];
            for (const pattern of phonePatterns) {
                const matches = clean.match(pattern);
                if (matches && matches.length > 0) {
                    // Return the first valid-looking phone number
                    const phone = matches[0].replace(/[^\d+]/g, "");
                    if (phone.length >= 10) {
                        return phone;
                    }
                }
            }
            return "";
        }
        catch (error) {
            console.warn(`⚠️ Could not scrape phone from ${site}:`, error);
            return "";
        }
    }
}
exports.OpenCorporatesSDK = OpenCorporatesSDK;
