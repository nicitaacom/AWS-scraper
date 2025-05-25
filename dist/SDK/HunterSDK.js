"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HunterSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * Hunter.io Email Finder SDK
 * FREE: 25 searches/month
 * Best for: Finding email addresses for businesses
 */
class HunterSDK {
    apiKey;
    endpoint = "https://api.hunter.io/v2";
    maxFreeRequests = 25;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 10) {
        if (limit > this.maxFreeRequests) {
            return `Limit exceeds free tier maximum of ${this.maxFreeRequests}/month`;
        }
        try {
            const domains = await this.findDomains(query, location, limit);
            const leads = await Promise.all(domains.map(domain => this.enrichLead(domain, location)));
            return leads.filter(lead => lead.company);
        }
        catch (error) {
            return `Hunter.io failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async enrichLead(domain, location) {
        const [emailData, phone] = await Promise.all([
            this.findEmails(domain.domain),
            this.scrapePhone(domain.website)
        ]);
        return {
            company: domain.company,
            address: location,
            phone,
            email: emailData.emails[0] || "",
            website: domain.website
        };
    }
    async findDomains(query, location, limit) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} ${location} site:`)}`;
        const response = await (0, node_fetch_1.default)(searchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch search results: ${response.status} - ${response.statusText}`);
        }
        const html = await response.text();
        return this.extractDomainsFromHtml(html, limit);
    }
    extractDomainsFromHtml(html, limit) {
        const domains = [];
        const urlPattern = /https?:\/\/([^\/\s"']+)/gi;
        let match;
        while ((match = urlPattern.exec(html)) && domains.length < limit) {
            const fullDomain = match[1];
            const cleanDomain = fullDomain.replace('www.', '');
            if (this.isValidDomain(cleanDomain)) {
                domains.push({
                    domain: cleanDomain,
                    company: this.extractCompanyName(cleanDomain),
                    website: `https://${fullDomain}`
                });
            }
        }
        return domains;
    }
    isValidDomain(domain) {
        return !domain.includes('google') && !domain.includes('facebook');
    }
    extractCompanyName(domain) {
        return domain.split('.')[0];
    }
    async findEmails(domain) {
        try {
            const url = `${this.endpoint}/domain-search?domain=${domain}&api_key=${this.apiKey}&limit=1`;
            const response = await (0, node_fetch_1.default)(url);
            if (!response.ok) {
                throw new Error(`Hunter API request failed: ${response.status} - ${response.statusText}`);
            }
            const data = await response.json();
            const emails = data.data?.emails?.map((e) => e.value) || [];
            return { emails };
        }
        catch (error) {
            return { emails: [] };
        }
    }
    async scrapePhone(site) {
        try {
            const response = await (0, node_fetch_1.default)(site, { timeout: 5000 });
            if (!response.ok)
                return "";
            const text = await response.text();
            const cleanText = text.replace(/<[^>]*>/g, " ");
            const phoneMatch = cleanText.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
            return phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "") : "";
        }
        catch {
            return "";
        }
    }
}
exports.HunterSDK = HunterSDK;
