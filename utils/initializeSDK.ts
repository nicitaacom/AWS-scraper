import { LambdaClient } from "@aws-sdk/client-lambda"
import { S3Client } from "@aws-sdk/client-s3"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"
import {TypedPusher,pusherInstance} from "../libs/pusher"
// import { FoursquareSDK } from "../SDK/don't use/FoursquareSDK";
import { GoogleCustomSearchSDK } from "../SDK/GoogleCustomSearchSDK";
import { HunterSDK } from "../SDK/HunterSDK";
// import { OpenCorporatesSDK } from "../SDK/OpenCorporatesSDK";
import { SearchSDK } from "../SDK/SearchSDK";
import { SerpSDK } from "../SDK/SerpSDK";
// import { TomTomSDK } from "../SDK/TomTomSDK";
import { RapidSDK } from "../SDK/RapidSDK";
// import { ApifyContactInfoSDK } from "../SDK/doesn't work/ApifyContactInfoSDK";
// import { ScrapingBeeSDK } from "../SDK/doesn't work/ScrapingBeeSDK";

export function initializeClients() {
  // 1. Define mutable array
  const requiredEnvs: string[] = [
    'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'PUSHER_APP_ID', 'NEXT_PUBLIC_PUSHER_APP_KEY', 'PUSHER_SECRET',
    'OPENAI_KEY'
  ]


  try {
  const missing = requiredEnvs.filter(env => !process.env[env])
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`)


  // 4. AWS configuration
  const awsConfig = { region: process.env.REGION, credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY } }
  const appId = process.env.PUSHER_APP_ID
  const key = process.env.NEXT_PUBLIC_PUSHER_APP_KEY
  const secret = process.env.PUSHER_SECRET
  

    // 5. Initialize and return clients
    return {
      lambda: new LambdaClient(awsConfig),
      s3: new S3Client(awsConfig),
      supabase: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
      pusher: new TypedPusher({ appId, key, secret, cluster: "eu", useTLS: true }),
      openai: new OpenAI({ apiKey: process.env.OPENAI_KEY }),

      // duckduckGoSDK:new DuckDuckGoSDK(), // this DOES NOT WORK (tweacked 3 times with AI)
      // foursquareSDK: new FoursquareSDK(process.env.FOURSQUARE_API_KEY),
      googleCustomSearchSDK: new GoogleCustomSearchSDK(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID),
      hunterSDK: new HunterSDK(process.env.HUNTER_API_KEY),
      // openCorporatesSDK: new OpenCorporatesSDK(),
      searchSDK: new SearchSDK(process.env.SEARCH_API_KEY),
      serpSDK: new SerpSDK(process.env.SERP_API_KEY),
      // tomtomSDK: new TomTomSDK(process.env.TOM_TOM_API_KEY),
      // apifyContactInfoSDK: new ApifyContactInfoSDK(process.env.APIFY_API_KEY),
      // scrapingBeeSDK: new ScrapingBeeSDK(process.env.SCRAPING_BEE_API_KEY),
      rapidSDK: new RapidSDK(process.env.RAPID_API_KEY),
      
    }
  } catch (error: unknown) {
    return `Client initialization failed: ${error instanceof Error ? error.message : String(error)}`
  }
}


