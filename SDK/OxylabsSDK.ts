import { Lead } from "../interfaces/interfaces";
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite";

interface DomainInfo {
  domain: string;
  company: string;
  website: string;
}

interface OxylabsResponse {
  results: Array<{
    content: any;
    created_at: string;
    updated_at: string;
    page: number;
    url: string;
    job_id: string;
    status_code: number;
  }>;
}

/**
 * Oxylabs Web Scraper SDK
 * ✅ Real-time web scraping with residential proxies
 * ✅ Rate Limit: 3s delays for stability
 * ✅ Use case: Scrape business domains and contacts
 * ✅ Returns error strings instead of throwing
 */
export class OxylabsSDK {
  private readonly endpoint = "https://realtime.oxylabs.io/v1/queries";
  private readonly rateLimitDelay = 3000;
  private lastRequestTime = 0;

  constructor(private readonly username: string, private readonly password: string) {}

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    if (!this.username.trim()) return "Oxylabs username is required";
    if (!this.password.trim()) return "Oxylabs password is required";
    if (!query.trim() || !location.trim()) return "Query and location are required";

    const domains = await this.findDomains(query, location, limit);
    if (!domains.length) return "No business domains found";

    const leads: Lead[] = [];
    for (let i = 0; i < domains.length; i++) {
      if (i > 0) await this.enforceRateLimit();
      try {
        const lead = await this.enrichLead(domains[i], location);
        if (this.isValidLead(lead)) leads.push(lead);
      } catch (error) {
        console.warn(`Failed to enrich ${domains[i].domain}: ${error}`);
      }
    }
    return leads.length ? leads : `No valid leads from ${domains.length} domains`;
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const delay = this.rateLimitDelay - (now - this.lastRequestTime);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    this.lastRequestTime = Date.now();
  }

  private isValidLead(lead: Lead): boolean {
    return Boolean(lead.company?.trim() && (lead.email?.trim() || lead.phone?.trim()));
  }

  private async enrichLead(domain: DomainInfo, location: string): Promise<Lead> {
    let phone = "", email = "";
    if (domain.website) {
      try {
        const contacts = await this.scrapeContactsFromDomain(domain.website);
        phone = contacts.phone;
        email = contacts.email;
      } catch (error) {
        const fallback = await scrapeContactsFromWebsite(domain.website);
        phone = fallback.phone || "";
        email = fallback.email || "";
      }
    }
    return { company: domain.company, address: location, phone, email, website: domain.website };
  }

  private async findDomains(query: string, location: string, limit: number): Promise<DomainInfo[]> {
    const searchQuery = `${query} ${location} -site:facebook.com -site:linkedin.com -site:yelp.com`;
    const domains = await this.scrapeGoogleSearch(searchQuery);
    if (!domains.length) return this.generateFallbackDomains(query, location, Math.min(limit, 5));

    const uniqueDomains = new Set<string>();
    return domains.filter(d => {
      if (uniqueDomains.size >= limit || uniqueDomains.has(d.domain)) return false;
      uniqueDomains.add(d.domain);
      return true;
    });
  }

  private async scrapeGoogleSearch(query: string): Promise<DomainInfo[]> {
    try {
      const payload = {
        source: "google",
        query,
        pages: 1,
        parse: true,
        context: [{ key: "results_language", value: "en" }]
      };
      const content = await this.makeOxylabsRequest(payload);
      if (!content?.organic) return [];

      return content.organic
        .filter((r: any) => r.url)
        .map((r: any) => {
          const url = new URL(r.url);
          const domain = url.hostname.replace("www.", "");
          return { domain, company: r.title || this.extractCompanyName(domain), website: r.url };
        })
        .filter((d: DomainInfo) => this.isValidDomain(d.domain));
    } catch (error) {
      console.warn(`Google scrape failed: ${error}`);
      return [];
    }
  }

  private async scrapeContactsFromDomain(website: string): Promise<{ phone: string; email: string }> {
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
    } catch (error) {
      console.warn(`Contact scrape failed for ${website}: ${error}`);
      return { phone: "", email: "" };
    }
  }

  private async makeOxylabsRequest(payload: any): Promise<any> {
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
      if (response.status === 401) throw new Error("Invalid credentials");
      if (response.status === 403) throw new Error("Access denied or quota exceeded");
      throw new Error(`API failed: ${response.status}`);
    }

    const data: OxylabsResponse = await response.json();
    if (!data.results?.length) throw new Error("No results");
    return data.results[0].content;
  }

  private generateFallbackDomains(query: string, location: string, limit: number): DomainInfo[] {
    const q = query.toLowerCase().replace(/\s+/g, '');
    const l = location.toLowerCase().replace(/\s+/g, '');
    return [
      `${q}${l}.com`, `${l}${q}.com`, `best${q}${l}.com`, `${q}.${l}.com`, `local${q}.com`
    ].slice(0, limit).map(d => ({ domain: d, company: this.extractCompanyName(d), website: `https://${d}` }));
  }

  private isValidDomain(domain: string): boolean {
    const exclude = ['google', 'facebook', 'youtube', 'twitter', 'instagram', 'linkedin', 'yelp', 'yellowpages', 'foursquare', 'tripadvisor', 'reddit', 'wikipedia', 'craigslist', 'amazon', 'ebay'];
    return !exclude.some(p => domain.includes(p)) && domain.includes('.') && domain.length > 4 && domain.length < 50;
  }

  private extractCompanyName(domain: string): string {
    return domain.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).trim();
  }
}