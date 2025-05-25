import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { PutObjectCommand, GetObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createClient } from "@supabase/supabase-js"
import Pusher from "pusher"
import OpenAI from "openai"
import fetch from "node-fetch"
import { v4 as uuidv4 } from "uuid"
import { Job, JobPayload, Lead } from "./interfaces/interfaces"
import { Scraper } from "./SDK/scraper"
import { initializeClients } from "./utils/initializeSDK"

// Constants
export const BUCKET = process.env.S3_BUCKET || "scraper-files-eu-central-1"
const MAX_RUNTIME_MS = 13 * 60 * 1000
const LEADS_PER_MINUTE = 80 / 3
const MAX_LEADS_PER_JOB = Math.floor((MAX_RUNTIME_MS / 60000) * LEADS_PER_MINUTE)
const PROGRESS_UPDATE_INTERVAL = 30000
const MAX_RETRIES = 3

interface SDKs {
  duckduckGoSDK: string
  foursquareSDK: string
  googleCustomSearchSDK: string
  hunterSDK: string
  openCorporatesSDK: string
  puppeteerGoogleMapsSDK: string
  searchSDK: string
  serpSDK: string
  tomtomSDK: string
  [index: string]: string
}

const SDK_EMOJIS: SDKs = {
  duckduckGoSDK: '🦆',
  foursquareSDK: '📍',
  googleCustomSearchSDK: '🌐',
  hunterSDK: '🕵️',
  openCorporatesSDK: '🏢',
  puppeteerGoogleMapsSDK: '🧠',
  searchSDK: '🔎',
  serpSDK: '📊',
  tomtomSDK: '🗺️'
}

const extractEmailSafely = async (url: string): Promise<string> => {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Email extraction timeout')), 4000))
    const res = await Promise.race([fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" }, timeout: 3500 }), timeoutPromise])
    if (!res.ok) return ""
    const html = await res.text()
    const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}/g)
    return emails?.find(e => !/(example|test|placeholder|noreply|no-reply|admin|info@example)/.test(e.toLowerCase()) && e.length < 50) || ""
  } catch {
    return ""
  }
}

const startProgressUpdater = (id: string, channelId: string, getCurrentCount: () => number, getCurrentLogs: () => string, startTime: number) => {
  const updateProgress = async () => {
    try {
      const currentCount = getCurrentCount()
      const currentLogs = getCurrentLogs()
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000)
      const formattedTime = formatDuration(elapsedSeconds)
      const message = `⏱️ Progress: ${currentCount} leads found in ${formattedTime}\n${currentLogs}`
      await scraper.updateDBScraper(id, { leads_count: currentCount, message })
      await pusher.trigger(channelId, "scraper:update", { id, leads_count: currentCount, message })
    } catch (error) {
      console.error(`🔄 Progress update error for ${id}:`, error)
    }
  }
  return setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL)
}

const formatDuration = (seconds: number): string => {
  if (seconds < 0) return "0s"
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return hours > 0 ? `${hours}h ${minutes.toString().padStart(2, "0")}m ${remainingSeconds.toString().padStart(2, "0")}s` : `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`
}

const checkSDKAvailability = async (supabase: any): Promise<{ available: string[], unavailable: string[], status: string }> => {
  const { data: usageData, error } = await supabase.from('sdk_freetier').select('sdk_name, limit_value, used_count, period_start, period_duration, limit_type')
  if (error) return { available: [], unavailable: [], status: `❌ Database error: ${error.message}` }

  const available: string[] = []
  const unavailable: string[] = []
  const now = new Date()

  usageData?.forEach((sdk: any) => {
    const { sdk_name, limit_value, used_count, period_start, period_duration, limit_type } = sdk
    let currentUsage = used_count
    
    if (period_duration && period_start) {
      const periodStartDate = new Date(period_start)
      const periodEndDate = new Date(periodStartDate.getTime())
      if (limit_type === 'daily') periodEndDate.setDate(periodEndDate.getDate() + 1)
      else if (limit_type === 'monthly') periodEndDate.setMonth(periodEndDate.getMonth() + 1)
      if (now >= periodEndDate) currentUsage = 0
    }
    
    const isAvailable = currentUsage < limit_value
    const statusText = isAvailable ? sdk_name : `${sdk_name} (${currentUsage}/${limit_value})`
    ;(isAvailable ? available : unavailable).push(statusText)
  })

  const status = available.length === 0 
    ? `❌ All SDKs exhausted: ${unavailable.join(', ')}`
    : `✅ Available: ${available.join(', ')}${unavailable.length ? ` | ❌ Unavailable: ${unavailable.join(', ')}` : ''}`

  return { available, unavailable, status }
}

