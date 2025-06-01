"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RapidSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * RapidAPI Web Scraper SDK
 * FREE: Varies by plan (check RapidAPI dashboard)
 * Best for: Scraping business information from websites
 * Enhanced: Uses web scraping to find contact information
 */
class RapidSDK {
    baseUrl = "https://web-scraper-headless.p.rapidapi.com";
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 50) {
        if (!query?.trim())
            return "Query parameter is required";
        if (!location?.trim())
            return "Location parameter is required";
        if (limit > 100)
            return "Recommended limit is 100 for performance";
        if (limit < 1)
            return "Limit must be at least 1";
        try {
            const searchQuery = `"${query}" "${location}" contact phone email website`;
            const searchResults = await this.scrapeSearchResults(searchQuery, limit);
            if (typeof searchResults === "string")
                return searchResults;
            const leads = await Promise.all(searchResults.slice(0, limit).map(async (result) => {
                const company = this.extractCompanyName(result.title || "", query);
                const website = result.url || "";
                let email = result.email || "";
                let phone = result.phone || "";
                // Scrape website for missing contact info
                if (website && (!email || !phone)) {
                    try {
                        const contacts = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website);
                        email = email || contacts.email;
                        phone = phone || contacts.phone;
                    }
                    catch (error) {
                        // Continue on scrape failure
                    }
                }
                // Extract from content if still missing
                if ((!email || !phone) && result.content) {
                    const extracted = this.extractContactsFromContent(result.content);
                    email = email || extracted.email;
                    phone = phone || extracted.phone;
                }
                return {
                    company: company || "Unknown Business",
                    address: result.address || location,
                    phone: this.cleanPhone(phone),
                    email: email.toLowerCase().trim(),
                    website: website
                };
            }));
            const validLeads = leads.filter((lead) => lead.company &&
                lead.company !== "Unknown Business" &&
                (lead.email.trim() || lead.phone.trim()));
            return validLeads.length > 0 ? validLeads : `No valid businesses found for "${query}" in "${location}"`;
        }
        catch (error) {
            return `RapidAPI scraping failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    async scrapeSearchResults(searchQuery, limit) {
        try {
            const response = await (0, node_fetch_1.default)(`${this.baseUrl}/scrape`, {
                method: 'POST',
                headers: {
                    'X-RapidAPI-Key': this.apiKey,
                    'X-RapidAPI-Host': 'web-scraper-headless.p.rapidapi.com',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&num=${Math.min(limit * 2, 50)}`,
                    selector: '.g',
                    extract: {
                        title: 'h3',
                        url: 'a @href',
                        snippet: '.VwiC3b'
                    }
                })
            });
            if (!response.ok) {
                return `RapidAPI HTTP ${response.status}: ${response.statusText}`;
            }
            const data = await response.json();
            if (!data.results || !Array.isArray(data.results)) {
                return "No search results found";
            }
            return data.results.map((item) => ({
                url: this.cleanUrl(item.url),
                title: item.title,
                content: item.snippet,
                email: this.extractEmailFromText(item.snippet || ""),
                phone: this.extractPhoneFromText(item.snippet || "")
            })).filter((item) => item.url && item.title);
        }
        catch (error) {
            return `RapidAPI request failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    extractCompanyName(title, query) {
        if (!title)
            return "";
        let company = title
            .replace(/\s*-\s*(Google|Yelp|Facebook|LinkedIn).*$/i, "")
            .replace(/^(About|Contact|Home)\s*-\s*/i, "")
            .trim();
        if (company.length < 3 || company.toLowerCase().includes("search")) {
            const queryWords = query.split(" ").filter(word => word.length > 2);
            company = queryWords.length > 0 ? queryWords.join(" ") : company;
        }
        return company;
    }
    extractContactsFromContent(content) {
        return {
            email: this.extractEmailFromText(content),
            phone: this.extractPhoneFromText(content)
        };
    }
    extractEmailFromText(text) {
        const match = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
        return match ? match[0] : "";
    }
    extractPhoneFromText(text) {
        const matches = text.match(/\b\+?[\d\s\-\(\)\.]{10,}\b/g);
        if (matches) {
            for (const match of matches) {
                const cleaned = this.cleanPhone(match);
                if (cleaned.length >= 10)
                    return match.trim();
            }
        }
        return "";
    }
    cleanPhone(phone) {
        return phone.replace(/[^\d]/g, "");
    }
    cleanUrl(url) {
        if (!url)
            return "";
        if (url.includes('/url?q=')) {
            const match = url.match(/[?&]q=([^&]+)/);
            if (match)
                return decodeURIComponent(match[1]);
        }
        return url;
    }
}
exports.RapidSDK = RapidSDK;
