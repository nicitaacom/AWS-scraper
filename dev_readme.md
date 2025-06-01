You're building a lead scraper Lambda function.

**What it does**:
- Scrapes business leads using free SDKs (if SDKs provide no emails – fallback to `scrapeEmailFromWebsite` in SDK).
- Uses AI/internal logic to split a large request (`string[]` of cities) into smaller RLs (Request Lengths).
- Uses `scraper.generateRegionalChunks` that returns string[] of cities to scrape leads those cities
- For example limit is 200 and 100 cities and 5 available SDKs so it's 40 limit per SDK and 20 cities per SDK
  If SDK1 found 40 leads in 3 cities then exit cities loop
- If SDK1 requested limit to find 40 leads in 20 cities but not found something in 1 city - deligate this city to other SDK
  If other SDK not found that leads in that city as well - then skip this city
- Jobs run **sequentially** (not in parallel) to avoid 429s, track `completed_in_s`, and respect `MAX_RUNTIME_MS`.
- SDKs run **parallel** in order to increase performance
- 10s limit for to scrape 1 city using SDK - if not found within 10s - move to another city
- There is **no parent job** — the chain starts with Job1 and continues auto-chaining:
  - Each job scrapes up to `MAX_LEADS_PER_JOB` (~346 leads in 13 mins).
  - Chain continues until `targetLimit` is reached **or** max allowed jobs cap (`MAX_JOBS_ALLOWED = 1509`) is hit.
  - This ensures total scraped leads never exceed SDK credit limits (e.g., 522,500 monthly across all SDKs).
  - Final job uploads CSV, updates DB, and triggers Pusher.
- If leads limit is too large and outside of free plans of all SDKs then updateDB message column and trigger pusher event "scraper:error"
  with human-readable formatted text that explains status on each free SDK (free tier limit)
- Merge results of child jobs into parent
- Once child task is done - updateDB column "message" then pusher.trigger "scraper:update"
- Remove duplicates then combine into 1 CSV file then if CSV length less then limit - check if still within free tier - if yes scrape more leads
- Once completed upload result to S3 and update "downloadable_link" and "message" and "status" to completed and pusher.trigger event "scraper:completed"

**Important behavior**:
 1. JobPayload: Trigger each Lambda with input that has JobPayload type
 2. Real time updates: Every 10 seconds (create const on top of the file for that), update `leads_count` in Supabase table to show progress
 3. Human readable format: Pusher error should contain human-readable format and has only  id: string    error: string (so all info should be in error)
 4. Retry: If result CSV has fewer leads than `limit`, retry up to 3 times (excluding duplicates)
    If after 3 retries result is still below limit — return what was found and include a flag in response that says:
    `"message": "Not enough leads in this location"` with 206-like status
 5. on job completed: Once job done - updateDB and trigger "scraper:update" with id and message and leads_count (use some IRealTimeUpdate)
 6. Limit handling free tier: if when user enter not realistic limit that exeeds .reduce sum of limit_value from "sdk_freetier" table in DB
    then return error that say that user exeeded free tier
 7. Limit handling location: handled by AI that not allow user to enter city - it allows only inputs like Country North-North
 8. 🧠 Scraping logic: Allocates an even number of unique cities to each SDK based on its remaining usage limits.  
    If an SDK fails for a city, that city is automatically retried using another SDK that still has available credits.
    Example: If `searchSDK` input ["Berlin","Erkner"] "Erkner" fails, it’s retried on `googleCustomSearchSDK` or `serpSDK`, depending on availability.
 9. If some SDK require more delay due to 429 - then update delay in this.searchBusinessesUsingSDK

**Code considerations**:
1. TypeScript noImplicitAny:true - fully annotating all parameters (including callbacks) and return types.
2. If some function is long and requires a lot of steps - use comments e.g // 1. Do smth first // 2. Do smth second
3. Write code in 1 line where possible - spread out if possible using ...
4. Keep code DRY SOLID KISS
5. If function fails (error) - return string with error message and then check in high-level function returned typeof === 'string' then throw Error 
6. If any TODO of FIX in code you need to fix it or do something that is written in commented TODO line


**Response behavior**:
- Return early with status `202` if task has been continued in next job (add payload in executionLogs for each job task)
- Log errors in order to debug it DO NOT add debug logs if I not asked - include emojies in error and use this.SDK_EMOJIS[sdkName] (e.g [📊SerpSDK]: some logs)
- Use casual style in executionLogs
  For example:
  ```
  job1 - ok I'm running to scrape 40000 leads for you - 12-13 mins later - it says "oh.. seems like I'm already retierd 😅
  I found 5000 leads 🔥 - let my job2 to take care of the rest of 35000 leads for ya.. 😎"
  ```
