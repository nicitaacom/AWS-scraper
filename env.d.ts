declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PUSHER_APP_ID: string
      NEXT_PUBLIC_PUSHER_APP_KEY: string
      PUSHER_SECRET: string

      NEXT_PUBLIC_SUPABASE_URL: string    
      SUPABASE_SERVICE_ROLE_KEY: string

      REGION: string
      ACCESS_KEY_ID: string
      SECRET_ACCESS_KEY: string
      ACCOUNT_ID: string

      OPENAI_KEY: string

      FOURSQUARE_API_KEY: string
      GOOGLE_CUSTOM_SEARCH_API_KEY: string
      GOOGLE_CUSTOM_SEARCH_ENGINE_ID: string
      HUNTER_API_KEY: string
      SERP_API_KEY: string
      SEARCH_API_KEY: string
      TOM_TOM_API_KEY: string
      APIFY_API_KEY: string
      SCRAPING_BEE_API_KEY: string
    }
  }
}

export {}