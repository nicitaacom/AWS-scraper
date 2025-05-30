"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoursquareSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
/**
 * Foursquare Places API SDK
 * FREE: 1,000 API calls/day (30k/month)
 * Best for: Restaurants, retail, entertainment venues
 * Provides: Name, address, phone, website, categories
 * Enhanced: MUST return email AND phone for each lead
 * If error returns string wtih error message
 *
 * CRITICAL REQUIREMENT: Every lead MUST have at least email OR phone
 * If API doesn't provide contact info, automatically scrapes from:
 * - Business website (if available)
 * - Google search using business name + location
 * - Business directory lookups
 *
 * @returns Promise<Lead[]> - All leads guaranteed to have email OR phone
 * @example
 * const sdk = new FoursquareSDK("FS_API_KEY")
 * const leads = await sdk.searchBusinesses(
 *   "coffee shop",
 *   "24783, Osterrönfeld, Germany",
 *   20
 * )
 */
class FoursquareSDK {
    apiKey;
    baseUrl = "https://api.foursquare.com/v3/places";
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async searchBusinesses(query, location, limit = 50) {
        if (!query.trim() || !location.trim())
            throw new Error("Query and location are required");
        if (!this.apiKey)
            throw new Error("API key is required");
        const maxPerRequest = 50;
        const requestsNeeded = Math.ceil(Math.max(limit, 1) / maxPerRequest);
        const allLeads = [];
        for (let i = 0; i < requestsNeeded; i++) {
            const currentLimit = Math.min(maxPerRequest, limit - allLeads.length);
            const offset = i * maxPerRequest;
            try {
                // 🔍 Attempt text-based search
                let url = `${this.baseUrl}/search?` + new URLSearchParams({
                    query: query.trim(),
                    near: location.trim(),
                    limit: currentLimit.toString(),
                    offset: offset.toString(),
                    fields: "name,location,tel,website,categories,rating,hours"
                }).toString();
                let response = await (0, node_fetch_1.default)(url, { headers: { Authorization: this.apiKey, Accept: "application/json" } });
                let data = await response.json().catch(() => ({}));
                // 🌐 Fallback: geocode location if no results
                if ((!data.results || data.results.length === 0) && location.trim()) {
                    const geo = await this.geocodeLocation(location.trim());
                    if (geo) {
                        url = `${this.baseUrl}/search?` + new URLSearchParams({
                            query: query.trim(),
                            ll: `${geo.lat},${geo.lon}`,
                            limit: currentLimit.toString(),
                            offset: offset.toString(),
                            fields: "name,location,tel,website,categories,rating,hours"
                        }).toString();
                        response = await (0, node_fetch_1.default)(url, { headers: { Authorization: this.apiKey, Accept: "application/json" } });
                        data = await response.json().catch(() => ({}));
                    }
                }
                if (!response.ok) {
                    const err = data.message || response.statusText;
                    throw new Error(`Foursquare API error (${response.status}): ${err}`);
                }
                const leads = await Promise.allSettled(data.results.map(async (place) => {
                    // 🔧 Build base lead
                    const company = place.name || "Unknown Business";
                    const website = place.website || "";
                    const address = this.formatAddress(place.location);
                    let phone = place.tel || "";
                    let email = "";
                    // 🕸️ Scrape website for email
                    email = website ? (await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website)).email : "";
                    phone = website ? (await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(website)).phone : "";
                    // 🌍 Scrape internet if no contact
                    if (!email && !phone) {
                        const e = await this.scrapeContactFromInternet(company, address);
                        email = email || e.email;
                        phone = phone || e.phone;
                    }
                    // 📞 or 📧 try other method
                    if (email && !phone)
                        phone = await this.scrapePhoneFromInternet(company, address);
                    if (phone && !email)
                        email = await this.scrapeEmailFromInternet(company, address);
                    return { company, address, phone, email, website };
                }));
                // ✅ Filter valid leads
                allLeads.push(...leads
                    .filter((r) => r.status === "fulfilled")
                    .map(r => r.value)
                    .filter(l => (l.email.trim() || l.phone.trim()) && l.company.trim()));
                // 🛑 Stop if results < batch size
                if (data.results.length < maxPerRequest)
                    break;
                // ⏱️ rate limit
                await new Promise(res => setTimeout(res, 200));
            }
            catch {
                continue;
            }
        }
        return allLeads.slice(0, limit);
    }
    /**
     * Convert a free-form location string into lat/lng via OSM Nominatim
     * @param location - e.g. "24783, Osterrönfeld, Germany"
     * @returns { lat: string, lon: string } or null
     */
    async geocodeLocation(location) {
        const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
            q: location,
            format: "json",
            limit: "1"
        }).toString();
        const res = await (0, node_fetch_1.default)(url, { headers: { "User-Agent": "MyApp/1.0" } });
        if (!res.ok)
            return null;
        const [first] = (await res.json());
        return first ? { lat: first.lat, lon: first.lon } : null;
    }
    formatAddress(location) {
        const parts = [
            location.address,
            location.locality,
            location.region,
            location.postcode,
            location.country
        ].filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim());
        return parts.join(", ");
    }
    async scrapeContactFromInternet(b, a) {
        try {
            const q = `"${b}" "${a}" contact email phone`;
            const r = await (0, node_fetch_1.default)("https://www.google.com/search?q=" + encodeURIComponent(q), {
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            if (!r.ok)
                return { email: "", phone: "" };
            const t = (await r.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
            const e = t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0] || "";
            const p = (t.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/) || [])[0] || "";
            return { email: e, phone: p };
        }
        catch {
            return { email: "", phone: "" };
        }
    }
    async scrapePhoneFromInternet(b, a) {
        const r = await this.scrapeContactFromInternet(b, a);
        return r.phone;
    }
    async scrapeEmailFromInternet(b, a) {
        const r = await this.scrapeContactFromInternet(b, a);
        return r.email;
    }
}
exports.FoursquareSDK = FoursquareSDK;
