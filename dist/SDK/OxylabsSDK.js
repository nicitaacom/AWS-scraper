"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OxylabsSDK = void 0;
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * Oxylabs Web Scraper SDK
 * ✅ Real-time web scraping with residential proxies
 * ✅ Rate Limit: 3s delays for stability
 * ✅ Use case: Scrape business domains and contacts
 * ✅ Returns error strings instead of throwing
 */
class OxylabsSDK {
    username;
    password;
    endpoint = "https://realtime.oxylabs.io/v1/queries";
    rateLimitDelay = 3000;
    lastRequestTime = 0;
    constructor(username, password) {
        this.username = username;
        this.password = password;
    }
    async searchBusinesses(query, location, limit = 10) {
        if (!this.username.trim())
            return "Oxylabs username is required";
        if (!this.password.trim())
            return "Oxylabs password is required";
        if (!query.trim() || !location.trim())
            return "Query and location are required";
        const domains = await this.findDomains(query, location, limit);
        if (!domains.length)
            return "No business domains found";
        const leads = [];
        for (let i = 0; i < domains.length; i++) {
            if (i > 0)
                await this.enforceRateLimit();
            try {
                const lead = await this.enrichLead(domains[i], location);
                if (this.isValidLead(lead))
                    leads.push(lead);
            }
            catch (error) {
                console.warn(`Failed to enrich ${domains[i].domain}: ${error}`);
            }
        }
        return leads.length ? leads : `No valid leads from ${domains.length} domains`;
    }
    async enforceRateLimit() {
        const now = Date.now();
        const delay = this.rateLimitDelay - (now - this.lastRequestTime);
        if (delay > 0)
            await new Promise(resolve => setTimeout(resolve, delay));
        this.lastRequestTime = Date.now();
    }
    isValidLead(lead) {
        return Boolean(lead.company?.trim() && (lead.email?.trim() || lead.phone?.trim()));
    }
    async enrichLead(domain, location) {
        let phone = "", email = "";
        if (domain.website) {
            try {
                const contacts = await this.scrapeContactsFromDomain(domain.website);
                phone = contacts.phone;
                email = contacts.email;
            }
            catch (error) {
                const fallback = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(domain.website);
                phone = fallback.phone || "";
                email = fallback.email || "";
            }
        }
        return { company: domain.company, address: location, phone, email, website: domain.website };
    }
    async findDomains(query, location, limit) {
        const searchQuery = `${query} ${location} -site:facebook.com -site:linkedin.com -site:yelp.com`;
        const domains = await this.scrapeGoogleSearch(searchQuery);
        if (!domains.length)
            return this.generateFallbackDomains(query, location, Math.min(limit, 5));
        const uniqueDomains = new Set();
        return domains.filter(d => {
            if (uniqueDomains.size >= limit || uniqueDomains.has(d.domain))
                return false;
            uniqueDomains.add(d.domain);
            return true;
        });
    }
    async scrapeGoogleSearch(query) {
        try {
            const payload = {
                source: "google",
                query,
                pages: 1,
                parse: true,
                context: [{ key: "results_language", value: "en" }]
            };
            const content = await this.makeOxylabsRequest(payload);
            if (!content?.organic)
                return [];
            return content.organic
                .filter((r) => r.url)
                .map((r) => {
                const url = new URL(r.url);
                const domain = url.hostname.replace("www.", "");
                return { domain, company: r.title || this.extractCompanyName(domain), website: r.url };
            })
                .filter((d) => this.isValidDomain(d.domain));
        }
        catch (error) {
            console.warn(`Google scrape failed: ${error}`);
            return [];
        }
    }
    async scrapeContactsFromDomain(website) {
        try {
            const payload = {
                source: "universal",
                url: website,
                parse: true,
                parsing_instructions: {
                    phone: { _fns: [{ _fn: "xpath", _args: ["//text()[contains(., 'phone') or contains(., 'call') or contains(., 'tel')]"] }] },
                    email: { _fns: [{ _fn: "xpath", _args: ["//text()[contains(., '@') and contains(., '.com')]"] }] }
                }
            };
            const content = await this.makeOxylabsRequest(payload);
            return {
                phone: content?.phone?.[0] || "",
                email: content?.email?.[0] || ""
            };
        }
        catch (error) {
            console.warn(`Contact scrape failed for ${website}: ${error}`);
            return { phone: "", email: "" };
        }
    }
    async makeOxylabsRequest(payload) {
        await this.enforceRateLimit();
        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            if (response.status === 401)
                throw new Error("Invalid credentials");
            if (response.status === 403)
                throw new Error("Access denied or quota exceeded");
            throw new Error(`API failed: ${response.status}`);
        }
        const data = await response.json();
        if (!data.results?.length)
            throw new Error("No results");
        return data.results[0].content;
    }
    generateFallbackDomains(query, location, limit) {
        const q = query.toLowerCase().replace(/\s+/g, '');
        const l = location.toLowerCase().replace(/\s+/g, '');
        return [
            `${q}${l}.com`, `${l}${q}.com`, `best${q}${l}.com`, `${q}.${l}.com`, `local${q}.com`
        ].slice(0, limit).map(d => ({ domain: d, company: this.extractCompanyName(d), website: `https://${d}` }));
    }
    isValidDomain(domain) {
        const exclude = ['google', 'facebook', 'youtube', 'twitter', 'instagram', 'linkedin', 'yelp', 'yellowpages', 'foursquare', 'tripadvisor', 'reddit', 'wikipedia', 'craigslist', 'amazon', 'ebay'];
        return !exclude.some(p => domain.includes(p)) && domain.includes('.') && domain.length > 4 && domain.length < 50;
    }
    extractCompanyName(domain) {
        return domain.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).trim();
    }
}
exports.OxylabsSDK = OxylabsSDK;
