import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * OpenCorporates API SDK
 * FREE: 60 requests/minute (86,400/day potential)
 * Best for: B2B company data, official business records
 * Provides: Company name, registered address, incorporation date, status
 * Limitations: No phone/email, mainly corporate data
 * If error returns string wtih error message
 */
export class OpenCorporatesSDK {
  private baseUrl = "https://api.opencorporates.com/v0.4"
  private rateLimitMs = 1000 // 1 second between requests to stay under 60/min
  private lastRequestTime = 0

  /**
   * Rate limiting to respect 60 requests/minute
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    if (timeSinceLastRequest < this.rateLimitMs) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitMs - timeSinceLastRequest))
    }
    this.lastRequestTime = Date.now()
  }

  /**
   * Safely extract error message from various error types
   */
  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    if (error && typeof error === 'object') {
      // Handle API error objects
      if ('error' in error && typeof (error as any).error === 'string') {
        return (error as any).error
      }
      if ('message' in error && typeof (error as any).message === 'string') {
        return (error as any).message
      }
      // Try to stringify complex objects
      try {
        return JSON.stringify(error)
      } catch {
        return 'Unknown error object'
      }
    }
    return 'Unknown error'
  }

  /**
   * Validate and normalize search type
   * @param searchType The search type to validate
   * @returns A valid search type or null if invalid
   */
  private validateSearchType(searchType: string): 'name' | 'jurisdiction' | 'industry' | null {
    const validTypes = ['name', 'jurisdiction', 'industry'] as const
    
    // Direct match
    if (validTypes.includes(searchType as any)) {
      return searchType as 'name' | 'jurisdiction' | 'industry'
    }
    
    // Normalize common variations
    const normalized = searchType.toLowerCase().trim()
    switch (normalized) {
      case 'company':
      case 'business':
      case 'firm':
      case 'organization':
      case 'org':
        return 'name'
      case 'location':
      case 'region':
      case 'country':
      case 'state':
        return 'jurisdiction'
      case 'sector':
      case 'category':
      case 'type':
      case 'business_type':
        return 'industry'
      default:
        return null
    }
  }

  /**
   * Search for businesses by name, jurisdiction, or industry
   * @param query The search query (name, jurisdiction code, or industry type)
   * @param searchType The type of search: 'name', 'jurisdiction', 'industry', or variations
   * @param limit The maximum number of results to return
   */
  public async searchBusinesses(query: string, searchType: string, limit: number = 30): Promise<Lead[] | string> {
    try {
      // Validate and normalize search type
      const validSearchType = this.validateSearchType(searchType)
      
      if (!validSearchType) {
        console.warn(`⚠️ OpenCorporates: Invalid search type '${searchType}'. Defaulting to 'name' search.`)
        // Default to name search as fallback
        return this.searchBusinesses(query, 'name', limit)
      }

      await this.rateLimit()

      let url = `${this.baseUrl}/companies`
      const params = new URLSearchParams({
        format: "json",
        per_page: Math.min(limit, 100).toString()
      })

      if (validSearchType === 'name') {
        params.append("q", query)
        url += "/search"
      } else if (validSearchType === 'jurisdiction') {
        params.append("jurisdiction_code", query)
      } else if (validSearchType === 'industry') {
        params.append("company_type", query)
      }

      console.log(`🔍 OpenCorporates: Searching ${validSearchType} for "${query}"`)

      const response = await fetch(`${url}?${params}`)
      
      let data: any
      try {
        data = await response.json()
      } catch (jsonError) {
        return `OpenCorporates API error: Failed to parse JSON response - ${this.extractErrorMessage(jsonError)}`
      }

      if (!response.ok) {
        const errorMsg = this.extractErrorMessage(data?.error) || response.statusText || `HTTP ${response.status}`
        return `OpenCorporates API error: ${errorMsg}`
      }

      if (!data.results?.companies?.length) {
        return `No businesses found for the given query: "${query}"`
      }

      const companies = data.results.companies || []
      console.log(`✅ OpenCorporates: Found ${companies.length} companies`)

      const leads = await Promise.all(companies.map(async (company: any) => {
        const lead: Lead = {
          company: company.company?.name || company.name || "",
          address: company.company?.registered_address_in_full || company.registered_address_in_full || "",
          phone: "",
          email: "",
          website: ""
        }

        // Enhanced website finding and contact info scraping
        try {
          const website = await this.findWebsite(lead.company)
          if (website) {
            lead.website = website
            console.log(`🌐 Found website for ${lead.company}: ${website}`)
            
            // Try to scrape phone and email
            try {
              const phone = await this.scrapePhoneFromWebsite(website)
              if (phone) lead.phone = phone
            } catch (error) {
              console.warn(`⚠️ Could not scrape phone from ${website}:`, this.extractErrorMessage(error))
            }
            
            try {
              const email = (await scrapeContactsFromWebsite(website)).email
              if (email) lead.email = email
            } catch (error) {
              console.warn(`⚠️ Could not scrape email from ${website}:`, this.extractErrorMessage(error))
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not find website for ${lead.company}:`, this.extractErrorMessage(error))
        }

        return lead
      }))

      const filteredLeads = leads.filter(lead => lead.company) // Filter out empty company names
      
      // Check if we got the minimum required leads
      if (filteredLeads.length < limit) {
        return `Expected ${limit} leads but only found ${filteredLeads.length} valid companies`
      }

      return filteredLeads
    } catch (error) {
      const errorMessage = `OpenCorporates search failed: ${this.extractErrorMessage(error)}`
      console.error(`❌ OpenCorporates error:`, errorMessage)
      return errorMessage
    }
  }

  /**
   * Overloaded method to maintain backward compatibility with specific search types
   */
  public async searchByName(query: string, limit: number = 30): Promise<Lead[] | string> {
    return this.searchBusinesses(query, 'name', limit)
  }

  public async searchByJurisdiction(query: string, limit: number = 30): Promise<Lead[] | string> {
    return this.searchBusinesses(query, 'jurisdiction', limit)
  }

  public async searchByIndustry(query: string, limit: number = 30): Promise<Lead[] | string> {
    return this.searchBusinesses(query, 'industry', limit)
  }

  /**
   * Find the website of a company using DuckDuckGo's API
   * @param companyName The name of the company
   */
  private async findWebsite(companyName: string): Promise<string> {
    if (!companyName) return ""
    
    try {
      const q = `${companyName} official website`
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      
      const res = await fetch(url, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      } as any)
      
      if (!res.ok) return ""
      
      const data = await res.json()
      const items = [...(data.RelatedTopics || []), ...(data.Results || [])]
      
      if (items.length > 0 && items[0].FirstURL) {
        const website = items[0].FirstURL
        // Basic URL validation
        if (website.startsWith('http://') || website.startsWith('https://')) {
          return website
        }
      }
      
      return ""
    } catch (error) {
      console.warn(`⚠️ Could not find website for ${companyName}:`, this.extractErrorMessage(error))
      return ""
    }
  }

  /**
   * Scrape phone number from a website
   * @param site The website URL to scrape
   */
  private async scrapePhoneFromWebsite(site: string): Promise<string> {
    if (!site) return ""
    
    try {
      const r = await fetch(site, { 
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      } as any)
      
      if (!r.ok) return ""
      
      const txt = await r.text()
      const clean = txt.replace(/<[^>]*>/g, " ")
      
      // Enhanced phone number regex patterns
      const phonePatterns = [
        /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // Standard US format
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // Simple US format
        /\b\+\d{1,3}\s?\d{1,4}\s?\d{1,4}\s?\d{1,4}\b/g // International format
      ]
      
      for (const pattern of phonePatterns) {
        const matches = clean.match(pattern)
        if (matches && matches.length > 0) {
          // Return the first valid-looking phone number
          const phone = matches[0].replace(/[^\d+]/g, "")
          if (phone.length >= 10) {
            return phone
          }
        }
      }
      
      return ""
    } catch (error) {
      console.warn(`⚠️ Could not scrape phone from ${site}:`, this.extractErrorMessage(error))
      return ""
    }
  }
}