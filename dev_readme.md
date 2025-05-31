You're building a lead scraper Lambda function.

**What it does**:
- Scrapes business leads using free SDKs (if SDK provide no emails - use scrapeEmailFromWebsite in SDK)
- Uses AI or internal logic to split a single large request into 4 chunks it split string[] with cities into 4 smaller chunks
- Anyway split split into multiple child jobs using `scraper.generateRegionalChunks` 4 (parallel Lambdas) (current speed 1 lead per 2 seconds)
- If leads limit is too large and outside of free plans of all SDKs then updateDB message column and trigger pusher event "scraper:error"
  with human readable formatted text that explains status on each free SDK (free tier limit)
- Merge results of child jobs into parent
- Once child task is done - updateDB column "message" then pusher.trigger "scraper:update"
- Remove duplicates then combine into 1 CSV file then if CSV length less then limit - check if still within free tier - if yes scrape more leads
- Once completed upload result to S3 and update "downloadable_link" and "message" and "status" to completed and pusher.trigger event "scraper:completed"

**Important behavior**:
 1. Trigger each Lambda with input that has JobPayload type
 2. Every 30 seconds (create const on top of the file for that), update `leads_count` in Supabase table to show progress
 3. If result CSV has fewer leads than `limit`, retry up to 3 times (excluding duplicates)
 4. If after 3 retries result is still below limit — return what was found
   - Include a flag in response that says: `"message": "Not enough leads in this location"` with 206-like status
 5. Once child job done - updateDB and trigger "scraper:update" with id and message and leads_count
 6. Pusher error should contain human-readable format and has only  id: string    error: string (so all info should be in error)
 7. Handle cases when user (using retryCount) if enter not realistic limit e.g 500000 and it's no such amount "keyword" in "location"
 8. Dynamically distributes unique cities across SDKs and redistributes failed cities to remaining SDKs for balanced parallel scraping.
**Response behavior**:
- Return early with status `202` if task has been splitted (console log also payload for each job task)
- Log which regions were triggered
- Log errors in order to debug it - include emojies in error 
- Use executionLogs in order to show full log in "scraper:update" and DB "message" column
- Use AWS SDK's LambdaClient + InvokeCommand for invocation
- Shorten code using ternaries and one-liners where possible
- Make the whole Lambda handler concise but readable
- Must be only 1 export (handler) no other exported functions is required

**Code considerations**:
1. Use strict TypeScript (noImplicitAny enabled), fully annotating all parameters (including callbacks) and return types.
2. Consider using ternary where possible
3. If some function is long and requires a lot of steps - use comments e.g // 1. Do smth first // 2. Do smth second
4. Write code in 1 line where possible
5. Keep code DRY SOLID KISS
6. If function fails (error) - return string with error message and then check if function returned typeof === 'string' then throw Error 
7. If any TODO of FIX in code you need to fix it or do something that is written in commented TODO line


**Code architecture**
## Current SQL structure

```sql
create table public.scraper (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  status text not null default 'pending'::text,
  downloadable_link text null,
  keyword text not null,
  "limit" integer not null,
  location text not null,
  region text null,
  completed_in_s integer null,
  message text null,
  leads_count integer not null default 0,
  channel_id text null,
  parent_id uuid null,
  part_number integer null,
  total_parts integer null,
  constraint scraper_pkey primary key (id)
) TABLESPACE pg_default;

 -- 💻 SDK Free Tier Usage Tracking (dynamic periods + fixed-safe)
  CREATE TABLE IF NOT EXISTS public.sdk_freetier (
    sdk_name TEXT PRIMARY KEY,
    limit_type TEXT NOT NULL CHECK (limit_type IN ('monthly', 'daily', 'minute', 'fixed')),
    used_count INTEGER NOT NULL DEFAULT 0,
    limit_value INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_duration INTERVAL, -- 🔒 NULL = no reset (used by 'fixed')
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- 🚀 Seed default SDK limits
  INSERT INTO public.sdk_freetier (sdk_name, limit_type, limit_value, period_duration)
  VALUES 
    ('duckduckgo',          'monthly', 100,   INTERVAL '30 days'),
    ('foursquare',          'fixed',   20000, NULL),               -- credit-based (manual reset)
    ('google',              'monthly', 10000, INTERVAL '30 days'),
    ('hunter',              'monthly', 25,    INTERVAL '30 days'),
    ('opencorporates',      'monthly', 200,   INTERVAL '30 days'),
    ('search',              'monthly', 100,   INTERVAL '30 days'),
    ('serp',                'monthly', 100,   INTERVAL '30 days'),
    ('tomtom',              'daily',   2500,  INTERVAL '1 day'),
    ('apifyContactInfoSDK', 'monthly', 500,   INTERVAL '30 days'),
    ('parseHubSDK',         'monthly', 200,   INTERVAL '30 days');
  ON CONFLICT (sdk_name) DO NOTHING;

  -- 🔄 Auto-update updated_at on row changes
  CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER sdk_freetier_updated
  BEFORE UPDATE ON public.sdk_freetier
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

  -- 🕒 Daily dynamic resets (⛔ exclude 'fixed' & NULL durations)
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  SELECT cron.schedule(
    'reset-dynamic-limits',
    '0 0 * * *',  -- Every day at midnight UTC
    $$
    UPDATE public.sdk_freetier
    SET 
      used_count = 0,
      period_start = NOW()
    WHERE limit_type IN ('monthly', 'daily', 'minute')
      AND period_duration IS NOT NULL
      AND NOW() - period_start >= period_duration;
    $$
  );

  -- 🔐 Row Level Security
  ALTER TABLE public.sdk_freetier ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Allow public read access"
  ON public.sdk_freetier FOR SELECT USING (true);

  CREATE POLICY "Allow full access for authenticated"
  ON public.sdk_freetier FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
  
```

