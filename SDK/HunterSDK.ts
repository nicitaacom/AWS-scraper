import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"

interface DomainInfo {
  domain: string;
  company: string;
  website: string;
}

interface EmailData {
  emails: string[];
}

/**
 * Hunter.io Email Finder SDK
 * FREE: 25 searches/month
 * Best for: Finding email addresses for businesses
 */
export class HunterSDK {
  private readonly endpoint = "https://api.hunter.io/v2"
  private readonly maxFreeRequests = 25

  constructor(private readonly apiKey: string) {}

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    if (limit > this.maxFreeRequests) {
      return `Limit exceeds free tier maximum of ${this.maxFreeRequests}/month`
    }

    try {
      const domains = await this.findDomains(query, location, limit)
      const leads = await Promise.all(domains.map(domain => this.enrichLead(domain, location)))
      return leads.filter(lead => lead.company)
    } catch (error: unknown) {
      return `Hunter.io failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async enrichLead(domain: DomainInfo, location: string): Promise<Lead> {
    const [emailData, phone] = await Promise.all([
      this.findEmails(domain.domain),
      this.scrapePhone(domain.website)
    ])

    return {
      company: domain.company,
      address: location,
      phone,
      email: emailData.emails[0] || "",
      website: domain.website
    }
  }

  private async findDomains(query: string, location: string, limit: number): Promise<DomainInfo[]> {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} ${location} site:`)}`
    const response = await fetch(searchUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch search results: ${response.status} - ${response.statusText}`)
    }
    const html = await response.text()
    return this.extractDomainsFromHtml(html, limit)
  }

  private extractDomainsFromHtml(html: string, limit: number): DomainInfo[] {
    const domains: DomainInfo[] = []
    const urlPattern = /https?:\/\/([^\/\s"']+)/gi
    let match: RegExpExecArray | null

    while ((match = urlPattern.exec(html)) && domains.length < limit) {
      const fullDomain = match[1]
      const cleanDomain = fullDomain.replace('www.', '')
      
      if (this.isValidDomain(cleanDomain)) {
        domains.push({
          domain: cleanDomain,
          company: this.extractCompanyName(cleanDomain),
          website: `https://${fullDomain}`
        })
      }
    }
    return domains
  }

  private isValidDomain(domain: string): boolean {
    return !domain.includes('google') && !domain.includes('facebook')
  }

  private extractCompanyName(domain: string): string {
    return domain.split('.')[0]
  }

  private async findEmails(domain: string): Promise<EmailData> {
    try {
      const url = `${this.endpoint}/domain-search?domain=${domain}&api_key=${this.apiKey}&limit=1`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Hunter API request failed: ${response.status} - ${response.statusText}`)
      }
      const data = await response.json()
      
      const emails = data.data?.emails?.map((e: any) => e.value) || []
      return { emails }
    } catch (error: unknown) {
      return { emails: [] }
    }
  }

  private async scrapePhone(site: string): Promise<string> {
    try {
      const response = await fetch(site, { timeout: 5000 })
      if (!response.ok) return ""
      
      const text = await response.text()
      const cleanText = text.replace(/<[^>]*>/g, " ")
      const phoneMatch = cleanText.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)
      
      return phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "") : ""
    } catch {
      return ""
    }
  }
}