"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
    userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
    ];
    proxyList = [];
    constructor() {
        this.initProxyList();
    }
    // 🔐 Step 1: Fetch proxy list with fallback
    async initProxyList() {
        try {
            const res = await (0, node_fetch_1.default)("https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=1000&country=all&ssl=all&anonymity=all", {
                timeout: 10000
            });
            const raw = await res.text();
            this.proxyList = raw.split("\n").map(p => p.trim()).filter(Boolean);
            console.log(`📡 Loaded ${this.proxyList.length} proxies`);
        }
        catch (err) {
            console.warn("⚠️ Failed to fetch proxies:", err instanceof Error ? err.message : String(err));
            this.proxyList = [];
        }
    }
    async searchBusinesses(query, location, limit = 20) {
        const browser = await this.launchBrowser();
        try {
            const page = await this.setupPage(browser);
            const url = `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${location}`)}`;
            console.log(`🔍 Searching: ${query} in ${location}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.waitForResults(page);
            await this.scrollToLoadResults(page, limit);
            let leads = await this.extractLeads(page, limit);
            console.log(`📋 Extracted ${leads.length} initial leads`);
            leads = await this.enrichLeadsWithContactInfo(leads, browser);
            const validLeads = leads.filter(lead => lead.email || lead.phone);
            return !validLeads.length
                ? "No businesses found with contact information for the given query."
                : validLeads.length < Math.min(limit, 10)
                    ? (console.warn(`⚠️ Expected ${limit} results but got ${validLeads.length} with contact info`), validLeads)
                    : validLeads;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("❌ Google Maps scraping failed:", msg);
            return `Google Maps scraping failed: ${msg}`;
        }
        finally {
            await browser.close();
        }
    }
    // 🕐 Wait for results with multiple strategies
    async waitForResults(page) {
        const selectors = [
            '[data-result-index]',
            '.Nv2PK',
            '[jsaction*="pane"]',
            '.section-result'
        ];
        let found = false;
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 15000 });
                found = true;
                break;
            }
            catch (e) {
                continue;
            }
        }
        if (!found) {
            throw new Error("No search results found on Google Maps");
        }
    }
    // 1️⃣ Launch headless browser with retry & SOLID helpers
    async launchBrowser() {
        const retries = 3;
        for (let i = 0; i < retries; i++) {
            try {
                const args = this.buildLaunchArgs();
            
            }
            catch (err) {
                if (i === retries - 1)
                    throw err;
                console.warn(`Launch attempt ${i + 1} failed, retrying…`);
                await this.delay(2_000);
            }
        }
        throw new Error("Failed to launch browser after multiple attempts");
    }
    // 2️⃣ Build launch args (single responsibility)
    buildLaunchArgs() {
        const base = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-zygote",
            "--disable-extensions",
            "--disable-plugins",
            "--disable-features=VizDisplayCompositor"
        ];
        return this.shouldUseProxy()
            ? [...base, `--proxy-server=${this.getRandomProxy()}`]
            : base;
    }
    // 3️⃣ Decide if we inject a proxy
    shouldUseProxy() {
        return this.proxyList.length > 0 && Math.random() > 0.5;
    }
    // 4️⃣ Pick a random proxy
    getRandomProxy() {
        return this.proxyList[Math.floor(Math.random() * this.proxyList.length)];
    }
    // 5️⃣ Simple delay helper
    delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }
    // 🔍 Setup new page: viewport, UA, blocking & headers
    async setupPage(browser) {
        const page = await browser.newPage();
        await Promise.all([
            page.setViewport({ width: 1366, height: 768 }),
            page.setUserAgent(this.getRandomUserAgent()),
            page.setRequestInterception(true)
        ]);
        page.on("request", req => this.handleRequest(req));
        await page.setExtraHTTPHeaders(this.getExtraHeaders());
        return page;
    }
    // 6️⃣ Get random UA (SRP)
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }
    // 7️⃣ Decide which requests to block
    handleRequest(req) {
        const block = ["stylesheet", "image", "font", "media"];
        const url = req.url();
        if (block.includes(req.resourceType()) ||
            /google-analytics|googletagmanager|doubleclick/.test(url)) {
            req.abort();
        }
        else
            req.continue();
    }
    // 8️⃣ Centralize extra headers
    getExtraHeaders() {
        return {
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        };
    }
    // 🔁 Enhanced scrolling with dynamic detection
    async scrollToLoadResults(page, limit) {
        let curr = 0, prev = 0, tries = 0;
        const maxTries = Math.ceil(limit / 8) + 5; // More generous
        while (curr < limit && tries < maxTries) {
            // Multiple scroll strategies
            await page.evaluate(() => {
                const main = document.querySelector('[role="main"]');
                const feed = document.querySelector('[data-test-id="organic-list"]');
                const scrollable = main || feed || document.body;
                if (scrollable && 'scrollTop' in scrollable) {
                    scrollable.scrollTop = scrollable.scrollHeight;
                }
                else {
                    window.scrollTo(0, document.body.scrollHeight);
                }
            });
            await this.delay(2000 + Math.random() * 2000); // Random delay 2-4s
            // Count results with multiple selectors
            const counts = await Promise.all([
                page.$$('[data-result-index]').then(els => els.length),
                page.$$('.Nv2PK').then(els => els.length),
                page.$$('[jsaction*="pane.result"]').then(els => els.length)
            ]);
            curr = Math.max(...counts);
            console.log(`🔄 Scroll ${tries + 1}: found ${curr} results`);
            if (curr === prev) {
                tries++;
                // Try clicking "More results" button if available
                try {
                    await page.waitForSelector('button[jsaction*="more"]', { timeout: 1000 });
                    await page.click('button[jsaction*="more"]');
                    await this.delay(3000);
                }
                catch (e) {
                    // Button not found, continue
                }
            }
            else {
                tries = 0;
            }
            prev = curr;
        }
        console.log(`📊 Final result count: ${curr}`);
    }
    // 🔍 Enhanced lead extraction with multiple fallback strategies
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
            // Try multiple result selectors
            const resultSelectors = [
                '[data-result-index]',
                '.Nv2PK',
                '[jsaction*="pane.result"]',
                '.section-result'
            ];
            let items = [];
            for (const selector of resultSelectors) {
                items = Array.from(document.querySelectorAll(selector));
                if (items.length > 0)
                    break;
            }
            return items.slice(0, mx).map((el, index) => {
                try {
                    // Multiple strategies for company name
                    const company = getText(el, [
                        'h3',
                        '.qBF1Pd',
                        '.fontHeadlineSmall',
                        '[data-value="Name"]',
                        '.section-result-title'
                    ]);
                    if (!company)
                        return null;
                    // Enhanced address extraction
                    const address = getText(el, [
                        '.W4Efsd span:not([class*="star"])',
                        '.Y7abQ',
                        '[data-value="Address"]',
                        '.section-result-location'
                    ], t => !t.includes('★') && !t.includes('rating'));
                    // Enhanced phone extraction
                    const phone = getText(el, [
                        'button[data-tooltip="Copy phone number"]',
                        '[data-value="Phone"]',
                        'span[data-local-attribute="d3ph"]',
                        '.W4Efsd span'
                    ], t => /[\d\-\(\)\+\s]{10,}/.test(t));
                    // Email extraction
                    const mailEl = el.querySelector('a[href^="mailto:"]');
                    const email = mailEl?.href.replace('mailto:', '') ?? "";
                    // Enhanced website extraction
                    const websiteEl = el.querySelector('a[href*="http"]:not([href*="google.com"]):not([href*="maps"])');
                    const website = websiteEl?.href ?? "";
                    // Get business type/category
                    const category = getText(el, [
                        '.W4Efsd span:last-child',
                        '[data-value="Category"]'
                    ], t => !t.includes('★') && !t.includes('·') && !t.includes('rating'));
                    return {
                        company,
                        address,
                        phone,
                        email,
                        website,
                        category,
                        source: "GoogleMaps",
                        extractedAt: new Date().toISOString()
                    };
                }
                catch (error) {
                    console.log(`Error extracting lead ${index}:`, error);
                    return null;
                }
            });
        }, limit);
        return raw.filter((lead) => lead !== null);
    }
    // 🎯 CRITICAL: Enrich leads with contact information
    async enrichLeadsWithContactInfo(leads, browser) {
        const enrichedLeads = [];
        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            console.log(`🔍 Enriching lead ${i + 1}/${leads.length}: ${lead.company}`);
            let enrichedLead = { ...lead };
            // If already has both email and phone, skip enrichment
            if (lead.email && lead.phone) {
                enrichedLeads.push(enrichedLead);
                continue;
            }
            try {
                // Strategy 1: Scrape business website if available
                if (lead.website && !lead.email) {
                    console.log(`  📱 Checking website: ${lead.website}`);
                    const websiteContact = await this.scrapeWebsiteForContact(lead.website, browser);
                    if (websiteContact.email)
                        enrichedLead.email = websiteContact.email;
                    if (websiteContact.phone && !enrichedLead.phone)
                        enrichedLead.phone = websiteContact.phone;
                }
                // Strategy 2: Google search for contact info
                if (!enrichedLead.email || !enrichedLead.phone) {
                    console.log(`  🔍 Google search for: ${lead.company}`);
                    const googleContact = await this.googleSearchForContact(lead.company, lead.address, browser);
                    if (googleContact.email && !enrichedLead.email)
                        enrichedLead.email = googleContact.email;
                    if (googleContact.phone && !enrichedLead.phone)
                        enrichedLead.phone = googleContact.phone;
                    if (googleContact.website && !enrichedLead.website)
                        enrichedLead.website = googleContact.website;
                }
                // Strategy 3: Business directory lookup
                if (!enrichedLead.email || !enrichedLead.phone) {
                    console.log(`  📚 Directory search for: ${lead.company}`);
                    const directoryContact = await this.searchBusinessDirectories(lead.company, lead.address, browser);
                    if (directoryContact.email && !enrichedLead.email)
                        enrichedLead.email = directoryContact.email;
                    if (directoryContact.phone && !enrichedLead.phone)
                        enrichedLead.phone = directoryContact.phone;
                }
            }
            catch (error) {
                console.warn(`  ⚠️ Enrichment failed for ${lead.company}:`, error instanceof Error ? error.message : String(error));
            }
            enrichedLeads.push(enrichedLead);
            // Rate limiting
            if (i < leads.length - 1) {
                await this.delay(1000 + Math.random() * 2000);
            }
        }
        return enrichedLeads;
    }
    // 🌐 Scrape business website for contact information
    async scrapeWebsiteForContact(websiteUrl, browser) {
        const page = await browser.newPage();
        try {
            await page.setUserAgent(this.userAgents[Math.floor(Math.random() * this.userAgents.length)]);
            await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const contact = await page.evaluate(() => {
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
                const text = document.body.innerText;
                const emailMatch = text.match(emailRegex)?.[0];
                const phoneMatch = text.match(phoneRegex)?.[0];
                return {
                    email: emailMatch || "",
                    phone: phoneMatch || ""
                };
            });
            return contact;
        }
        catch (error) {
            return {};
        }
        finally {
            await page.close();
        }
    }
    // 🔍 Google search for business contact information
    async googleSearchForContact(company, address, browser) {
        const page = await browser.newPage();
        try {
            await page.setUserAgent(this.userAgents[Math.floor(Math.random() * this.userAgents.length)]);
            const searchQuery = `"${company}" contact phone email ${address?.split(',')[0] || ''}`;
            const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
            await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const contact = await page.evaluate(() => {
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
                const websiteRegex = /https?:\/\/[^\s<>"]+/g;
                const text = document.body.innerText;
                const emailMatch = text.match(emailRegex)?.[0];
                const phoneMatch = text.match(phoneRegex)?.[0];
                // Look for website in search results
                const websiteLinks = Array.from(document.querySelectorAll('a[href*="http"]:not([href*="google"])'));
                const website = websiteLinks.find(link => {
                    const href = link.href;
                    return !href.includes('facebook') && !href.includes('linkedin') && !href.includes('twitter');
                })?.getAttribute('href') || "";
                return {
                    email: emailMatch || "",
                    phone: phoneMatch || "",
                    website: website || ""
                };
            });
            return contact;
        }
        catch (error) {
            return {};
        }
        finally {
            await page.close();
        }
    }
    // 📚 Search business directories for contact information
    async searchBusinessDirectories(company, address, browser) {
        const directories = [
            `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(company)}&geo_location_terms=${encodeURIComponent(address?.split(',')[0] || '')}`,
            `https://www.yelp.com/search?find_desc=${encodeURIComponent(company)}&find_loc=${encodeURIComponent(address?.split(',')[0] || '')}`
        ];
        for (const directoryUrl of directories) {
            const page = await browser.newPage();
            try {
                await page.setUserAgent(this.userAgents[Math.floor(Math.random() * this.userAgents.length)]);
                await page.goto(directoryUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const contact = await page.evaluate(() => {
                    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                    const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
                    const text = document.body.innerText;
                    const emailMatch = text.match(emailRegex)?.[0];
                    const phoneMatch = text.match(phoneRegex)?.[0];
                    return {
                        email: emailMatch || "",
                        phone: phoneMatch || ""
                    };
                });
                if (contact.email || contact.phone) {
                    await page.close();
                    return contact;
                }
            }
            catch (error) {
                // Continue to next directory
            }
            finally {
                await page.close();
            }
        }
        return {};
    }
}