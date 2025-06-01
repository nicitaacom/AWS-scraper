"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeClients = initializeClients;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_s3_1 = require("@aws-sdk/client-s3");
const supabase_js_1 = require("@supabase/supabase-js");
const openai_1 = __importDefault(require("openai"));
const pusher_1 = require("../libs/pusher");
// import { FoursquareSDK } from "../SDK/don't use/FoursquareSDK";
const GoogleCustomSearchSDK_1 = require("../SDK/GoogleCustomSearchSDK");
const HunterSDK_1 = require("../SDK/HunterSDK");
// import { OpenCorporatesSDK } from "../SDK/OpenCorporatesSDK";
const SearchSDK_1 = require("../SDK/SearchSDK");
const SerpSDK_1 = require("../SDK/SerpSDK");
// import { TomTomSDK } from "../SDK/TomTomSDK";
const RapidSDK_1 = require("../SDK/RapidSDK");
// import { ApifyContactInfoSDK } from "../SDK/doesn't work/ApifyContactInfoSDK";
// import { ScrapingBeeSDK } from "../SDK/doesn't work/ScrapingBeeSDK";
function initializeClients() {
    // 1. Define mutable array
    const requiredEnvs = [
        'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY',
        'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
        'PUSHER_APP_ID', 'NEXT_PUBLIC_PUSHER_APP_KEY', 'PUSHER_SECRET',
        'OPENAI_KEY'
    ];
    try {
        const missing = requiredEnvs.filter(env => !process.env[env]);
        if (missing.length)
            throw new Error(`Missing environment variables: ${missing.join(', ')}`);
        // 4. AWS configuration
        const awsConfig = { region: process.env.REGION, credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY } };
        const appId = process.env.PUSHER_APP_ID;
        const key = process.env.NEXT_PUBLIC_PUSHER_APP_KEY;
        const secret = process.env.PUSHER_SECRET;
        // 5. Initialize and return clients
        return {
            lambda: new client_lambda_1.LambdaClient(awsConfig),
            s3: new client_s3_1.S3Client(awsConfig),
            supabase: (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
            pusher: new pusher_1.TypedPusher({ appId, key, secret, cluster: "eu", useTLS: true }),
            openai: new openai_1.default({ apiKey: process.env.OPENAI_KEY }),
            // duckduckGoSDK:new DuckDuckGoSDK(), // this DOES NOT WORK (tweacked 3 times with AI)
            // foursquareSDK: new FoursquareSDK(process.env.FOURSQUARE_API_KEY),
            googleCustomSearchSDK: new GoogleCustomSearchSDK_1.GoogleCustomSearchSDK(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY, process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID),
            hunterSDK: new HunterSDK_1.HunterSDK(process.env.HUNTER_API_KEY),
            // openCorporatesSDK: new OpenCorporatesSDK(),
            searchSDK: new SearchSDK_1.SearchSDK(process.env.SEARCH_API_KEY),
            serpSDK: new SerpSDK_1.SerpSDK(process.env.SERP_API_KEY),
            // tomtomSDK: new TomTomSDK(process.env.TOM_TOM_API_KEY),
            // apifyContactInfoSDK: new ApifyContactInfoSDK(process.env.APIFY_API_KEY),
            // scrapingBeeSDK: new ScrapingBeeSDK(process.env.SCRAPING_BEE_API_KEY),
            rapidSDK: new RapidSDK_1.RapidSDK(process.env.RAPID_API_KEY),
        };
    }
    catch (error) {
        return `Client initialization failed: ${error instanceof Error ? error.message : String(error)}`;
    }
}
