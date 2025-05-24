You're building a lead scraper Lambda function.

**What it does**:
- Scrapes business leads using Google Maps API
- Uses AI or internal logic to split a single large request into 4 regional chunks: North, South, West, East
- If leads limit is too large for Lambda's 15min timeout, split into multiple child jobs
- Merge results of child jobs into parent
- Deduplicate, combine all into 1 CSV
- Upload result to S3 and insert download link into Supabase DB

**Important behavior**:
1. If total requested leads exceed 15min runtime (e.g. 500k+), split into parallel Lambdas
2. Trigger each Lambda with input region, keyword, location, and limit
3. Every 30 seconds, update `leads_count` in Supabase table to show progress
4. Merge all CSVs into 1 when jobs finish
5. Deduplicate leads
6. If result CSV has fewer leads than `limit`, retry up to 3 times (excluding duplicates)
7. If after 3 retries result is still below limit — return what was found
   - Include a flag in response that says: `"message": "Not enough leads in this location"` with 206-like status
8. Once child job done - updateDB and trigger "scraper:update" with id and message and leads_count
9. Pusher error should contain human-readable format and has only  id: string    error: string (so all info should be in error)

**Response behavior**:
- Return early with status `202` if task is split
- But also trigger Lambdas for each region immediately
- Log which regions were triggered
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

**Output**: Optimized, readable, production-grade Lambda handler with JSDoc explaining all steps