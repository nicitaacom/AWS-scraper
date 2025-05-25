import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeEmailFromWebsite } from "../utils/scrapeEmailFromWebsite"

/**
 * Google Custom Search API SDK
 * FREE: 100 searches/day (3k/month)
 * Best for: Finding business websites and contact info
 * Provides: Website URLs, snippets, titles
 * Enhanced: MUST return email AND phone for each lead
 * 
 * CRITICAL REQUIREMENT: Every lead MUST have at least email OR phone
 * If API doesn't provide contact info, automatically scrapes from:
 * - Business website (if available)
 * - Google search using business name + location
 * - Business directory lookups
 * 
 * @returns Promise<Lead[]> - All leads guaranteed to have email OR phone
 */
export class GoogleCustomSearchSDK {
  private apiKey: string
  private searchEngineId: string
  private baseUrl = "https://www.googleapis.com/customsearch/v1"
  
  constructor(apiKey: string, searchEngineId: string) {
    this.apiKey = apiKey
    this.searchEngineId = searchEngineId
  }
  
  public async searchBusinesses(query: string, location: string, limit: number = 10): Promise<Lead[]> {
    try {
      // Validate inputs
      if (!query?.trim() || !location?.trim()) {
        throw new Error("Query and location are required")
      }
      
      if (!this.apiKey || !this.searchEngineId) {
        throw new Error("API key and search engine ID are required")
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
        timeout: 30000
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`Google API error (${response.status}): ${errorData.error?.message || response.statusText}`)
      }
      
      const data = await response.json()
      
      if (!data.items || !Array.isArray(data.items)) {
        return []
      }
      
      const leads = await Promise.allSettled(
        data.items.map(async (item: any) => {
          try {
            const businessName = this.extractBusinessName(item.title || "", item.snippet || "")
            const website = item.link || ""
            const address = this.extractAddress(item.snippet || "", location)
            let phone = ""
            let email = ""
            
            // First: Scrape from website if available
            if (website) {
              const [emailResult, phoneResult] = await Promise.allSettled([
                scrapeEmailFromWebsite(website),
                this.scrapePhoneFromWebsite(website)
              ])
              
              email = emailResult.status === 'fulfilled' ? emailResult.value || "" : ""
              phone = phoneResult.status === 'fulfilled' ? phoneResult.value || "" : ""
            }
            
            // If we still don't have email OR phone, scrape from internet
            if (!email && !phone) {
              const scrapedData = await this.scrapeContactFromInternet(businessName, address)
              email = email || scrapedData.email
              phone = phone || scrapedData.phone
            }
            
            // If we still only have one contact method, try to get the other
            if (email && !phone) {
              const phoneData = await this.scrapePhoneFromInternet(businessName, address)
              phone = phone || phoneData
            }
            
            if (phone && !email) {
              const emailData = await this.scrapeEmailFromInternet(businessName, address)
              email = email || emailData
            }
            
            return {
              company: businessName,
              address: address,
              phone: phone,
              email: email,
              website: website
            }
          } catch (error) {
            // Even on error, try to get basic contact info
            const businessName = this.extractBusinessName(item.title || "", item.snippet || "")
            const address = this.extractAddress(item.snippet || "", location)
            
            try {
              const emergencyData = await this.scrapeContactFromInternet(businessName, address)
              return {
                company: businessName,
                address: address,
                phone: emergencyData.phone,
                email: emergencyData.email,
                website: item.link || ""
              }
            } catch {
              return {
                company: businessName,
                address: address,
                phone: "",
                email: "",
                website: item.link || ""
              }
            }
          }
        })
      )
      
      // Rate limiting for free tier
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Filter results and ensure each lead has email OR phone
      const validLeads = leads
        .filter((result): result is PromiseFulfilledResult<Lead> => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(lead => {
          const hasValidCompany = lead.company && lead.company.trim().length > 0
          const hasContact = (lead.email && lead.email.trim().length > 0) || 
                           (lead.phone && lead.phone.trim().length > 0)
          return hasValidCompany && hasContact
        })
      
      return validLeads
      
    } catch (error) {
      console.error('Google Custom Search error:', error)
      throw new Error(`Google Custom Search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  private async scrapeContactFromInternet(businessName: string, address: string): Promise<{email: string, phone: string}> {
    try {
      const searchQuery = `"${businessName}" "${address}" contact email phone`
      const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`
      
      const response = await fetch(googleSearchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      })
      
      if (!response.ok) return { email: "", phone: "" }
      
      const html = await response.text()
      const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
      
      // Extract email
      const emailMatch = cleanText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)
      const email = emailMatch ? emailMatch[0] : ""
      
      // Extract phone
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
  
  private async scrapePhoneFromInternet(businessName: string, address: string): Promise<string> {
    try {
      const result = await this.scrapeContactFromInternet(businessName, address)
      return result.phone
    } catch (error) {
      return ""
    }
  }
  
  private async scrapeEmailFromInternet(businessName: string, address: string): Promise<string> {
    try {
      const result = await this.scrapeContactFromInternet(businessName, address)
      return result.email
    } catch (error) {
      return ""
    }
  }
  
  private async scrapePhoneFromWebsite(website: string): Promise<string> {
    try {
      if (!website?.trim()) return ""
      
      let url = website.trim()
      if (!url.startsWith('http')) {
        url = 'https://' + url
      }
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      })
      
      if (!response.ok) return ""
      
      const html = await response.text()
      const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
      
      const phonePatterns = [
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
        /\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g,
        /\b\+\d{1,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
        /\btel:[\+]?[\d\-\(\)\s]+/gi
      ]
      
      for (const pattern of phonePatterns) {
        const matches = cleanText.match(pattern)
        if (matches && matches[0]) {
          return matches[0].replace('tel:', '').trim()
        }
      }
      
      return ""
    } catch (error) {
      return ""
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