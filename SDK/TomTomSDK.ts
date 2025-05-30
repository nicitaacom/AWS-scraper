import fetch from "node-fetch";
import { Lead } from "../interfaces/interfaces";
import { scrapeContactsFromWebsite } from "../utils/scrapeContactsFromWebsite";

// Interface for geocoding result data
interface LocationData {
  lat: number;
  lon: number;
  countryCode: string;
  entityType: string;
}

/**
 * TomTom Places API SDK
 * FREE: 2,500 requests/day
 * Best for: Comprehensive POI and business data
 * Provides: Name, address, phone, categories
 * Enhanced: Scrapes emails from websites when available
 * If error returns string wtih error message
 */
export class TomTomSDK {
  private baseUrl = "https://api.tomtom.com/search/2";

  constructor(private apiKey: string) {}

  // Search businesses by query and location
  public async searchBusinesses(query: string, location: string, limit: number = 100): Promise<Lead[] | string> {
    if (limit > 100) return "Recommended limit is 100 for performance";

    const locationData = await this.getCoordinatesFromLocation(location);
    if (typeof locationData === "string") return locationData;

    const { lat, lon, countryCode, entityType } = locationData;
    const params = new URLSearchParams({
      key: this.apiKey,
      query,
      countrySet: countryCode,
      limit: Math.min(limit, 100).toString(),
      categorySet: this.getBusinessCategories(),
      extendedPostalCodesFor: "Addr,POI",
    });

    if (entityType !== "Country") {
      params.append("lat", lat.toString());
      params.append("lon", lon.toString());
      params.append("radius", "50000"); // 50 km radius
    }

    try {
      let response = await fetch(`${this.baseUrl}/poiSearch/${encodeURIComponent(query)}.json?${params}`);
      if (!response.ok) return `TomTom API error: ${response.status} - ${response.statusText}`;

      let data = await response.json();
      if (!data.results?.length) {
        // Fallback: retry without categorySet if no results
        params.delete("categorySet");
        response = await fetch(`${this.baseUrl}/poiSearch/${encodeURIComponent(query)}.json?${params}`);
        if (!response.ok) return `TomTom API error: ${response.status} - ${response.statusText}`;
        data = await response.json();
      }

      if (!data.results?.length) return "No businesses found for the given query and location";

      const leads = await Promise.all(
        data.results.map(async (poi: any) => ({
          company: poi.poi?.name || "",
          address: this.formatAddress(poi.address),
          phone: this.cleanPhone(poi.poi?.phone || ""),
          email: poi.poi?.url ? (await scrapeContactsFromWebsite(poi.poi.url)).email : "",
          website: poi.poi?.url || "",
        }))
      );

      return leads.filter((lead) => lead.company);
    } catch (error) {
      return `TomTom search failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Get coordinates and additional data from location string
  private async getCoordinatesFromLocation(location: string): Promise<LocationData | string> {
    try {
      const params = new URLSearchParams({ key: this.apiKey, query: location, limit: "1" });
      const response = await fetch(`${this.baseUrl}/geocode/${encodeURIComponent(location)}.json?${params}`);
      if (!response.ok) return `Geocoding failed: ${response.status} - ${response.statusText}`;

      const data = await response.json();
      if (!data.results?.length) return "No coordinates found for location";

      const result = data.results[0];
      return {
        lat: result.position.lat,
        lon: result.position.lon,
        countryCode: result.address.countryCode,
        entityType: result.type === "Geography" ? result.entityType : "Other",
      };
    } catch (error) {
      return `Geocoding error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Get business category codes
  private getBusinessCategories(): string {
    return ["7315", "7321", "7374", "7313", "9361", "7328", "7302", "7318", "7377", "9663"].join(",");
  }

  // Format address from API response
  private formatAddress(address: any): string {
    if (!address) return "";
    const parts = [
      address.streetNumber,
      address.streetName,
      address.municipality,
      address.countrySubdivision,
      address.postalCode,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  }

  // Clean phone number
  private cleanPhone(phone: string): string {
    return phone.replace(/[^\d]/g, "");
  }
}