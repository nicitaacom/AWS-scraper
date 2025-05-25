"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PuppeteerGoogleMapsSDK = void 0;
const puppeteer_1 = __importDefault(require("puppeteer"));
const node_fetch_1 = __importDefault(require("node-fetch"));
class PuppeteerGoogleMapsSDK {
    userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
    ];
    proxyList = [];
    constructor() { this.initProxyList(); }
    // 🔐 Step 1: Fetch proxy list (TS-safe)
    async initProxyList() {
        try {
            const res = await (0, node_fetch_1.default)("https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=1000&country=all&ssl=all&anonymity=all");
            const raw = await res.text();
            this.proxyList = raw.split("\n").map(p => p.trim()).filter(p => p.length > 0);
        }
        catch (error) {
            console.error("Failed to fetch proxies:", error instanceof Error ? error.message : String(error));
        }
    }
    /**
     * Search for businesses on Google Maps
     * @param query Search term
     * @param location Search location
     * @param limit Max number of leads
     */
    async searchBusinesses(query, location, limit = 20) {
        const browser = await this.launchBrowser();
        try {
            const page = await this.setupPage(browser);
            const url = `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${location}`)}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForSelector('[data-result-index]', { timeout: 15000 });
            await this.scrollToLoadResults(page, limit);
            const leads = await this.extractLeads(page, limit);
            if (!leads.length)
                return "No businesses found for the given query.";
            if (leads.length < limit)
                return `Expected ${limit} results but got ${leads.length}`;
            return leads;
        }
        catch (error) {
            return `Google Maps scraping failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        finally {
            await browser.close();
        }
    }
    // ⚙️ Launch headless browser w/ optional proxy
    async launchBrowser() {
        const proxyArg = this.proxyList.length
            ? `--proxy-server=${this.proxyList[Math.floor(Math.random() * this.proxyList.length)]}`
            : "";
        const baseArgs = '--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-zygote --single-process --disable-features=VizDisplayCompositor'.split(' ');
        return puppeteer_1.default.launch({ headless: true, args: proxyArg ? [...baseArgs, proxyArg] : baseArgs });
    }
    // 🧱 Setup new page with UA spoof + req blocking
    async setupPage(browser) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent(this.userAgents[Math.floor(Math.random() * this.userAgents.length)]);
        await page.setRequestInterception(true);
        page.on('request', req => ['stylesheet', 'image'].includes(req.resourceType()) ? req.abort() : req.continue());
        return page;
    }
    // 🔁 Scroll down till we hit desired result count or max tries
    async scrollToLoadResults(page, limit) {
        let curr = 0, prev = 0, tries = 0, max = Math.ceil(limit / 10);
        while (curr < limit && tries < max) {
            await page.evaluate(() => {
                const p = document.querySelector('[role="main"]');
                p ? p.scrollTop = p.scrollHeight : window.scrollTo(0, document.body.scrollHeight);
            });
            await this.delay(3000);
            curr = (await page.$$('[data-result-index]')).length;
            console.log(`Scroll: found ${curr}`);
            tries = curr === prev ? tries + 1 : 0;
            prev = curr;
        }
    }
    // 🔍 Extract company, phone, email, etc from result cards
    async extractLeads(page, limit) {
        const raw = await page.evaluate((mx) => {
            const getText = (el, selectors, filter) => {
                for (const sel of selectors) {
                    const nodes = Array.from(el.querySelectorAll(sel));
                    for (const node of nodes) {
                        const txt = node.textContent?.trim() ?? "";
                        if (txt && (!filter || filter(txt)))
                            return txt;
                    }
                }
                return "";
            };
            const items = Array.from(document.querySelectorAll('[data-result-index]')).slice(0, mx);
            return items.map(el => {
                try {
                    const company = getText(el, ['h3', '.qBF1Pd', '.fontHeadlineSmall']);
                    if (!company)
                        return null;
                    const address = getText(el, ['.W4Efsd span', '.Y7abQ'], t => !t.includes('★'));
                    const phone = getText(el, ['button[data-tooltip="Copy phone number"]', '.W4Efsd span'], t => /[\d\-\(\)\+\s]{10,}/.test(t));
                    const mailEl = el.querySelector('a[href^="mailto:"]');
                    const email = mailEl?.href.replace('mailto:', '') ?? "";
                    const website = el.querySelector('a[href*="http"]:not([href*="google.com"])')?.href ?? "";
                    return { company, address, phone, email, website, source: "GoogleMaps" };
                }
                catch {
                    return null;
                }
            });
        }, limit);
        // ✅ Filter out nulls (no lodash)
        return raw.filter((lead) => lead !== null);
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.PuppeteerGoogleMapsSDK = PuppeteerGoogleMapsSDK;
