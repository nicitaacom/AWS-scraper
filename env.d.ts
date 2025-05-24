declare global {
  namespace NodeJS {
    interface ProcessEnv {
      PUSHER_APP_ID: string
      NEXT_PUBLIC_PUSHER_APP_KEY: string
      PUSHER_SECRET: string

      GOOGLE_MAPS_API_KEY: string

      NEXT_PUBLIC_SUPABASE_URL: string    
      SUPABASE_SERVICE_ROLE_KEY: string

      REGION: string
      ACCESS_KEY_ID: string
      SECRET_ACCESS_KEY: string
      ACCOUNT_ID: string
    }
  }
}

export {}