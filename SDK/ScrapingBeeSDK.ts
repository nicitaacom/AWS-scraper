import { Lead } from "../interfaces/interfaces"

export class ScrapingBeeSDK {
  private apiKey: string
  private endpoint = "https://app.scrapingbee.com/api/v1"

  constructor(apiKey: string) {
    if (!apiKey.trim()) throw new Error("ScrapingBee API key is required")
    this.apiKey = apiKey
  }

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    if (limit > 50) return "Recommended limit is 50 for performance"

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} ${location} business`)}`
      
      const response = await fetch(`${this.endpoint}/?` + new URLSearchParams({
        api_key: this.apiKey,
        url: searchUrl,
        render_js: 'true',
        premium_proxy: 'true'
      }))

      if (!response.ok) {
        throw new Error(`ScrapingBee API error: ${response.status}`)
      }

      const html = await response.text()
      return this.parseGoogleResults(html, limit)

    } catch (error) {
      console.error("ScrapingBee search error:", error)
      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  private parseGoogleResults(html: string, limit: number): Lead[] {
    const leads: Lead[] = []
    
    try {
      // Parse Google Business Results - these patterns match Google's current structure
      const businessBlocks = html.match(/<div[^>]*data-ved[^>]*>[\s\S]*?<\/div>/g) || []
      
      for (let i = 0; i < Math.min(businessBlocks.length, limit); i++) {
        const block = businessBlocks[i]
        
        // Extract company name
        const companyMatch = block.match(/<h3[^>]*>(.*?)<\/h3>/) || 
                            block.match(/<span[^>]*role="heading"[^>]*>(.*?)<\/span>/)
        const company = companyMatch ? companyMatch[1].replace(/<[^>]*>/g, '').trim() : ''
        
        // Extract phone number
        const phoneMatch = block.match(/(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/) ||
                          block.match(/(\+\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/)
        const phone = phoneMatch ? phoneMatch[1].trim() : ''
        
        // Extract website
        const websiteMatch = block.match(/https?:\/\/[^\s"<>]+/) ||
                            block.match(/www\.[^\s"<>]+/)
        let website = websiteMatch ? websiteMatch[0] : ''
        if (website && !website.startsWith('http')) {
          website = 'https://' + website
        }
        
        // Extract address
        const addressMatch = block.match(/\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}/) ||
                            block.match(/[^,]+,\s*[^,]+,\s*[A-Z]{2}/) ||
                            block.match(/\d+\s+[^<>]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)/i)
        const address = addressMatch ? addressMatch[0].replace(/<[^>]*>/g, '').trim() : ''
        
        // Extract email (less common in Google results, but possible)
        const emailMatch = block.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
        const email = emailMatch ? emailMatch[0] : ''
        
        // Only add if we have at least company name
        if (company) {
          leads.push({
            company,
            address,
            phone,
            email,
            website
          })
        }
      }
    } catch (error) {
      console.error('Error parsing Google results:', error)
    }
    
    return leads
  }
}

// Or even simpler - just use direct Google Places API
export class GooglePlacesSDK {
  private apiKey: string
  private endpoint = "https://maps.googleapis.com/maps/api/place"

  constructor(apiKey: string) {
    if (!apiKey.trim()) throw new Error("Google Places API key is required")
    this.apiKey = apiKey
  }

  public async searchBusinesses(query: string, location: string, limit = 10): Promise<Lead[] | string> {
    try {
      // First, search for places
      const searchResponse = await fetch(
        `${this.endpoint}/textsearch/json?` + new URLSearchParams({
          query: `${query} in ${location}`,
          key: this.apiKey
        })
      )

      const searchData = await searchResponse.json()
      
      if (searchData.status !== 'OK') {
        return `Google Places API error: ${searchData.status}`
      }

      const leads: Lead[] = []
      const places = searchData.results.slice(0, limit)

      // Get details for each place
      for (const place of places) {
        try {
          const detailsResponse = await fetch(
            `${this.endpoint}/details/json?` + new URLSearchParams({
              place_id: place.place_id,
              fields: 'name,formatted_phone_number,website,formatted_address',
              key: this.apiKey
            })
          )

          const detailsData = await detailsResponse.json()
          
          if (detailsData.status === 'OK') {
            const details = detailsData.result
            leads.push({
              company: details.name || 'Unknown Business',
              email: '', // Google Places doesn't provide emails
              phone: details.formatted_phone_number || '',
              website: details.website || '',
              address: details.formatted_address || ''
            })
          }
        } catch (error) {
          console.error('Error getting place details:', error)
        }
      }

      return leads

    } catch (error) {
      console.error("Google Places search error:", error)
      return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}