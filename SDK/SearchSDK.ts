import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * SearchAPI.io SDK
 * FREE: 100 requests/month
 * PAID: Starting at $20/month for 2,500 searches
 * Best for: Google Search results, Google Maps, Google Shopping
 * Provides: Rich search results with business info
 * If error returns string wtih error message
 * 
 * Public methods: searchBusinesses, getUsage
 * All other methods are private utilities
 */
export class SearchSDK {
  private baseUrl = "https://www.searchapi.io/api/v1/search"
  private apiKey: string
  
  constructor(apiKey: string) {
    this.apiKey = apiKey
    if (!apiKey) throw new Error("SearchAPI key is required")
  }

  /**
   * Search for businesses using SearchAPI.io
   */
  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    // Input validation
    if (!query?.trim()) return "Query parameter is required"
    if (!location?.trim()) return "Location parameter is required"
    if (limit > 50) return "Recommended limit is 50 for performance"
    if (limit < 1) return "Limit must be at least 1"
    
    try {
      // 1. Search for businesses using Google Search
      const searchResults = await this.performGoogleSearch(query, location, limit)
      if (typeof searchResults === 'string') return searchResults

      // 2. Try Google Maps search for better business data
      const mapResults = await this.performGoogleMapsSearch(query, location, Math.min(limit, 20))
      
      // 3. Combine and process results
      const leads = await this.processAllResults(searchResults, mapResults, limit)
      const validLeads = leads.filter((lead: Lead) => Boolean(lead.company?.trim()))
      
      return validLeads.length > 0 ? validLeads : `No valid business results found for "${query}" in "${location}"`
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error("SearchAPI searchBusinesses failed:", errorMessage)
      return `SearchAPI request failed: ${errorMessage}`
    }
  }

  /**
   * Get account usage information
   */
  public async getUsage(): Promise<any> {
    try {
      const response = await fetch(`https://www.searchapi.io/api/v1/account?api_key=${this.apiKey}`, {
        timeout: 10000
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      return await response.json()
    } catch (error) {
      console.error("Failed to get SearchAPI usage:", error)
      throw error
    }
  }

  private async performGoogleSearch(query: string, location: string, limit: number): Promise<any[] | string> {
    try {
      const searchQuery = `${query.trim()} ${location.trim()} business contact information`
      const params = new URLSearchParams({
        api_key: this.apiKey,
        engine: 'google',
        q: searchQuery,
        num: Math.min(limit, 10).toString(), // Google allows max 10 per request
        gl: 'us', // Country
        hl: 'en'  // Language
      })

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SearchAPI/1.0)' }
      })
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        return `SearchAPI HTTP ${response.status}: ${errorText}`
      }
      
      const data = await response.json()
      if (data.error) return `SearchAPI error: ${data.error}`
      
      return Array.isArray(data.organic_results) ? data.organic_results : []
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Google search failed: ${errorMessage}`)
    }
  }

  private async performGoogleMapsSearch(query: string, location: string, limit: number): Promise<any[]> {
    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        engine: 'google_maps',
        q: `${query.trim()} ${location.trim()}`,
        type: 'search'
      })

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SearchAPI/1.0)' }
      })
      
      if (!response.ok) {
        console.warn(`Google Maps search failed: HTTP ${response.status}`)
        return [] // Fallback to empty array if Maps search fails
      }
      
      const data = await response.json()
      if (data.error) {
        console.warn(`Google Maps search error: ${data.error}`)
        return []
      }
      
      return Array.isArray(data.local_results) ? data.local_results.slice(0, limit) : []
    } catch (error) {
      console.warn(`Google Maps search failed:`, error)
      return [] // Fallback to empty array on error
    }
  }

  private async processAllResults(searchResults: any[], mapResults: any[], limit: number): Promise<Lead[]> {
    const processedCompanies = new Set<string>() // Track unique companies
    const allLeads: Lead[] = []
    
    // 1. Process Google Maps results first (higher quality)
    if (Array.isArray(mapResults) && mapResults.length > 0) {
      for (const result of mapResults.slice(0, limit)) {
        try {
          const lead = await this.processMapResult(result)
          if (lead && lead.company && !processedCompanies.has(lead.company.toLowerCase())) {
            processedCompanies.add(lead.company.toLowerCase())
            allLeads.push(lead)
          }
        } catch (error) {
          console.error("Error processing map result:", error)
        }
      }
    }
    
    // 2. Process Google Search results for remaining slots
    const remaining = limit - allLeads.length
    if (remaining > 0 && Array.isArray(searchResults)) {
      for (const result of searchResults.slice(0, remaining)) {
        try {
          const lead = await this.processSearchResult(result)
          if (lead && lead.company && !processedCompanies.has(lead.company.toLowerCase())) {
            processedCompanies.add(lead.company.toLowerCase())
            allLeads.push(lead)
          }
        } catch (error) {
          console.error("Error processing search result:", error)
        }
      }
    }
    
    return allLeads.slice(0, limit)
  }

  private async processMapResult(result: any): Promise<Lead | null> {
    try {
      if (!result || !result.title) return null

      const lead: Lead = {
        company: result.title || "",
        address: result.address || "", 
        phone: this.cleanPhone(result.phone || ""),
        email: await this.extractEmailFromResult(result),
        website: result.website || "",
      }

      return lead
    } catch (error) {
      console.error("Error processing map result:", error)
      return null
    }
  }

  private async processSearchResult(result: any): Promise<Lead | null> {
    try {
      if (!result || (!result.title && !result.snippet)) return null

      const company = this.extractCompanyName(result.title || result.snippet || "")
      const website = result.link || ""
      
      const lead: Lead = {
        company,
        address: this.extractAddress(result.snippet || ""),
        phone: (await scrapeContactsFromWebsite(website)).phone,
        email: (await scrapeContactsFromWebsite(website)).email,
        website,
      }

      return lead
    } catch (error) {
      console.error("Error processing search result:", error)
      return null
    }
  }

  private async extractEmailFromResult(result: any): Promise<string> {
    try {
      // 1. Check if email is directly available
      if (result.contact?.email) return result.contact.email
      
      // 2. Try to scrape from website
      if (result.website) {
        return (await scrapeContactsFromWebsite(result.website)).email
      }
      
      return ""
    } catch (error) {
      console.error("Error extracting email:", error)
      return ""
    }
  }

  private async scrapePhoneFromWebsite(website: string): Promise<string> {
    if (!website) return ""
    
    try {
      const url = website.startsWith('http') ? website : `https://${website}`
      const response = await fetch(url, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      })
      
      if (!response.ok) return ""
      
      const html = await response.text()
      const cleanText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
      
      // Phone pattern matching
      const phoneMatch = cleanText.match(/\b\+?1?[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/)
      
      return phoneMatch ? this.cleanPhone(phoneMatch[0]) : ""
    } catch (error) {
      console.error(`Phone scraping failed for ${website}:`, error)
      return ""
    }
  }

  private cleanPhone(phone: string): string {
    if (!phone) return ""
    
    const digits = phone.replace(/[^\d]/g, "")
    
    if (digits.length === 10) {
      return `1${digits}` // Add country code for US numbers
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return digits
    } else if (digits.length >= 10) {
      return digits.slice(0, 11)
    }
    
    return ""
  }

  private extractCompanyName(text: string): string {
    if (!text) return ""
    
    return text
      .split('-')[0]
      .split('|')[0]
      .replace(/\s+(LLC|Inc|Corp|Ltd|Co\.|Company|LTD|INC).*$/i, "")
      .trim()
  }

  private extractAddress(text: string): string {
    if (!text) return ""
    
    // Look for address patterns
    const addressMatch = text.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln)[^,]*(?:,\s*[A-Za-z\s]+)?/i)
    return addressMatch ? addressMatch[0].trim() : ""
  }
}