Pusher channels (if needed add new data but notify about it in response)
Event: "scraper:completed"
Data
```ts
  type LambdaScraperCompleted = {
    id: string
    downloadable_link: string
    completed_in_s: number
    leads_count: number
    message: string
    status: "completed"
  }
```

Event: "scraper:update"
Data:
```ts
  type LambdaScraperUpdate = {
    id: string
    message: string
    leads_count?: number
  }
```

Event: "scraper:error"
Data:
```ts
  type LambdaScraperError = {
    id: string
    error: string
  }
```
Note: it's only 3 statuses "completed" "pending" "error" - so use only these

Here is all interfaces and types
```ts
[PASTE FROM interfaces.ts]
```

Here is index.ts
[PASTE]


**Output**: Optimized, readable, production-grade Lambda handler with JSDoc for handler function that explains what it does










<br/>
<br/>
<br/>
<hr/>


# Prompt for SDK
You’re an AI assistant specialized in TypeScript SDKs. Write a fully-functional, free-tier SDK class (like the example above) that:
1. Uses a free web-search API to find businesses by query & location (supports any industry—roofing, restaurants, lawyers, etc.).
2. Returns URLs, snippets, titles and scrapes emails if the API doesn’t supply them, using:

```ts
import { scrapeEmailFromWebsite } from "../utils/scrapeEmailFromWebsite"
```
3. Extracts business name, address, phone (via regex), and email.
4. Honors free-tier rate limits and safe search.
5. Handles errors by returning the error message string.
Include clear comments (//1. do sth), use one-line concise code & ternaries, and avoid tiny abbreviations like idx, ctx, or e.
Make sure phone numbers does not include spaces slashes dashes or any other symbols - it must be numbers only including country code e.g "441642296631"

SDK in use:
```sql
   ('foursquareSDK',         'fixed',   20000, NULL),               -- credit-based (manual reset)
    ('googleCustomSearchSDK', 'monthly', 10000, INTERVAL '30 days'),
    ('hunterSDK',             'monthly', 25,    INTERVAL '30 days'),
    ('searchSDK',             'monthly', 100,   INTERVAL '30 days'),
    ('serpSDK',               'monthly', 100,   INTERVAL '30 days'),
    ('tomtomSDK',             'daily',   2500,  INTERVAL '1 day'),
    ('rapidAPI',              'monthly', 500000, INTERVAL '30 days')
```
DO NOT USE list:
 1. BingSearchSDK  because "Product to be retired Bing Search and Bing Custom Search APIs will be retired on 11th August 2025"
 2. ClearbitSDK because ❗API keys are available for Clearbit accounts created in 2023 and earlier. If you signed up in 2024,
    free or paid plans with API keys are not available.
 3. HereSDK because it ask to link a card - so it's not going to be free
 4. NominatimSDK require card to get API key
 5. YelpSDK because it's not free
 6. PuppeteerGoogleMapsSDK because it's Runtime.OutOfMemory and max size is 50MB (86MB)
 6. OutscraperSDK because it required to link card and also it will charge for outside free limit but I want to disable any charges
 7. ParseHub - outdated shi* with empty UI https://i.imgur.com/kKbRqZ6.png and also I need to download some... - too complicated
 
Need check (still don't use - it's just waste of time): 
 8. duckduckGoSDK - it's just doesn't work - tweacked 3 times with AI - still not working
 9. apifyContactInfoSDK (limit 500/m) because error - URLs array is required - https://i.imgur.com/wouc617.png
 10. scrapingBeeSDK because (limit 200/m) - ScrapingBee API error: 400 - https://i.imgur.com/wouc617.pn
[INCLUDE 1 EXAMPLE OF SDK HERE]
 11. openCorporatesSDK - because - OpenCorporates search failed: OpenCorporates API error: [object Object] - https://i.imgur.com/U32MsPM.png

Now send me concise files - each file represents SDK that allows to scrape leads by "keyword" and "location" and "limit"
limit it's a number that limits usage to stay within free tier - if input is outside of free tier per then return error as string




docs on how to create SDK:
1. copy paste API key in lambda + update env.d.ts + initializeSDK
2. add it in docs "SDK in use" and in createSDKFreetierTable (on outreach tool)
3. add it in DB e.g
```sql
  INSERT INTO public.sdk_freetier (sdk_name, limit_type, limit_value, period_duration)
  VALUES ('scrapingBeeSDK', 'monthly', 200, INTERVAL '30 days')
  ON CONFLICT (sdk_name) DO NOTHING;
``` 
4. create a file e.g RapidSDK.ts

Recent logs:
```
⏱️ Progress: 5 leads found in 1m 00s
🏙️ Processing 1 cities: Hamburg
🎯 Target: 17 leads per city (17 total)

🔍 ATTEMPT 1 - City: Hamburg --------------------
SDK Status: ✅ Available: openCorporatesSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, tomtomSDK, duckduckGoSDK, apifyContactInfoSDK, scrapingBeeSDK | ❌ Unavailable: searchSDK (106/100), serpSDK (105/100)
🎯 Need 17 more leads (0/17)
🏙️ Scraping "it company" in Hamburg
🚀 Using 8 SDKs (3+2+2+2(16 max)+2+2+2+2=17): duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, tomtomSDK, apifyContactInfoSDK, scrapingBeeSDK
🔍 duckduckGoSDK: fetching 3 leads in Hamburg...
✅ duckduckGoSDK: got 0 leads
🔍 foursquareSDK: fetching 2 leads in Hamburg...
✅ foursquareSDK: got 2 leads
🔍 googleCustomSearchSDK: fetching 2 leads in Hamburg...
✅ googleCustomSearchSDK: got 1 leads
🔍 hunterSDK: fetching 2 leads in Hamburg...
✅ hunterSDK: got 0 leads
🔍 openCorporatesSDK: fetching 2 leads in Hamburg...
❌ openCorporatesSDK error: OpenCorporates search failed: OpenCorporates API error: [object Object]
🔍 tomtomSDK: fetching 2 leads in Hamburg...
✅ tomtomSDK: got 2 leads
🔍 apifyContactInfoSDK: fetching 2 leads in Hamburg...
❌ apifyContactInfoSDK error: URLs array is required
🔍 scrapingBeeSDK: fetching 2 leads in Hamburg...
❌ scrapingBeeSDK error: Error: ScrapingBee API error: 400

🔍 ATTEMPT 2 - City: Hamburg --------------------
SDK Status: ✅ Available: openCorporatesSDK, duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, tomtomSDK, apifyContactInfoSDK, scrapingBeeSDK | ❌ Unavailable: searchSDK (106/100), serpSDK (105/100)
🎯 Need 12 more leads (5/17)
🏙️ Scraping "it company" in Hamburg
🚀 Using 8 SDKs (5+1+1+1(16 max)+1+1+1+1=12): duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, tomtomSDK, apifyContactInfoSDK, scrapingBeeSDK
🔍 duckduckGoSDK: fetching 5 leads in Hamburg...
✅ duckduckGoSDK: got 0 leads
🔍 foursquareSDK: fetching 1 leads in Hamburg...
✅ foursquareSDK: got 0 leads
🔍 googleCustomSearchSDK: fetching 1 leads in Hamburg...
✅ googleCustomSearchSDK: got 0 leads
🔍 hunterSDK: fetching 1 leads in Hamburg...
✅ hunterSDK: got 0 leads
🔍 openCorporatesSDK: fetching 1 leads in Hamburg...
❌ openCorporatesSDK error: OpenCorporates search failed: OpenCorporates API error: [object Object]
🔍 tomtomSDK: fetching 1 leads in Hamburg...
```