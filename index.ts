import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createClient } from "@supabase/supabase-js"
import Pusher from "pusher"
import OpenAI from "openai"
import fetch from "node-fetch"
import { v4 as uuidv4 } from "uuid"
import { JobError, JobPayload, Lead } from "./interfaces/interfaces"
import { Scraper } from "./SDK/scraper"
import { initializeClients } from "./utils/initializeSDK"
import { formatDuration, getCurrentDate } from "./utils/date-utils"
import { checkSDKAvailability } from "./utils/checkSDKAvailability"

// ------ Constants ------ //
export const BUCKET = process.env.S3_BUCKET || "scraper-files-eu-central-1"
export const MAX_RUNTIME_MS = 13 * 60 * 1000 // export it to use in Scraper because somtimes it get stuck
const PROGRESS_UPDATE_INTERVAL = 10000
export const MAX_RETRIES = 3
// I thought about 1509 but I thought that it's dangerous due to cost for lambda function usage
// So for now limit should be low
const MAX_JOBS_ALLOWED = 4
const IS_DEBUGGING = true

// ------ Helper Functions ------ //
const startProgressUpdater = (id: string, channelId: string, getCurrentCount: () => number, getCurrentLogs: () => string, startTime: number) => {
  const updateProgress = async () => {
    try {
      const currentCount = getCurrentCount()
      const currentLogs = getCurrentLogs()
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000)
      const formattedTime = formatDuration(elapsedSeconds)
      const message = `⏱️ Progress: ${currentCount} leads found in ${formattedTime}\n${currentLogs}`
      await scraper.updateDBScraper(id, { leads_count: currentCount, message, status:'pending' })
      await pusher.trigger(channelId, "scraper:update", { id, leads_count: currentCount, message,  })
    } catch (error) {
      console.error(`🔄 Progress update error for ${id}:`, error)
    }
  }
  return setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL)
}

const loadExistingLeads = async (id: string): Promise<Lead[]> => {
  try {
    const { data } = await supabase.from("scraper").select("downloadable_link").eq("id", id).single()
    if (!data?.downloadable_link) return []
    
    const response = await fetch(data.downloadable_link)
    if (!response.ok) return []
    
    const csvText = await response.text()
    const lines = csvText.split('\n').slice(1) // Skip header
    
    return lines.filter(line => line.trim()).map(line => {
      const [company, address, phone, email, website] = line.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'))
      return { company: company || '', address: address || '', phone: phone || '', email: email || '', website: website || '' }
    })
  } catch (error) {
    if (IS_DEBUGGING) console.error('[debug] Failed to load existing leads:', error)
    return []
  }
}

const validateFreeTierLimits = async (limit: number): Promise<{ valid: boolean; error?: string }> => {
  try {
    const { data: sdkLimits } = await supabase.from("sdk_freetier").select("limit_value")
    if (!sdkLimits) return { valid: false, error: "Unable to fetch SDK limits" }
    
    const totalLimit = sdkLimits.reduce((sum, sdk) => sum + sdk.limit_value, 0)
    if (limit > totalLimit) {
      return { 
        valid: false, 
        error: `Request exceeds free tier limits. Maximum available: ${totalLimit} leads across all SDKs` 
      }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, error: `Error validating limits: ${(error as Error).message}` }
  }
}

const getJobChainPosition = async (id: string): Promise<{ position: number; totalJobs: number }> => {
  try {
    // Get all jobs for this chain (same original request)
    const { data: firstJob } = await supabase.from("scraper").select("created_at, keyword, location, limit").eq("id", id).single()
    if (!firstJob) return { position: 1, totalJobs: 1 }
    
    // Find all jobs with same parameters created around the same time (within 1 hour)
    const timeWindow = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: chainJobs } = await supabase
      .from("scraper")
      .select("id, created_at")
      .eq("keyword", firstJob.keyword)
      .eq("location", firstJob.location)
      .eq("limit", firstJob.limit)
      .gte("created_at", timeWindow)
      .order("created_at", { ascending: true })
    
    if (!chainJobs) return { position: 1, totalJobs: 1 }
    
    const position = chainJobs.findIndex(job => job.id === id) + 1
    return { position, totalJobs: chainJobs.length }
  } catch (error) {
    if (IS_DEBUGGING) console.error('[debug] Error getting job chain position:', error)
    return { position: 1, totalJobs: 1 }
  }
}
















// ------ Initialize Clients ------ //
const init = initializeClients()
if (typeof init === "string") throw Error(init)

const { lambda, s3, supabase, pusher, openai, ...allSDKs } = init
const scraper = new Scraper(openai, s3, pusher, supabase, lambda)
const sdks = allSDKs

