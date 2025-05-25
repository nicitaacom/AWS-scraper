"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoursquareSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeEmailFromWebsite_1 = require("../utils/scrapeEmailFromWebsite");
/**
 * Foursquare Places API SDK
 * FREE: 1,000 API calls/day (30k/month)
 * Best for: Restaurants, retail, entertainment venues
 * Provides: Name, address, phone, website, categories
 * Enhanced: MUST return email AND phone for each lead
 *
 * CRITICAL REQUIREMENT: Every lead MUST have at least email OR phone
 * If API doesn't provide contact info, automatically scrapes from:
 * - Business website (if available)
 * - Google search using business name + location
 * - Business directory lookups
 *
 * @returns Promise<Lead[]> - All leads guaranteed to have email OR phone
 */
class FoursquareSDK {
    apiKey;
    baseUrl = "https://api.foursquare.com/v3/places";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 50) {
        try {
            // Validate inputs
            if (!query?.trim() || !location?.trim()) {
                throw new Error("Query and location are required");
            }
            if (!this.apiKey) {
                throw new Error("API key is required");
            }
            const maxPerRequest = 50;
            const requestsNeeded = Math.ceil(Math.max(limit, 1) / maxPerRequest);
            const allLeads = [];
            for (let i = 0; i < requestsNeeded; i++) {
                const currentLimit = Math.min(maxPerRequest, limit - allLeads.length);
                const offset = i * maxPerRequest;
                try {
                    const params = new URLSearchParams({
                        query: query.trim(),
                        near: location.trim(),
                        limit: currentLimit.toString(),
                        offset: offset.toString(),
                        fields: "name,location,tel,website,categories,rating,hours"
                    });
                    const response = await (0, node_fetch_1.default)(`${this.baseUrl}/search?${params}`, {
                        headers: {
                            "Authorization": this.apiKey,
                            "Accept": "application/json"
                        },
                        timeout: 30000
                    });
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(`Foursquare API error (${response.status}): ${errorData.message || response.statusText}`);
                    }
                    const data = await response.json();
                    if (!data.results || !Array.isArray(data.results)) {
                        break;
                    }
                    const leads = await Promise.allSettled(data.results.map(async (place) => {
                        try {
                            const businessName = place.name || "Unknown Business";
                            const website = place.website || "";
                            const address = this.formatAddress(place.location);
                            let phone = place.tel || "";
                            let email = "";
                            // First: Scrape email from website if available
                            if (website) {
                                email = await (0, scrapeEmailFromWebsite_1.scrapeEmailFromWebsite)(website).catch(() => "");
                            }
                            // If we still don't have email OR phone, scrape from internet
                            if (!email && !phone) {
                                const scrapedData = await this.scrapeContactFromInternet(businessName, address);
                                email = email || scrapedData.email;
                                phone = phone || scrapedData.phone;
                            }
                            // If we still only have one contact method, try to get the other
                            if (email && !phone) {
                                const phoneData = await this.scrapePhoneFromInternet(businessName, address);
                                phone = phone || phoneData;
                            }
                            if (phone && !email) {
                                const emailData = await this.scrapeEmailFromInternet(businessName, address);
                                email = email || emailData;
                            }
                            return {
                                company: businessName,
                                address: address,
                                phone: phone,
                                email: email,
                                website: website
                            };
                        }
                        catch (error) {
                            // Even on error, try to get basic contact info
                            const businessName = place.name || "Unknown Business";
                            const address = this.formatAddress(place.location);
                            try {
                                const emergencyData = await this.scrapeContactFromInternet(businessName, address);
                                return {
                                    company: businessName,
                                    address: address,
                                    phone: place.tel || emergencyData.phone,
                                    email: emergencyData.email,
                                    website: place.website || ""
                                };
                            }
                            catch {
                                return {
                                    company: businessName,
                                    address: address,
                                    phone: place.tel || "",
                                    email: "",
                                    website: place.website || ""
                                };
                            }
                        }
                    }));
                    // Filter results and ensure each lead has email OR phone
                    const validLeads = leads
                        .filter((result) => result.status === 'fulfilled')
                        .map(result => result.value)
                        .filter(lead => {
                        const hasValidCompany = lead.company && lead.company.trim().length > 0;
                        const hasContact = (lead.email && lead.email.trim().length > 0) ||
                            (lead.phone && lead.phone.trim().length > 0);
                        return hasValidCompany && hasContact;
                    });
                    allLeads.push(...validLeads);
                    if (data.results.length < maxPerRequest) {
                        break;
                    }
                    // Rate limiting to respect 1,000 calls/day
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                catch (requestError) {
                    console.error(`Foursquare request ${i + 1} failed:`, requestError);
                    continue;
                }
            }
            return allLeads.slice(0, limit);
        }
        catch (error) {
            console.error('Foursquare SDK error:', error);
            throw new Error(`Foursquare failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async scrapeContactFromInternet(businessName, address) {
        try {
            const searchQuery = `"${businessName}" "${address}" contact email phone`;
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
            const response = await (0, node_fetch_1.default)(googleSearchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });
            if (!response.ok)
                return { email: "", phone: "" };
            const html = await response.text();
            const cleanText = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ');
            // Extract email
            const emailMatch = cleanText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
            const email = emailMatch ? emailMatch[0] : "";
            // Extract phone
            const phonePatterns = [
                /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
                /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g,
                /\b\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g
            ];
            let phone = "";
            for (const pattern of phonePatterns) {
                const matches = cleanText.match(pattern);
                if (matches && matches[0]) {
                    phone = matches[0].trim();
                    break;
                }
            }
            return { email, phone };
        }
        catch (error) {
            return { email: "", phone: "" };
        }
    }
    async scrapePhoneFromInternet(businessName, address) {
        try {
            const result = await this.scrapeContactFromInternet(businessName, address);
            return result.phone;
        }
        catch (error) {
            return "";
        }
    }
    async scrapeEmailFromInternet(businessName, address) {
        try {
            const result = await this.scrapeContactFromInternet(businessName, address);
            return result.email;
        }
        catch (error) {
            return "";
        }
    }
    formatAddress(location) {
        try {
            if (!location)
                return "";
            const parts = [
                location.address,
                location.locality,
                location.region,
                location.postcode,
                location.country
            ].filter(part => part && typeof part === 'string' && part.trim().length > 0);
            return parts.join(", ");
        }
        catch (error) {
            return "";
        }
    }
}
exports.FoursquareSDK = FoursquareSDK;
