import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * Foursquare Places API SDK - Enhanced for High-Volume City Processing
 * FREE: 1,000 API calls/day (30k/month)
 * Optimized for: Processing 100+ cities efficiently with smart fallbacks
 * Enhanced: Guaranteed email OR phone for each lead with multiple contact sources
 */
export class FoursquareSDK {
  private apiKey: string
  private baseUrl = "https://api.foursquare.com/v3/places"
  private requestCount = 0
  private rateLimitDelay = 500 // 0.5 seconds between requests

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  public async searchBusinesses(query: string, location: string, limit: number = 20): Promise<Lead[] | string> {
    if (!query.trim() || !location.trim()) return "Query and location are required"
    if (!this.apiKey) return "API key is required"
    if (limit <= 0) return []

    try {
      // 1. Rate limiting
      await this.respectRateLimit()

      // 2. Try multiple search strategies
      const searchStrategies = [
        () => this.searchByTextAndLocation(query, location, limit),
        () => this.searchByGeocodedLocation(query, location, limit),
        () => this.searchByBroaderQuery(query, location, limit)
      ]

      let allLeads: Lead[] = []
      let lastError = ""

      for (const strategy of searchStrategies) {
        try {
          const leads = await strategy()
          if (Array.isArray(leads) && leads.length > 0) {
            allLeads = leads
            break
          }
        } catch (error) {
          lastError = (error as Error).message
          continue
        }
      }

      // 3. If no leads found, try category-based search
      if (allLeads.length === 0) {
        const categoryLeads = await this.searchByCategory(query, location, limit)
        if (Array.isArray(categoryLeads)) {
          allLeads = categoryLeads
        }
      }

      // 4. Enhance leads with contact information
      const enhancedLeads = await this.enhanceLeadsWithContacts(allLeads, location)

      // 5. Filter leads that have at least email OR phone
      const validLeads = enhancedLeads.filter(lead => 
        (lead.email.trim() || lead.phone.trim()) && lead.company.trim()
      )

      return validLeads.slice(0, limit)

    } catch (error) {
      const errorMsg = (error as Error).message
      if (errorMsg.includes('429')) {
        return "Rate limit exceeded - please try again later"
      }
      if (errorMsg.includes('401') || errorMsg.includes('403')) {
        return "Invalid API key or insufficient permissions"
      }
      return `Foursquare search failed: ${errorMsg}`
    }
  }

  /**
   * Standard text + location search
   */
  private async searchByTextAndLocation(query: string, location: string, limit: number): Promise<Lead[]> {
    const url = `${this.baseUrl}/search?` + new URLSearchParams({
      query: query.trim(),
      near: location.trim(),
      limit: Math.min(limit, 50).toString(),
      fields: "name,location,tel,website,categories,rating,hours,email"
    }).toString()

    return await this.fetchAndProcessResults(url)
  }

  /**
   * Geocoded location search (more accurate for specific cities)
   */
  private async searchByGeocodedLocation(query: string, location: string, limit: number): Promise<Lead[]> {
    const geo = await this.geocodeLocation(location)
    if (!geo) return []

    const url = `${this.baseUrl}/search?` + new URLSearchParams({
      query: query.trim(),
      ll: `${geo.lat},${geo.lon}`,
      radius: "10000", // 10km radius
      limit: Math.min(limit, 50).toString(),
      fields: "name,location,tel,website,categories,rating,hours,email"
    }).toString()

    return await this.fetchAndProcessResults(url)
  }

  /**
   * Broader query search (remove specific terms that might be too narrow)
   */
  private async searchByBroaderQuery(query: string, location: string, limit: number): Promise<Lead[]> {
    // Extract main business type (e.g., "roofing contractor" -> "roofing")
    const broaderQuery = query.split(' ')[0]
    
    const url = `${this.baseUrl}/search?` + new URLSearchParams({
      query: broaderQuery,
      near: location.trim(),
      limit: Math.min(limit, 50).toString(),
      fields: "name,location,tel,website,categories,rating,hours,email"
    }).toString()

    return await this.fetchAndProcessResults(url)
  }

  /**
   * Category-based search using Foursquare categories
   */
  private async searchByCategory(query: string, location: string, limit: number): Promise<Lead[]> {
    // Map common business types to Foursquare categories
    const categoryMap: Record<string, string> = {
      'restaurant': '13065',
      'food': '13065',
      'retail': '17000',
      'shop': '17000',
      'service': '18000',
      'professional': '18000',
      'roofing': '18000',
      'contractor': '18000',
      'repair': '18000',
      'medical': '15000',
      'health': '15000',
      'fitness': '18021',
      'automotive': '18005'
    }

    const category = Object.keys(categoryMap).find(key => 
      query.toLowerCase().includes(key)
    )

    if (!category) return []

    const url = `${this.baseUrl}/search?` + new URLSearchParams({
      categories: categoryMap[category],
      near: location.trim(),
      limit: Math.min(limit, 50).toString(),
      fields: "name,location,tel,website,categories,rating,hours,email"
    }).toString()

    return await this.fetchAndProcessResults(url)
  }

