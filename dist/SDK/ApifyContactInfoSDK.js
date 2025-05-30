"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApifyContactInfoSDK = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
/**
 * Apify Contact Info Scraper SDK
 * FREE: Yes (no credit card required)
 * Best for: Extracting contact information from websites
 * Provides: Emails, phone numbers, social media profiles
 *
 * Public methods: searchBusinesses
 * All other methods are private utilities
 */
class ApifyContactInfoSDK {
    apiToken;
    actorId = "vdrmota/contact-info-scraper";
    endpoint = "https://api.apify.com/v2";
    constructor(apiToken) {
        this.apiToken = apiToken;
        if (!apiToken)
            throw new Error("Apify API token is required");
    }
    /**
     * Search for businesses by scraping contact information from websites
     */
    async searchBusinesses(urls, limit = 10) {
        if (!Array.isArray(urls) || urls.length === 0) {
            return "URLs array is required";
        }
        try {
            // 1. Prepare input for the Apify actor
            const input = {
                startUrls: urls.map((url) => ({ url })),
                maxDepth: 1,
                maxPagesPerStartUrl: 1,
                proxy: {
                    useApifyProxy: true,
                },
            };
            // 2. Start the actor run
            const runResponse = await (0, node_fetch_1.default)(`${this.endpoint}/acts/${this.actorId}/runs?token=${this.apiToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input }),
            });
            if (!runResponse.ok) {
                const errorText = await runResponse.text().catch(() => runResponse.statusText);
                return `Apify run start failed: ${errorText}`;
            }
            const runData = await runResponse.json();
            const runId = runData.data.id;
            // 3. Wait for the actor run to finish
            let runStatus = "RUNNING";
            while (runStatus === "RUNNING" || runStatus === "READY") {
                await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds
                const statusResponse = await (0, node_fetch_1.default)(`${this.endpoint}/actor-runs/${runId}?token=${this.apiToken}`);
                const statusData = await statusResponse.json();
                runStatus = statusData.data.status;
            }
            if (runStatus !== "SUCCEEDED") {
                return `Apify actor run failed with status: ${runStatus}`;
            }
            // 4. Fetch the dataset items
            const datasetResponse = await (0, node_fetch_1.default)(`${this.endpoint}/actor-runs/${runId}/dataset/items?token=${this.apiToken}&format=json`);
            if (!datasetResponse.ok) {
                const errorText = await datasetResponse.text().catch(() => datasetResponse.statusText);
                return `Failed to fetch dataset items: ${errorText}`;
            }
            const items = await datasetResponse.json();
            // 5. Process results into leads
            const leads = items.slice(0, limit).map((item) => ({
                company: this.extractCompanyName(item.url),
                address: "", // Address not provided by this scraper
                phone: item.phone || "",
                email: item.email || "",
                website: item.url || "",
            }));
            return leads.length > 0
                ? leads
                : "No valid business results found from the provided URLs";
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("ApifyContactInfoSDK searchBusinesses failed:", errorMessage);
            return `ApifyContactInfoSDK request failed: ${errorMessage}`;
        }
    }
    extractCompanyName(url) {
        try {
            const hostname = new URL(url).hostname;
            const parts = hostname.split(".");
            if (parts.length >= 2) {
                return parts[parts.length - 2];
            }
            return hostname;
        }
        catch {
            return "";
        }
    }
}
exports.ApifyContactInfoSDK = ApifyContactInfoSDK;