- Use executionLogs in order to show full log in "scraper:update" and DB "message" column
- Use AWS SDK's LambdaClient + InvokeCommand for invocation
- Shorten code using ternaries and one-liners where possible (if function is long send it in separated file and export)
- Validate all required envs + inputs at the top using readable arrays & for-loop.
- Move methods into SDK - if they are not used in index.ts - make them private - if reused more then 2 times - create additionl method
  if object properties it too long 4+ then create interface and spread out usng ...someInterface instead of passing each from new line
- Group logic into steps using clear comment blocks and follow this code style 
```ts
  // ------ 1. Create instances + variables ------ //
    // 1.1 [INSTANCE]: Create Redis SDK instance
  const redis = new Redis(process.env.UPSTASH_REDIS_URL)

  etc
    // ------ 2. 20% ? AI reply : send warumup email (+manage up/down scale volume) ------ //
  const isAIReply = Math.random() < 0.2;
  // const isAIReply = true
  if (isAIReply) {
    const replyWithAIResp = await warmup.replyToWarumEmailWithAI(warmupToUpdate)
    if (typeof replyWithAIResp === 'string') throw Error(`Error on line 121: ${replyWithAIResp}`,{cause:"replyWithAIResp"})
  }
  else {
    const updScheduleResp = await warmup.updateSchedule(warmups, warmupToUpdate)
    if (typeof updScheduleResp === 'string') throw Error(`Error on line 125: ${updScheduleResp}`,{cause:"updScheduleResp"})
  } 

  someClass.ts
  /** Upsert a Stripe price into Supabase */
  public async upsertPriceRecord(price: Stripe.Price): Promise<void> {
    const payload: Price = {
      id: price.id,
      product_id: typeof price.product === "string" ? price.product : "",
      active: price.active,
      currency: price.currency,
      description: price.nickname ?? undefined,
      type: price.type,
      // a lof of additional properties here
    }
    const { error } = await this.supabase.from(this.prices).upsert([payload])
    if (error) throw error
    console.log(`Price upserted: ${price.id}`)
  }
   /**
   * Upsert or update subscription in Redis after Stripe sends status-change.
   * @param subscriptionId Stripe subscription ID
   */
  public async manageSubscriptionStatusChange(subscriptionId: string, customerId: string, createAction = false): Promise<void> {
    try {
      const userId = await this.getCustomerUserId(customerId)
      const pay = await this.retrievePaymentDetails(subscriptionId)
      const plan = this.getPlanConfig(pay.paymentIntent, pay.subscription)
      const existing = await this.getExistingSubscription(userId)

      if (createAction) {
        await this.copyBillingDetails(createAction, pay.subscription, pay.paymentIntent, customerId)
      }

      // Build & save subscription data in Redis
      const subData = await this.buildSubscriptionData({
        id: subscriptionId,
        userId,
        planConfig: plan,
        existingSubscription: existing,
        isRecurrent: pay.isRecurrent,
        subscription: pay.subscription,
      })
      await this.saveToRedis(userId, subData)
      console.log(`Subscription ${subscriptionId} synced to Redis.`)
    } catch (err) {
      console.error("Subscription sync failed:", err)
      throw err
    }
  }
  ```



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


### index.ts - what going on there?
Main Functions in index.ts
handler(event: JobPayload) - Main Entry Point

Validates input payload and free-tier limits
Loads existing leads from previous jobs/retries
Generates cities using OpenAI if not provided
Scrapes leads using available SDKs (up to MAX_LEADS_PER_JOB)
Handles retries (same job) vs chaining (new job)
Uploads CSV to S3 and triggers Pusher events


What functions do you need to see to solve current issues (tasks)?
now reply only with functions that you need - no explanations or code is required yet

Here is all interfaces and types
```ts
[PASTE FROM interfaces.ts]
```

Current issues:
 1. 









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
    ('googleCustomSearchSDK', 'monthly', 10000, INTERVAL '30 days'),
    ('hunterSDK',             'monthly', 25,    INTERVAL '30 days'),
    ('searchSDK',             'monthly', 100,   INTERVAL '30 days'),
    ('serpSDK',               'monthly', 100,   INTERVAL '30 days'),
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
 8. foursquareSDK - don't provide email or phone or website
 9. tomtomSDK - don't provide email or phone or website
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

Recent logs: all logs has been deleted for some reason after 16 minutes
```

```