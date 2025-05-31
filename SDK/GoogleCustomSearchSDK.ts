import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite"

/**
 * Google Custom Search API SDK
 * FREE: 100 searches/day (3k/month)
 * Best for: Finding business websites and contact info
 * Enhanced: Returns error strings instead of throwing errors
 * Rate limited: 1 second between requests for free tier
 * 
 * @param query - Business type (e.g. "nail salon")
 * @param location - City or region (e.g. "Miami")
 * @returns Promise<Lead[] | string> - Leads array or error string
 */
export class GoogleCustomSearchSDK {
  private apiKey: string
  private searchEngineId: string
  private baseUrl = "https://www.googleapis.com/customsearch/v1"
  private readonly rateLimitDelay = 1000 // 1 second between requests
  private lastRequestTime = 0
  
  constructor(apiKey: string, searchEngineId: string) {
    this.apiKey = apiKey
    this.searchEngineId = searchEngineId
  }
  
  public async searchBusinesses(query: string, location: string, limit: number = 10): Promise<Lead[] | string> {
    try {
      // Rate limiting
      await this.enforceRateLimit()
      
      // Validate inputs
      if (!query?.trim() || !location?.trim()) {
        return "Query and location are required"
      }
      
      if (!this.apiKey || !this.searchEngineId) {
        return "API key and search engine ID are required"
      }
      
      if (limit > 100) {
        return "Limit exceeds Google Custom Search free tier maximum of 100/day"
      }
      
      const searchQuery = `${query.trim()} ${location.trim()} contact phone email website`
      const params = new URLSearchParams({
        key: this.apiKey,
        cx: this.searchEngineId,
        q: searchQuery,
        num: Math.min(Math.max(limit, 1), 10).toString(),
        safe: 'active'
      })
      
      const response = await fetch(`${this.baseUrl}?${params}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeadScraper/1.0)'
        }
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return `Google API error (${response.status}): ${errorData.error?.message || response.statusText}`
      }
      
      const data = await response.json()
      
      if (!data.items || !Array.isArray(data.items)) {
        return "No search results found for this query"
      }
      
      // Process leads with error handling
      const leads: Lead[] = []
      
      for (const item of data.items) {
        try {
          const lead = await this.processSearchItem(item, location)
          if (lead && this.isValidLead(lead)) {
            leads.push(lead)
          }
        } catch (error) {
          // Continue processing other items on individual errors
          console.warn(`Failed to process search item: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      
      return leads.length > 0 ? leads : "No valid leads found with contact information"
      
    } catch (error) {
      return `Google Custom Search failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest))
    }
    
    this.lastRequestTime = Date.now()
  }

  private async processSearchItem(item: any, location: string): Promise<Lead | null> {
    try {
      const businessName = this.extractBusinessName(item.title || "", item.snippet || "")
      const website = item.link || ""
      const address = this.extractAddress(item.snippet || "", location)
      
      let phone = this.extractPhone(item.snippet || "")
      let email = this.extractEmail(item.snippet || "")
      
      // Enhanced contact scraping if website available
      if (website && (!email || !phone)) {
        try {
          const contacts = await scrapeContactsFromWebsite(website)
          email = email || contacts.email || ""
          phone = phone || contacts.phone || ""
        } catch (error) {
          // Continue with extracted data if scraping fails
        }
      }
      
      // Additional internet scraping if still missing contacts
      if (!email && !phone) {
        const internetData = await this.scrapeContactFromInternet(businessName, address)
        email = email || internetData.email
        phone = phone || internetData.phone
      }
      
      return {
        company: businessName,
        address: address,
        phone: phone,
        email: email,
        website: website
      }
    } catch (error) {
      return null
    }
  }
  
  private isValidLead(lead: Lead): boolean {
    const hasValidCompany = Boolean(lead.company && lead.company.trim().length > 0)
    const hasValidEmail = Boolean(lead.email && lead.email.trim().length > 0)
    const hasValidPhone = Boolean(lead.phone && lead.phone.trim().length > 0)
    const hasContact = hasValidEmail || hasValidPhone
    return hasValidCompany && hasContact
  }

  private extractEmail(text: string): string {
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)
    return emailMatch ? emailMatch[0] : ""
  }
  
  private extractPhone(text: string): string {
    const patterns = [
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
      /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/,
      /\b\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/
    ]
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match && match[0]) return match[0].trim()
    }
    return ""
  }
  
  private async scrapeContactFromInternet(businessName: string, address: string): Promise<{email: string, phone: string}> {
    try {
      const searchQuery = `"${businessName}" "${address}" contact email phone`
      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`
      
      const response = await fetch(googleSearchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      
      if (!response.ok) return { email: "", phone: "" }
      
      const html = await response.text()
      const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
      
      const emailMatch = cleanText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)
      const email = emailMatch ? emailMatch[0] : ""
      
      const phonePatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
        /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g,
        /\b\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g
      ]
      
      let phone = ""
      for (const pattern of phonePatterns) {
        const matches = cleanText.match(pattern)
        if (matches && matches[0]) {
          phone = matches[0].trim()
          break
        }
      }
      
      return { email, phone }
    } catch (error) {
      return { email: "", phone: "" }
    }
  }
  
  private extractBusinessName(title: string, snippet: string): string {
    try {
      if (!title && !snippet) return "Unknown Business"
      
      const cleaned = (title || snippet)
        .replace(/\s*-\s*.*$/, '')
        .replace(/\s*\|\s*.*$/, '')
        .replace(/\s*\.\.\.$/, '')
        .trim()
      
      return cleaned || snippet.split('.')[0]?.trim() || "Unknown Business"
    } catch (error) {
      return "Unknown Business"
    }
  }
  
  private extractAddress(snippet: string, location: string): string {
    try {
      if (!snippet) return location
      
      const addressPatterns = [
        /\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court)/gi,
        new RegExp(`[^.!?]*${location}[^.!?]*`, 'i')
      ]
      
      for (const pattern of addressPatterns) {
        const match = snippet.match(pattern)
        if (match && match[0]) {
          return match[0].trim()
        }
      }
      
      return location
    } catch (error) {
      return location
    }
  }
}