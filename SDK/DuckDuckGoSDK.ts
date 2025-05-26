import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeEmailFromWebsite } from "../utils/scrapeEmailFromWebsite"

/**
 * DuckDuckGo Instant Answer API SDK
 * FREE: Unlimited (no official limit)
 * Best for: Basic business info from search
 * Provides: URLs, abstracts, related topics
 */
export class DuckDuckGoSDK {
  private endpoint = "https://api.duckduckgo.com/"

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    // 1. Validate limit
    if (limit > 50) return "Recommended limit is 50 for performance"
    
    try {
      // 2. Construct search query
      // e.g https://api.duckduckgo.com/?q=123&format=json&no_html=1&skip_disambig=1
      const q = `${query} ${location} business contact`
      const url = `${this.endpoint}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      
      // 3. Fetch data
      const res = await fetch(url)
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()
      
      // 4. Process results
      const items = [...(data.RelatedTopics || []), ...(data.Results || [])]
      const leads = await Promise.all(
        items.slice(0, limit).map(async (item: any) => ({
          company: this.extractName(item.Text || ""),
          address: this.extractAddress(item.Text || "", location),
          phone: item.FirstURL ? await this.scrapePhone(item.FirstURL) : "",
          email: item.FirstURL ? await scrapeEmailFromWebsite(item.FirstURL) : "",
          website: item.FirstURL || ""
        }))
      )
      
      // 5. Filter valid leads
      return leads.filter((l: Lead) => l.company)
    } catch (error: unknown) {
      return `DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async scrapePhone(site: string): Promise<string> {
    try {
      // 1. Fetch website content
      const r = await fetch(site, { timeout: 5000 })
      if (!r.ok) return ""
      
      // 2. Extract phone number
      const txt = await r.text()
      const clean = txt.replace(/<[^>]*>/g, " ")
      const m = clean.match(/\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)
      return m ? m[0].replace(/[^\d]/g, "") : ""
    } catch {
      return ""
    }
  }

  private extractName(text: string): string {
    return text.split('-')[0].split('|')[0].trim()
  }

  private extractAddress(text: string, location: string): string {
    const m = text.match(new RegExp(`[^.!?]*${location}[^.!?]*`, "i"))
    return m ? m[0].trim() : location
  }
}