import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * SerpAPI SDK
 * FREE: 100 searches/month
 * Best for: Google search results with business data
 * Provides: URLs, snippets, titles, local results
 * Returns string if error
 *
 * CRITICAL REQUIREMENT: Every lead MUST have at least email OR phone
 *
 * @example
 * const sdk = new SerpSDK("SERPAPI_KEY")
 * const leads = await sdk.searchBusinesses(
 *   "coffee shop",
 *   "24783, Osterrönfeld, Germany",
 *   10
 * )
 *
 * @returns Promise<Lead[] | string> - Array of leads or error message
 */
export class SerpSDK {
  private apiKey: string
  private endpoint = "https://serpapi.com/search.json"

  constructor(apiKey: string) {
    if (!apiKey.trim()) throw new Error("SerpAPI key is required")
    this.apiKey = apiKey
  }

  /**
   * Search for businesses using SerpAPI
   * @param query - Business type, e.g. "nail salon"
   * @param location - Full location string, e.g. "24783, Osterrönfeld, Germany"
   * @param limit - Max results (1–100)
   */
  public async searchBusinesses(
    query: string,
    location: string,
    limit = 10
  ): Promise<Lead[] | string> {
    if (!query.trim()) return "Query parameter is required"
    if (!location.trim()) return "Location parameter is required"
    if (limit < 1 || limit > 100) return "Limit must be between 1 and 100"

    try {
      // 1️⃣ Try raw location string
      let results = await this.callSerp({
        q: `${query.trim()} ${location.trim()} contact phone email`,
        location: location.trim(),
        num: limit.toString()
      })

      // 2️⃣ Fallback: geocode if no results
      if ((!results || results.length === 0) && location.trim()) {
        const geo = await this.geocodeLocation(location.trim())
        if (geo) {
          results = await this.callSerp({
            q: `${query.trim()} contact phone email`,
            ll: `${geo.lat},${geo.lon}`,
            num: limit.toString()
          })
        }
      }

      if (!results || results.length === 0) {
        return `No results found for "${query}" in "${location}"`
      }

      // 3️⃣ Map to Lead[]
      const leads: (Lead | null)[] = await Promise.all(
        results.slice(0, limit).map(async item => {
          try {
            const website = item.link || item.website || ""
            const company =
              this.extractCompanyName(item.title || item.name || "")
            const address =
              (item as any).formatted_address ||
              this.extractAddress(item.snippet || "", location)

            // parallel scrape email & phone
            const [email, phone] = await Promise.all([
              website
                ? (await scrapeContactsFromWebsite(website)).email
                : Promise.resolve(""),
              item.phone
                ? Promise.resolve(this.cleanPhone(item.phone))
                : website
                ? (await scrapeContactsFromWebsite(website)).phone
                : Promise.resolve("")
            ])

            if (!company.trim() || (!email && !phone)) return null
            return { company, address, phone, email, website }
          } catch {
            return null
          }
        })
      )

      const valid = leads.filter((l): l is Lead => l !== null)
      return valid.length ? valid : `No valid business results for "${query}"`
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return `SerpAPI request failed: ${msg}`
    }
  }

  /** Wraps SerpAPI call with AbortController timeout */
  private async callSerp(params: Record<string, string>): Promise<any[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const url =
      this.endpoint + "?" + new URLSearchParams({ ...params, api_key: this.apiKey }).toString()
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SerpAPI/1.0)" }
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    const json = await res.json()
    return Array.isArray(json.organic_results)
      ? [...(json.local_results || []), ...json.organic_results]
      : json.local_results || []
  }

  /** Convert location string to lat/lon via OSM Nominatim */
  private async geocodeLocation(
    location: string
  ): Promise<{ lat: string; lon: string } | null> {
    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({ q: location, format: "json", limit: "1" }).toString()
    const res = await fetch(url, { headers: { "User-Agent": "MyApp/1.0" } })
    if (!res.ok) return null
    const [first] = (await res.json()) as any[]
    return first ? { lat: first.lat, lon: first.lon } : null
  }

  /** Scrapes phone from a website URL */
  private async scrapePhoneFromWebsite(website: string): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const url = website.startsWith("http") ? website : `https://${website}`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    clearTimeout(timeout)
    if (!res.ok) return ""
    const text = await res.text()
    const clean = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
    const match =
      clean.match(/\b\+?[0-9][0-9\-\s().]{7,}\b/)?.[0] || ""
    return this.cleanPhone(match)
  }

  /** Normalize phone string to digits */
  private cleanPhone(phone: string): string {
    const digits = phone.replace(/[^\d]/g, "")
    return digits.length >= 7 ? digits : ""
  }

  private extractCompanyName(title: string): string {
    return title.split(/[-|]/)[0].replace(/\b(LLC|Inc|Corp|Ltd)\b/gi, "").trim()
  }

  private extractAddress(snippet: string, location: string): string {
    const street = snippet.match(
      /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)\b/
    )?.[0]
    return street?.trim() || location
  }
}
