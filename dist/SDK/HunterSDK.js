"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HunterSDK = void 0;
/**
 * Hunter.io Email Finder SDK
 * ✅ FREE Plan: 25 searches/month
 * ✅ Rate Limit: 15 requests/second
 * ✅ Use case: Enrich business domains with email & phone info
 * If error returns string wtih error message
 */
class HunterSDK {
    apiKey;
    endpoint = "https://api.hunter.io/v2";
    maxFreeRequests = 25;
    rateLimitDelay = 1000 / 15; // 🕒 15 req/sec
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 10) {
        if (limit > this.maxFreeRequests)
            return `Limit exceeds free tier maximum of ${this.maxFreeRequests}/month`;
        try {
            const domains = await this.findDomains(query, location, limit);
            const leads = [];
            for (const domain of domains) {
                const lead = await this.enrichLead(domain, location);
                leads.push(lead);
                await this.delay(this.rateLimitDelay); // 🧘 throttle for Hunter rate limit
            }
            return leads.filter(lead => lead.company);
        }
        catch (error) {
            return `Hunter.io failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async enrichLead(domain, location) {
        const [emailResult, phone] = await Promise.all([
            this.findEmails(domain.domain),
            this.scrapePhone(domain.website)
        ]);
        const email = typeof emailResult === "string" ? "" : emailResult[0] || "";
        return {
            company: domain.company,
            address: location,
            phone,
            email,
            website: domain.website
        };
    }
    async findDomains(query, location, limit) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} ${location} site:`)}`;
        const response = await fetch(searchUrl);
        if (!response.ok)
            throw new Error(`Failed to fetch search results: ${response.status} - ${response.statusText}`);
        const html = await response.text();
        return this.extractDomainsFromHtml(html, limit);
    }
    extractDomainsFromHtml(html, limit) {
        const domains = [];
        const urlPattern = /https?:\/\/([^\/\s"']+)/gi;
        let match;
        while ((match = urlPattern.exec(html)) && domains.length < limit) {
            const fullDomain = match[1];
            const cleanDomain = fullDomain.replace("www.", "");
            if (!this.isValidDomain(cleanDomain))
                continue;
            domains.push({
                domain: cleanDomain,
                company: this.extractCompanyName(cleanDomain),
                website: `https://${fullDomain}`
            });
        }
        return domains;
    }
    isValidDomain(domain) {
        return !domain.includes("google") && !domain.includes("facebook");
    }
    extractCompanyName(domain) {
        return domain.split(".")[0];
    }
    async findEmails(domain) {
        try {
            const url = `${this.endpoint}/domain-search?domain=${domain}&api_key=${this.apiKey}&limit=1`;
            const response = await fetch(url);
            if (!response.ok)
                return `Hunter API request failed: ${response.status} - ${response.statusText}`;
            const data = await response.json();
            return data.data?.emails?.map((e) => e.value) || [];
        }
        catch (error) {
            return `Hunter fetch failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async scrapePhone(site) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(site, { signal: controller.signal });
            clearTimeout(timeout);
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
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.HunterSDK = HunterSDK;