export const handler = async (event: JobPayload): Promise<{ statusCode: number; body: string }> => {
  const start = Date.now()
  let progressInterval: NodeJS.Timeout | null = null
  let currentLeadsCount = 0
  let executionLogs = ""

  try {
    // ------ 1. Validation & Setup ------ //
    const validation = scraper.validateInput(event)
    if (!validation.valid) {
      executionLogs += `❌ Input validation failed: ${validation.error}\n`
      return { statusCode: 400, body: JSON.stringify({ error: `Input validation failed: ${validation.error}`, received: event }) }
    }

   
    
    const { keyword, location, channelId, id, limit, cities, retryCount = 0, isReverse, jobNumber = 1 } = event
    const { position, totalJobs } = await getJobChainPosition(id)
    
    executionLogs += `🚀 Job${jobNumber} started: "${keyword}" in "${location}" (${limit} leads, retry ${retryCount}/${MAX_RETRIES})\n`
    executionLogs += `📊 Chain position: ${position}/${totalJobs > 1 ? totalJobs : '?'}\n`

    // ------ 2. Free Tier Validation ------ //
    if (retryCount === 0 && jobNumber === 1) {
      const freeTierCheck = await validateFreeTierLimits(limit)
      if (!freeTierCheck.valid) {
        executionLogs += `❌ Free tier exceeded: ${freeTierCheck.error}\n`
        await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
        await pusher.trigger(channelId, "scraper:error", { id, message: freeTierCheck.error || "Free tier limit exceeded", })
        return { statusCode: 400, body: JSON.stringify({ error: freeTierCheck.error }) }
      }
    }

    // ------ 3. SDK Availability Check ------ //
    const { availableSDKNames, status: sdkStatus } = await checkSDKAvailability(supabase)
    if (availableSDKNames.length === 0) {
      executionLogs += `❌ All SDKs exhausted: ${sdkStatus}\n`
      await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
      await pusher.trigger(channelId, "scraper:error", { id, message: "All SDK limits reached. Please try again later.", })
      return { statusCode: 429, body: JSON.stringify({ error: "All SDK limits reached" }) }
    }

   
    // ------ 4. Load Existing Leads (for retries/chaining) ------ //
    let existingLeads: Lead[] = []
    if (retryCount > 0 || jobNumber > 1) {
      existingLeads = await loadExistingLeads(id)
      const remaining = limit - existingLeads.length
      currentLeadsCount = existingLeads.length
      
      if (remaining <= 0) {
        executionLogs += `✅ Target already reached: ${existingLeads.length}/${limit} leads\n`
        await scraper.updateDBScraper(id, { 
          status: "completed", 
          leads_count: existingLeads.length,
          message: `✅ Job${jobNumber} - Target reached: ${existingLeads.length} leads collected\n${executionLogs}` 
        })
        return { statusCode: 200, body: JSON.stringify({ message: "Target already reached", leads_count: existingLeads.length }) }
      }
      
      executionLogs += `🔄 Job${jobNumber} continuing: ${existingLeads.length} existing leads (scraping for ${remaining} more)\n`
    }

    // ------ 5. Generate Cities (if not provided) ------ //
    let citiesToScrape = cities || []
    if (!citiesToScrape.length) {
      executionLogs += `🤖 Generating cities for "${location}" (isReverse: ${isReverse})\n`
      await scraper.updateDBScraper(id, { message: `🤖 Job${jobNumber} - Generating cities using AI...\n${executionLogs}`,status:'pending' })
      await pusher.trigger(channelId, "scraper:update", { id, message: `🤖 Generating cities for processing...` })
      
      const openaiStart = Date.now()
      const generatedCities = await scraper.generateCitiesFromRegion(location, isReverse)
      const openaiTime = Math.round((Date.now() - openaiStart) / 1000)
      
      if (typeof generatedCities === 'string') {
        executionLogs += `❌ City generation failed (${openaiTime}s): ${generatedCities}\n`
        await scraper.updateDBScraper(id, { message: executionLogs,status:'error' })
        await pusher.trigger(channelId, "scraper:error", { id, message: `Failed to generate cities: ${generatedCities}`,job_number:jobNumber } ) 
        return { statusCode: 500, body: JSON.stringify({ error: generatedCities }) }
      }
      
      citiesToScrape = generatedCities
      executionLogs += `✅ Generated ${citiesToScrape.length} cities (${openaiTime}s): ${citiesToScrape.slice(0, 3).join(', ')}${citiesToScrape.length > 3 ? `... (+${citiesToScrape.length - 3} more)` : ''}\n`
      
      
    }

    // ------ 6. Start Progress Updates ------ //
    executionLogs += `📈 Starting progress updates every ${PROGRESS_UPDATE_INTERVAL/1000}s\n`
    progressInterval = startProgressUpdater(id, channelId, () => currentLeadsCount, () => executionLogs, start)

    // ------ 7. Scrape Leads ------ //
    executionLogs += `🔍 Job${jobNumber} - Starting lead scraping for ${citiesToScrape.length} cities...\n`
    const targetForThisJob = limit - existingLeads.length
    
    if (IS_DEBUGGING) executionLogs += `[debug] Target for this job: ${targetForThisJob}, Cities to process: ${citiesToScrape.slice(0, 5).join(', ')}\n`
    
    const scrapeStart = Date.now()
    const leads = await scraper.scrapeLeads(
      keyword,
      citiesToScrape,
      targetForThisJob,
      existingLeads,
      (count: number) => { currentLeadsCount = count },
      (logs: string) => { 
        const baseLog = executionLogs.split('🔍 Job')[0] + `🔍 Job${jobNumber} - Starting lead scraping for ${citiesToScrape.length} cities...\n`
        executionLogs = baseLog + logs
      },
      sdks
    )

    const scrapeTime = Math.round((Date.now() - scrapeStart) / 1000)
    const newLeadsFound = leads.length - existingLeads.length
    const processingTime = Math.round((Date.now() - start) / 1000)

    if (progressInterval) {
      clearInterval(progressInterval)
      progressInterval = null
    }

    executionLogs += `✅ Job${jobNumber} scraping completed in ${scrapeTime}s\n📊 Results: ${leads.length}/${limit} leads (+${newLeadsFound} new)\n`

    // ------ 8. Check if More Jobs Needed ------ //
    const remainingLeads = limit - leads.length
    const shouldContinueChain = remainingLeads > 0 && jobNumber < MAX_JOBS_ALLOWED && newLeadsFound > 0
    const foundRatio = leads.length / limit

    // ------ 9. Handle Retries (same job) ------ //
    const shouldRetry = foundRatio < 0.8 && retryCount < MAX_RETRIES && remainingLeads > 0 && newLeadsFound > 0
    if (shouldRetry) {
      executionLogs += `🔄 Insufficient leads (${Math.round(foundRatio * 100)}%) - retrying Job${jobNumber} (${retryCount + 1}/${MAX_RETRIES})\n`
      
      // Save current progress before retry
      const tempCsv = scraper.generateCSV(leads)
      const tempFileName = `temp_${id}_job${jobNumber}_retry_${retryCount}.csv`
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: tempFileName, Body: tempCsv, ContentType: "text/csv" }))
      const tempUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: tempFileName }), { expiresIn: 3600 })
      
      await scraper.updateDBScraper(id, { 
        status:'pending',
        downloadable_link: tempUrl, 
        leads_count: leads.length,
        message: `🔄 Job${jobNumber} retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found, searching for ${remainingLeads} more...
        ${executionLogs}`,
      })
      await pusher.trigger(channelId, "scraper:update", 
        { id, leads_count: leads.length, message: `🔄 Retrying: ${leads.length} leads found...` })
      
      return handler({ ...event, retryCount: retryCount + 1 })
    }

    // ------ 10. Generate & Upload CSV ------ //
    const csv = scraper.generateCSV(leads)
    const fileName = `${limit}_${keyword.replace(/\W+/g, '-')}_${location.replace(/\W+/g, '-')}-${getCurrentDate()}.csv`
    
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileName,
      Body: csv,
      ContentType: "text/csv",
      ContentDisposition: `attachment; filename="${fileName}"`
    }))

    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: fileName }), { expiresIn: 86400 })
    executionLogs += `💾 Uploaded CSV: ${fileName} (${leads.length} leads)\n`

    // ------ 11. Continue Chain or Complete ------ //
    if (shouldContinueChain) {
      const nextJobId = uuidv4()
      const nextJobPayload: JobPayload = {
        keyword,
        location,
        limit,
        channelId,
        id: nextJobId,
        cities: citiesToScrape,
        retryCount: 0,
        isReverse,
        jobNumber: jobNumber + 1,
        originalJobId: event.originalJobId || id
      }

      executionLogs += `🔗 Job${jobNumber} completed (${processingTime}s) - ${remainingLeads} leads remaining\n🚀 Chaining to Job${jobNumber + 1}...\n`
      
      // Insert next job record
      const { error: insertError } = await supabase.from("scraper").insert({
        id: nextJobId,
        keyword,
        location,
        limit: remainingLeads,
        channel_id: channelId,
        status: "pending",
        leads_count: 0,
        message: `🔗 Chained from Job${jobNumber} - Processing remaining ${remainingLeads} leads`,
        region: `Job${jobNumber + 1} (Auto-chain)`
      })

      if (insertError) {
        executionLogs += `❌ Failed to create next job: ${insertError.message}\n`
        throw new Error(`Failed to create next job: ${insertError.message}`)
      }

      // Update current job
      await scraper.updateDBScraper(id, {
        downloadable_link: downloadUrl,
        completed_in_s: processingTime,
        status: "completed",
        leads_count: leads.length,
        message: `✅ Job${jobNumber} done (${formatDuration(processingTime)}) - ${leads.length} leads collected 🔥\n
        🔗 Chaining to Job${jobNumber + 1} for remaining ${remainingLeads} leads 😎\n${executionLogs}`
      })

      await pusher.trigger(channelId, "scraper:update", {
        id,
        leads_count: leads.length,
        message: `✅ Job${jobNumber} complete! Continuing with Job${jobNumber + 1} for ${remainingLeads} more leads...`,
      })

      // Invoke next job
      const invokeResult = await scraper.invokeChildLambda(nextJobPayload)
      if (!invokeResult.success) {
        executionLogs += `❌ Failed to invoke Job${jobNumber + 1}: ${invokeResult.error}\n`
        await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
        await pusher.trigger(channelId, "scraper:error", { id, message: `Chain failed: ${invokeResult.error}`, })
      }

      return {
        statusCode: 202,
        body: JSON.stringify({
          message: `Job${jobNumber} completed, chained to Job${jobNumber + 1}`,
          id,
          next_job_id: nextJobId,
          downloadable_link: downloadUrl,
          completed_in_s: processingTime,
          leads_count: leads.length,
          remaining_leads: remainingLeads,
          chain_continues: true
        })
      }
    } else {
      // ------ 12. Final Job Completion ------ //
      const isUnrealisticRequest = limit > 10000 && foundRatio < 0.3
      const completionMessage = isUnrealisticRequest 
        ? `⚠️ Job${jobNumber} completed: ${leads.length} leads found (${location} may not have ${limit} "${keyword}" businesses)`
        : foundRatio < 0.8 
          ? `⚠️ Job${jobNumber} completed: ${leads.length}/${limit} leads found after ${retryCount} retries`
          : `✅ Job${jobNumber} completed: ${leads.length} leads found in ${formatDuration(processingTime)}`
      
      const finalMessage = `${completionMessage}\n${executionLogs}`
      const statusCode = foundRatio < 0.8 ? 206 : 200
      
      await scraper.updateDBScraper(id, {
        downloadable_link: downloadUrl,
        completed_in_s: processingTime,
        status: "completed",
        leads_count: leads.length,
        message: finalMessage
      })

      await pusher.trigger(channelId, "scraper:completed", {
        id,
        downloadable_link: downloadUrl,
        completed_in_s: processingTime,
        leads_count: leads.length,
        message: finalMessage,
      })

      const responseMessage = foundRatio < 0.8 
        ? (isUnrealisticRequest ? "⚠️ Location may not have enough businesses of this type" : "⚠️ Not enough leads found in this location")
        : "✅ Scraping completed successfully"

      return {
        statusCode,
        body: JSON.stringify({
          message: responseMessage,
          id,
          downloadable_link: downloadUrl,
          completed_in_s: processingTime,
          leads_count: leads.length,
          requested_limit: limit,
          success_rate: Math.round(foundRatio * 100),
          retry_count: retryCount,
          job_number: jobNumber,
          chain_completed: true
        })
      }
    }

  } catch (error: unknown) {
    const processingTime = Math.round((Date.now() - start) / 1000)
    executionLogs += `❌ Job${event.jobNumber || 1} failed: ${(error as Error).message} (${processingTime}s)\n`

    if (progressInterval) clearInterval(progressInterval)

    try {
      await scraper.updateDBScraper(event.id, { 
        completed_in_s: processingTime, 
        status: "error", 
        message: executionLogs 
      })
      await pusher.trigger(event.channelId, "scraper:error", { 
        id: event.id, 
        message: `Job${event.jobNumber || 1} failed: ${(error as Error).message}`,
      })
    } catch (notifyError: unknown) {
      console.error("❌ Failed to handle error state:", notifyError)
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: executionLogs.trim(),
        id: event.id,
        processing_time: processingTime,
        job_number: event.jobNumber || 1
      })
    }
  } finally {
    const totalTime = Math.round((Date.now() - start) / 1000)
    if (IS_DEBUGGING) console.log(`=== ✅ Job${event.jobNumber || 1} END (${totalTime}s) ===`)
  }
}