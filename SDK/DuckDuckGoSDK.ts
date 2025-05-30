import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * DuckDuckGo Instant Answer API SDK
 * FREE: Unlimited (no official limit)
 * Best for: Basic business info from search
 * Provides: URLs, abstracts, related topics
 * If error returns string with error message
 */
export class DuckDuckGoSDK {
  private endpoint = "https://api.duckduckgo.com/"

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    // 1. Validate limit
    if (limit > 50) return "Recommended limit is 50 for performance"

    try {
      // 2. Construct global search query
      const q = `${query} ${location} company contact info`
      const url = `${this.endpoint}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`

      // 3. Fetch raw data
      const res = await fetch(url)
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()

      // 4. Clean up & filter items with actual URLs
      const rawItems = [...(data.Results || []), ...(data.RelatedTopics || [])]
      const items = rawItems.filter(item => item.FirstURL && typeof item.FirstURL === "string").slice(0, limit)

      // 5. Convert raw items to leads
      const leads: Lead[] = []
      for (const item of items) {
        const name = this.extractName(item.Text || "")
        if (!name) continue

        const website = item.FirstURL
        const {email,phone} = await scrapeContactsFromWebsite(website)
     

        leads.push({
          company: name,
          address: this.extractAddress(item.Text || "", location),
          phone,
          email,
          website
        })
      }

      // 6. Return valid leads only
      return leads.filter(lead => lead.company)
    } catch (error: unknown) {
      return `DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }



  private extractName(text: string): string {
    return text.split("-")[0].split("|")[0].trim()
  }

  private extractAddress(text: string, location: string): string {
    const m = text.match(new RegExp(`[^.!?]*${location}[^.!?]*`, "i"))
    return m ? m[0].trim() : location
  }
}