  /**
   * Fetch and process results from Foursquare API
   */
  private async fetchAndProcessResults(url: string): Promise<Lead[]> {
    await this.respectRateLimit()
    
    const response = await fetch(url, {
      headers: {
        'Authorization': this.apiKey,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Foursquare API error (${response.status}): ${response.statusText}`)
    }

    const data = await response.json() as any
    
    if (!data.results || !Array.isArray(data.results)) {
      return []
    }

    // Process each place into a Lead
    const leads: Lead[] = data.results.map((place: any) => ({
      company: place.name || "Unknown Business",
      address: this.formatAddress(place.location),
      phone: this.cleanPhone(place.tel || ""),
      email: place.email || "",
      website: place.website || ""
    }))

    return leads
  }

  /**
   * Enhance leads with additional contact information
   */
  private async enhanceLeadsWithContacts(leads: Lead[], location: string): Promise<Lead[]> {
    const enhancedLeads: Lead[] = []

    for (const lead of leads) {
      const enhanced = { ...lead }

      try {
        // 1. Scrape website for contacts if available
        if (enhanced.website && (!enhanced.email || !enhanced.phone)) {
          const webContacts = await this.scrapeWebsiteContacts(enhanced.website)
          enhanced.email = enhanced.email || webContacts.email
          enhanced.phone = enhanced.phone || webContacts.phone
        }

        // 2. Search internet for contacts if still missing
        if (!enhanced.email || !enhanced.phone) {
          const internetContacts = await this.searchInternetForContacts(
            enhanced.company, 
            location,
            enhanced.address
          )
          enhanced.email = enhanced.email || internetContacts.email
          enhanced.phone = enhanced.phone || internetContacts.phone
        }

        // 3. Try alternative search if still no contacts
        if (!enhanced.email && !enhanced.phone) {
          const altContacts = await this.alternativeContactSearch(enhanced.company, location)
          enhanced.email = enhanced.email || altContacts.email
          enhanced.phone = enhanced.phone || altContacts.phone
        }

      } catch (error) {
        // Continue with original lead if enhancement fails
      }

      enhancedLeads.push(enhanced)
      
      // Small delay between enhancements to avoid overwhelming external services
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return enhancedLeads
  }

  /**
   * Scrape website for contact information
   */
  private async scrapeWebsiteContacts(website: string): Promise<{ email: string; phone: string }> {
    try {
      const contacts = await scrapeContactsFromWebsite(website)
      return {
        email: contacts.email || "",
        phone: this.cleanPhone(contacts.phone || "")
      }
    } catch {
      return { email: "", phone: "" }
    }
  }

  /**
   * Search internet for business contacts
   */
  private async searchInternetForContacts(
    businessName: string, 
    location: string, 
    address?: string
  ): Promise<{ email: string; phone: string }> {
    try {
      const searchQuery = `"${businessName}" ${location} ${address || ""} contact email phone`
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1`
      
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadScraper/1.0)' }
      })
      
      if (!response.ok) return { email: "", phone: "" }
      
      const text = await response.text()
      
      // Extract email and phone from search results
      const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)
      const phoneMatch = text.match(/\b\+?[\d\s\-\(\)\.]{10,}\b/)
      
      return {
        email: emailMatch ? emailMatch[0] : "",
        phone: phoneMatch ? this.cleanPhone(phoneMatch[0]) : ""
      }
    } catch {
      return { email: "", phone: "" }
    }
  }

  /**
   * Alternative contact search using business directories
   */
  private async alternativeContactSearch(
    businessName: string, 
    location: string
  ): Promise<{ email: string; phone: string }> {
    try {
      // Search in common business directories
      const directories = [
        `site:yelp.com "${businessName}" ${location}`,
        `site:yellowpages.com "${businessName}" ${location}`,
        `site:google.com/maps "${businessName}" ${location}`
      ]

      for (const query of directories) {
        try {
          const response = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          })
          
          if (response.ok) {
            const text = await response.text()
            const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)
            const phoneMatch = text.match(/\b\+?[\d\s\-\(\)\.]{10,}\b/)
            
            if (emailMatch || phoneMatch) {
              return {
                email: emailMatch ? emailMatch[0] : "",
                phone: phoneMatch ? this.cleanPhone(phoneMatch[0]) : ""
              }
            }
          }
        } catch {
          continue
        }
        
        // Small delay between directory searches
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      return { email: "", phone: "" }
    } catch {
      return { email: "", phone: "" }
    }
  }

  /**
   * Convert location string to coordinates using OpenStreetMap
   */
  private async geocodeLocation(location: string): Promise<{ lat: string; lon: string } | null> {
    try {
      const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
        q: location,
        format: "json",
        limit: "1"
      }).toString()

      const response = await fetch(url, {
        headers: { "User-Agent": "LeadScraper/1.0" }
      })

      if (!response.ok) return null

      const results = await response.json() as any[]
      const first = results[0]
      
      return first ? { lat: first.lat, lon: first.lon } : null
    } catch {
      return null
    }
  }

  /**
   * Format address from Foursquare location object
   */
  private formatAddress(location: any): string {
    if (!location) return ""
    
    const parts = [
      location.address,
      location.locality,
      location.region,
      location.postcode,
      location.country
    ].filter((part: any) => typeof part === "string" && part.trim())
     .map((part: string) => part.trim())

    return parts.join(", ")
  }

  /**
   * Clean and format phone numbers
   */
  private cleanPhone(phone: string): string {
    if (!phone) return ""
    
    // Remove all non-digit characters except + at the beginning
    const cleaned = phone.replace(/[^\d+]/g, "")
    
    // Ensure phone has at least 10 digits
    const digits = cleaned.replace(/^\+/, "")
    if (digits.length < 10) return ""
    
    return cleaned
  }

  /**
   * Respect rate limits to avoid 429 errors
   */
  private async respectRateLimit(): Promise<void> {
    this.requestCount++
    
    // Progressive delay based on request count
    let delay = this.rateLimitDelay
    
    if (this.requestCount > 50) delay = 1000      // 1 second after 50 requests
    if (this.requestCount > 100) delay = 2000     // 2 seconds after 100 requests
    if (this.requestCount > 200) delay = 3000     // 3 seconds after 200 requests
    
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}