const getCurrentDate = (): string => {
  const now = new Date()
  return `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}`
}

// 🔥 FIXED: Proper retry logic that adds to existing leads instead of restarting
const scrapePlaces = async (
  keyword: string,
  location: string,
  targetLimit: number,
  existingLeads: Lead[] = [], // 🆕 Accept existing leads
  progressCallback: (count: number) => void,
  logsCallback: (logs: string) => void,
  sdks: Record<string, any>,
  supabase: any
): Promise<Lead[]> => {
  let logs = ""
  let allLeads: Lead[] = [...existingLeads] // 🔥 Start with existing leads
  const seenCompanies = new Set<string>()
  
  // 🔥 Pre-populate seen companies to avoid duplicates
  existingLeads.forEach(lead => {
    const key = `${lead.company}-${lead.address}`.toLowerCase().trim()
    seenCompanies.add(key)
  })

  let attempts = 0
  const maxAttempts = 8
  const sdkOrder = ['duckduckGoSDK', 'foursquareSDK', 'googleCustomSearchSDK', 'hunterSDK', 'openCorporatesSDK', 'puppeteerGoogleMapsSDK', 'searchSDK', 'serpSDK', 'tomtomSDK']

  try {
    while (allLeads.length < targetLimit && attempts < maxAttempts) {
      attempts++
      const { available, status } = await checkSDKAvailability(supabase)
      logs += `🔍 Attempt ${attempts}: SDK Status: ${status}\n`

      const availableSDKs = sdkOrder.filter(sdk => available.includes(sdk))
      if (availableSDKs.length === 0) {
        logs += `❌ No available SDKs for attempt ${attempts}\n`
        logsCallback(logs)
        break
      }

      const remaining = targetLimit - allLeads.length
      logs += `🎯 Need ${remaining} more leads (${allLeads.length}/${targetLimit})\n`
      logs += `🚀 Attempt ${attempts} with ${availableSDKs.length} SDKs: ${availableSDKs.map(s => SDK_EMOJIS[s] + s).join(', ')}\n`
      logsCallback(logs)

      let newLeadsThisAttempt = 0
      for (const sdkName of availableSDKs) {
        if (allLeads.length >= targetLimit) break
        const sdkLimit = Math.min(targetLimit - allLeads.length, Math.max(5, Math.ceil(remaining / availableSDKs.length)))

        try {
          const sdkStart = Date.now()
          logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: Starting scrape for ${sdkLimit} leads...\n`
          logsCallback(logs)

          const sdk = sdks[sdkName]
          if (!sdk || typeof sdk.searchBusinesses !== 'function') {
            logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ SDK not available or missing searchBusinesses method\n`
            continue
          }

          const leads = await sdk.searchBusinesses(keyword, location, sdkLimit)
          if (typeof leads === 'string') {
            logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ SDK returned error: ${leads}\n`
            continue
          }

          const newLeads = leads.filter((lead: Lead) => {
            const key = `${lead.company}-${lead.address}`.toLowerCase().trim()
            if (seenCompanies.has(key)) return false
            seenCompanies.add(key)
            return true
          })

          let emailsExtracted = 0
          for (const lead of newLeads) {
            if (!lead.email && lead.website) {
              const email = await extractEmailSafely(lead.website)
              if (email) {
                lead.email = email
                emailsExtracted++
              }
            }
          }

          allLeads.push(...newLeads)
          newLeadsThisAttempt += newLeads.length
          progressCallback(allLeads.length)

          const sdkTime = Math.round((Date.now() - sdkStart) / 1000)
          logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ${newLeads.length} leads in ${sdkTime}s${emailsExtracted ? ` (📧 ${emailsExtracted} emails)` : ''}\n`
          logsCallback(logs)

          await scraper.updateDBSDKFreeTier({ sdkName, usedCount: leads.length, increment: true })
        } catch (error) {
          logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ Failed - ${(error as Error).message}\n`
          logsCallback(logs)
          continue
        }
      }

      if (newLeadsThisAttempt === 0) {
        logs += `⚠️ No new leads found in attempt ${attempts}, stopping\n`
        break
      }

      if (allLeads.length < targetLimit && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    logs += `🎯 Final results: ${allLeads.length}/${targetLimit} leads after ${attempts} attempts\n`
    logsCallback(logs)
    return allLeads
  } catch (error) {
    logs += `❌ Critical scraping error: ${(error as Error).message}\n`
    logsCallback(logs)
    throw error
  }
}

const init = initializeClients()
if (typeof init === 'string') throw Error(init)
const { lambda, s3, supabase, pusher, openai, duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, puppeteerGoogleMapsSDK, searchSDK, serpSDK } = init

const scraper = new Scraper(openai, s3, pusher, supabase, lambda)
const sdks = { duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, puppeteerGoogleMapsSDK, searchSDK, serpSDK }

// 🔥 NEW: Helper to load existing CSV from S3 and parse leads
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
    console.error('🔥 Failed to load existing leads:', error)
    return []
  }
}

export const handler = async (event: JobPayload): Promise<{ statusCode: number; body: string }> => {
  const start = Date.now()
  let progressInterval: NodeJS.Timeout | null = null
  let currentLeadsCount = 0
  let executionLogs = ""

  try {
    const validation = scraper.validateInput(event)
    if (!validation.valid) {
      executionLogs += `❌ Input validation failed: ${validation.error}\n`
      console.error("❌ Input validation failed:", validation.error)
      return { statusCode: 400, body: JSON.stringify({ error: `Input validation failed: ${validation.error}`, received: event }) }
    }

    executionLogs += `🚀 Lambda execution started\n📋 Payload: ${JSON.stringify(event, null, 2)}\n`
    console.log("=== 🚀 LAMBDA EXECUTION START ===")

    const { keyword, location, channelId, id, limit, parentId, region: jobRegion, retryCount = 0 } = event
    const isChildJob = Boolean(parentId && jobRegion)
    const processingType = isChildJob ? 'Child' : 'Parent'

    executionLogs += `🎯 ${processingType} job: "${keyword}" in "${location}" (${limit} leads, retry ${retryCount}/${MAX_RETRIES})\n`
    console.log(`🎯 ${processingType} job started: "${keyword}" in "${location}" (${limit} leads)`)

    if (limit > 100000 && retryCount === 0) {
      executionLogs += `⚠️ Unrealistic limit detected: ${limit} leads requested\n🔄 Adjusting expectations for location capacity...\n`
      console.log(`⚠️ Unrealistic limit detected: ${limit} leads`)
      await scraper.updateDBScraper(id, { message: `⚠️ Very large request (${limit} leads) - this may take time or return fewer results than expected\n${executionLogs}` })
      await pusher.trigger(channelId, "scraper:update", { id, message: `⚠️ Processing large request (${limit} leads) - please be patient...` })
    }

    const { available, status: sdkStatus } = await checkSDKAvailability(supabase)
    if (available.length === 0) {
      executionLogs += `❌ All SDKs exhausted: ${sdkStatus}\n`
      await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
      await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs })
      return { statusCode: 429, body: JSON.stringify({ error: executionLogs.trim() }) }
    }

    if (!isChildJob && limit > MAX_LEADS_PER_JOB) {
      executionLogs += `📊 Large request detected (${limit} > ${MAX_LEADS_PER_JOB})\n🔄 Initiating regional split...\n`
      console.log(`📊 Large request detected, splitting into regions...`)

      try {
        const regions = await scraper.generateRegionalChunks(location)
        const leadsPerRegion = Math.ceil(limit / 4)
        executionLogs += `📍 Generated regions: ${regions.map(r => `${r.region} (${r.location})`).join(', ')}\n`
        executionLogs += `📊 Leads per region: ${leadsPerRegion}\n`

        const childJobs = regions.map((r) => ({
          id: uuidv4(),
          keyword,
          location: r.location,
          limit: leadsPerRegion,
          channel_id: channelId,
          parent_id: id,
          region: r.region,
          status: "pending",
          created_at: new Date().toISOString(),
          leads_count: 0,
          message: "🚀 Initialized: Waiting to start"
        }))

        const { error: insertError } = await supabase.from("scraper").insert(childJobs)
        if (insertError) {
          executionLogs += `❌ Database insert failed: ${insertError.message}\n`
          throw new Error(`Database insert failed: ${insertError.message}`)
        }

        const invocationResults = await Promise.allSettled(
          childJobs.map((job) => {
            console.log(`🚀 Triggering child Lambda for region: ${job.region}`, { keyword, location: job.location, limit: leadsPerRegion })
            return scraper.invokeChildLambda({ keyword, location: job.location, limit: leadsPerRegion, channelId, id: job.id, parentId: id, region: job.region })
          })
        )

        const successful = invocationResults.filter((r) => r.status === 'fulfilled' && r.value.success).length
        if (successful === 0) {
          executionLogs += `❌ All child Lambda invocations failed\n`
          throw new Error("All child Lambda invocations failed")
        }

        executionLogs += `✅ Successfully triggered ${successful}/${childJobs.length} child Lambdas\n`
        console.log(`✅ Successfully triggered ${successful}/${childJobs.length} child Lambdas`)
        console.log(`📍 Regions triggered: ${regions.map(r => r.region).join(', ')}`)

        await scraper.updateDBScraper(id, {
          status: "pending",
          message: `🔄 Split into ${successful} regional jobs: ${regions.map(r => r.region).join(", ")}\n${executionLogs}`
        })

        return {
          statusCode: 202,
          body: JSON.stringify({
            message: `Split into ${successful} regional jobs`,
            id,
            regions: regions.map(r => r.region),
            status: "pending",
            leads_per_region: leadsPerRegion,
            total_expected: successful * leadsPerRegion
          })
        }
      } catch (error) {
        executionLogs += `❌ Regional splitting failed: ${(error as Error).message}\n`
        await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
        await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs })
        throw error
      }
    }

    // 🔥 FIXED: Load existing leads on retry
    let existingLeads: Lead[] = []
    if (retryCount > 0) {
      existingLeads = await loadExistingLeads(id)
      executionLogs += `🔄 Retry ${retryCount}: Loading ${existingLeads.length} existing leads\n`
      console.log(`🔄 Retry ${retryCount}: Found ${existingLeads.length} existing leads`)
      currentLeadsCount = existingLeads.length
    }

    executionLogs += `📈 Starting progress updates every ${PROGRESS_UPDATE_INTERVAL/1000}s\n`
    progressInterval = startProgressUpdater(id, channelId, () => currentLeadsCount, () => executionLogs, start)

    executionLogs += `🔍 Starting lead scraping process...\n`
    console.log(`🔍 Starting lead scraping process...`)
    const scrapeStart = Date.now()

    try {
      const leads = await scrapePlaces(
        keyword,
        location,
        limit,
        existingLeads, // 🔥 Pass existing leads
        (count: number) => { currentLeadsCount = count },
        (logs: string) => { executionLogs = logs },
        sdks,
        supabase
      )

      const scrapeTime = Math.round((Date.now() - scrapeStart) / 1000)
      const newLeadsFound = leads.length - existingLeads.length
      executionLogs += `✅ Scraping completed in ${scrapeTime}s\n📊 Results: ${leads.length}/${limit} leads (+${newLeadsFound} new, ${Math.round(leads.length/limit*100)}%)\n`
      console.log(`✅ Scraping completed: ${leads.length}/${limit} leads in ${scrapeTime}s`)

      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      const processingTime = Math.round((Date.now() - start) / 1000)
      const foundRatio = leads.length / limit

      // 🔥 FIXED: Retry logic that considers existing leads
      const shouldRetry = foundRatio < 0.8 && retryCount < MAX_RETRIES && limit <= 10000 && newLeadsFound > 0
      if (shouldRetry) {
        executionLogs += `🔄 Insufficient leads found (${Math.round(foundRatio * 100)}%)\n🔄 Retry ${retryCount + 1}/${MAX_RETRIES} starting...\n`
        console.log(`🔄 Insufficient leads, retrying ${retryCount + 1}/${MAX_RETRIES}...`)
        
        // Save current progress before retry
        const header = "Name,Address,Phone,Email,Website"
        const csvRows = leads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website].map(cell => `"${(cell || '').replace(/"/g, '""')}"`) .join(","))
        const csv = [header, ...csvRows].join("\n")
        const tempFileName = `temp_${id}_retry_${retryCount}.csv`
        
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: tempFileName,
          Body: csv,
          ContentType: "text/csv"
        }))
        
        const tempDownloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: tempFileName }), { expiresIn: 3600 })
        await scraper.updateDBScraper(id, { downloadable_link: tempDownloadUrl, leads_count: leads.length })
        
        const retryMessage = `🔄 Retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found, searching for more...\n${executionLogs}`
        await scraper.updateDBScraper(id, { message: retryMessage })
        await pusher.trigger(channelId, "scraper:update", { id, message: retryMessage })
        
        return handler({ ...event, retryCount: retryCount + 1 })
      }

      executionLogs += `📄 Generating CSV file...\n`
      console.log(`📄 Generating CSV file...`)
      
      const header = "Name,Address,Phone,Email,Website"
      const csvRows = leads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website].map(cell => `"${(cell || '').replace(/"/g, '""')}"`) .join(","))
      const csv = [header, ...csvRows].join("\n")
      const fileName = `${limit}_${keyword.replace(/\W+/g, '-')}_${location.replace(/\W+/g, '-')}-${getCurrentDate()}${jobRegion ? `_${jobRegion}` : ''}.csv`

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: fileName,
        Body: csv,
        ContentType: "text/csv",
        ContentDisposition: `attachment; filename="${fileName}"`
      }))

      const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: fileName }), { expiresIn: 86400 })
      executionLogs += `💾 Uploaded to S3: ${fileName} (${csvRows.length + 1} rows)\n`

      const isUnrealisticRequest = limit > 10000 && foundRatio < 0.3
      const completionMessage = isUnrealisticRequest 
        ? `⚠️ Large request completed: ${leads.length} leads found (${location} may not have ${limit} "${keyword}" businesses)`
        : `✅ Completed: ${leads.length} leads found in ${formatDuration(processingTime)}`
      
      const finalMessage = `${completionMessage}\n${executionLogs}`
      await scraper.updateDBScraper(id, {
        downloadable_link: downloadUrl,
        completed_in_s: processingTime,
        status: "completed",
        leads_count: leads.length,
        message: finalMessage
      })

      console.log(`✅ Job completed: ${leads.length}/${limit} leads in ${processingTime}s`)

      if (isChildJob && parentId) {
        console.log(`🔗 Child job completed, updating parent progress...`)
        const { data: childJobs, error: fetchError } = await supabase.from("scraper").select("id, status, leads_count, message").eq("parent_id", parentId)

        if (!fetchError && childJobs) {
          const completedCount = childJobs.filter(job => job.status === "completed").length
          const totalLeads = childJobs.reduce((sum: number, job: any) => sum + job.leads_count, 0)
          const totalRegions = childJobs.length
          
          const sdkPerformance = childJobs.filter(job => job.status === "completed").map(job => job.message?.split('\n').filter((line: string) => line.includes('leads in') && line.includes('s')).join('\n')).filter(Boolean).join('\n')
          const parentMessage = `🎯 ${completedCount}/${totalRegions} regions completed, ${totalLeads} leads collected\n\n📊 SDK Performance:\n${sdkPerformance}`

          await scraper.updateDBScraper(parentId, { leads_count: totalLeads, message: parentMessage })
          await pusher.trigger(channelId, "scraper:update", { id: parentId, leads_count: totalLeads, message: parentMessage })

          if (completedCount === totalRegions) {
            console.log(`🔗 All child jobs completed, scheduling merge...`)
            setTimeout(() => scraper.checkAndMergeResults(parentId, channelId, BUCKET), 5000)
          }
        }

        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Regional processing complete (${jobRegion})`,
            id,
            region: jobRegion,
            downloadable_link: downloadUrl,
            completed_in_s: processingTime,
            leads_count: leads.length,
            parent_id: parentId
          })
        }
      } else {
        const statusCode = foundRatio < 0.8 ? 206 : 200
        const responseMessage = foundRatio < 0.8 
          ? (isUnrealisticRequest ? "⚠️ Location may not have enough businesses of this type" : "⚠️ Not enough leads found after ${MAX_RETRIES} attempts")
          : "✅ Scraping completed successfully"

        await pusher.trigger(channelId, "scraper:completed", {
          id,
          downloadable_link: downloadUrl,
          completed_in_s: processingTime,
          leads_count: leads.length,
          message: finalMessage,
          status: 'completed'
        })

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
            retry_count: retryCount
          })
        }
      }
    } catch (scrapeError: unknown) {
      const processingTime = Math.round((Date.now() - start) / 1000)
      executionLogs += `❌ Scraping failed: ${(scrapeError as Error).message} (${processingTime}s, retry ${retryCount})\n`
      
      if (progressInterval) clearInterval(progressInterval)
      await scraper.updateDBScraper(id, { status: "error", completed_in_s: processingTime, message: executionLogs })
      await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs })

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: executionLogs.trim(),
          id,
          processing_time: processingTime
        })
      }
    }
  } catch (error: unknown) {
    const processingTime = Math.round((Date.now() - start) / 1000)
    executionLogs += `❌ Critical error: ${(error as Error).message} (${processingTime}s, retry ${event.retryCount || 0})\n`

    console.error("❌ LAMBDA EXECUTION FAILED:", executionLogs)

    if (progressInterval) clearInterval(progressInterval)

    try {
      await scraper.updateDBScraper(event.id, { completed_in_s: processingTime, status: "error", message: executionLogs })
      await pusher.trigger(event.channelId, "scraper:error", { id: event.id, error: executionLogs })
    } catch (notifyError: unknown) {
      console.error("❌ Failed to handle error state:", notifyError)
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: executionLogs.trim(),
        id: event.id,
        processing_time: processingTime
      })
    }
  } finally {
    const totalTime = Math.round((Date.now() - start) / 1000)
    console.log(`=== ✅ LAMBDA EXECUTION END (${totalTime}s) ===`)
  }
}