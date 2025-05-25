import fetch from "node-fetch"
import { Lead } from "../interfaces/interfaces"
import { scrapeEmailFromWebsite } from "../utils/scrapeEmailFromWebsite"

/**
 * TomTom Places API SDK
 * FREE: 2,500 requests/day
 * Best for: Comprehensive POI and business data
 * Provides: Name, address, phone, categories
 * Enhanced: Scrapes emails from websites when available
 */
export class TomTomSDK {
  private baseUrl = "https://api.tomtom.com/search/2"
  
  constructor(private apiKey: string) {}

  // 1. Search businesses by query and location
  public async searchBusinesses(query: string, location: string, limit: number = 100): Promise<Lead[] | string> {
    // 2. Validate limit
    if (limit > 100) return "Recommended limit is 100 for performance"
    
    // 3. Get coordinates for location
    const coordinates = await this.getCoordinatesFromLocation(location)
    if (typeof coordinates === 'string') return coordinates
    
    // 4. Perform search
    try {
      const params = new URLSearchParams({
        key: this.apiKey,
        query: query,
        countrySet: this.extractCountryCode(location),
        limit: Math.min(limit, 100).toString(),
        categorySet: this.getBusinessCategories(),
        extendedPostalCodesFor: 'Addr,POI',
        ...(coordinates ? { lat: coordinates.lat.toString(), lon: coordinates.lon.toString(), radius: '50000' } : {})
      })
      
      const response = await fetch(`${this.baseUrl}/poiSearch/${encodeURIComponent(query)}.json?${params}`)
      if (!response.ok) return `TomTom API error: ${response.status} - ${response.statusText}`
      
      const data = await response.json()
      if (!data.results?.length) return "No businesses found for the given query and location"
      
      // 5. Process results
      const leads = await Promise.all(
        data.results.map(async (poi: any) => ({
          company: poi.poi?.name || "",
          address: this.formatAddress(poi.address),
          phone: this.cleanPhone(poi.poi?.phone || ""),
          email: poi.poi?.url ? await scrapeEmailFromWebsite(poi.poi.url) : "",
          website: poi.poi?.url || ""
        }))
      )
      
      return leads.filter(lead => lead.company)
    } catch (error) {
      return `TomTom search failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // 6. Get coordinates from location string
  private async getCoordinatesFromLocation(location: string): Promise<{lat: number, lon: number} | string> {
    try {
      const params = new URLSearchParams({ key: this.apiKey, query: location, limit: '1' })
      const response = await fetch(`${this.baseUrl}/geocode/${encodeURIComponent(location)}.json?${params}`)
      if (!response.ok) return `Geocoding failed: ${response.status} - ${response.statusText}`
      
      const data = await response.json()
      return data.results?.length ? { lat: data.results[0].position.lat, lon: data.results[0].position.lon } : "No coordinates found for location"
    } catch (error) {
      return `Geocoding error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // 7. Extract country code from location
  private extractCountryCode(location: string): string {
    const countryMappings: {[key: string]: string} = {
      'usa': 'US', 'united states': 'US', 'america': 'US', 'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB',
      'canada': 'CA', 'australia': 'AU', 'germany': 'DE', 'france': 'FR', 'italy': 'IT', 'spain': 'ES',
      'netherlands': 'NL', 'belgium': 'BE', 'sweden': 'SE'
    }
    return Object.entries(countryMappings).find(([k]) => location.toLowerCase().includes(k))?.[1] || 'US'
  }

  // 8. Get business category codes
  private getBusinessCategories(): string {
    return ['7315', '7321', '7374', '7313', '9361', '7328', '7302', '7318', '7377', '9663'].join(',')
  }

  // 9. Format address from API response
  private formatAddress(address: any): string {
    if (!address) return ""
    const parts = [address.streetNumber, address.streetName, address.municipality, address.countrySubdivision, address.postalCode, address.country].filter(Boolean)
    return parts.join(", ")
  }

  // 10. Clean phone number
  private cleanPhone(phone: string): string {
    return phone.replace(/[^\d]/g, "")
  }
}