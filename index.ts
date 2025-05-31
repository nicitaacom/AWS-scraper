import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import { PutObjectCommand, GetObjectCommand, S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { createClient } from "@supabase/supabase-js"
import Pusher from "pusher"
import OpenAI from "openai"
import fetch from "node-fetch"
import { v4 as uuidv4 } from "uuid"
import { JobPayload, Lead } from "./interfaces/interfaces"
import { Scraper } from "./SDK/scraper"
import { initializeClients } from "./utils/initializeSDK"
import { formatDuration, getCurrentDate } from "./utils/date-utils"
import { checkSDKAvailability } from "./utils/checkSDKAvailability"

// Constants
export const BUCKET = process.env.S3_BUCKET || "scraper-files-eu-central-1"
const MAX_RUNTIME_MS = 13 * 60 * 1000
const LEADS_PER_MINUTE = 80 / 3
const MAX_LEADS_PER_JOB = Math.floor((MAX_RUNTIME_MS / 60000) * LEADS_PER_MINUTE)
const PROGRESS_UPDATE_INTERVAL = 10000 // 10 seconds
export const MAX_RETRIES = 3
const PARALLEL_LAMBDAS = 4

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

const init = initializeClients()
if (typeof init === "string") throw Error(init)

const { lambda, s3, supabase, pusher, openai, ...allSDKs } = init
const scraper = new Scraper(openai, s3, pusher, supabase, lambda)
const sdks = allSDKs

// Helper to load existing CSV from S3 and parse leads
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

// Helper to chunk cities array into equal parts
const chunkCities = (cities: string[], chunks: number): string[][] => {
  const chunkSize = Math.ceil(cities.length / chunks)
  return Array.from({ length: chunks }, (_, i) => cities.slice(i * chunkSize, i * chunkSize + chunkSize)).filter(chunk => chunk.length > 0)
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

    const { keyword, location, channelId, id, limit, parentId, cities, retryCount = 0, isReverse } = event
    const isChildJob = Boolean(parentId && cities?.length)
    const processingType = isChildJob ? 'Child' : 'Parent'

    executionLogs += `🎯 ${processingType} job: "${keyword}" in "${location}" (${limit} leads, retry ${retryCount}/${MAX_RETRIES})\n`
    console.log(`🎯 ${processingType} job started: "${keyword}" in "${location}" (${limit} leads)`)

    // Handle unrealistic limit detection
    if (limit > 100000 && retryCount === 0) {
      executionLogs += `⚠️ Unrealistic limit detected: ${limit} leads requested\n🔄 Adjusting expectations for location capacity...\n`
      console.log(`⚠️ Unrealistic limit detected: ${limit} leads`)
      await scraper.updateDBScraper(id, { message: `⚠️ Very large request (${limit} leads) - this may take time or return fewer results than expected\n${executionLogs}` })
      await pusher.trigger(channelId, "scraper:update", { id, message: `⚠️ Processing large request (${limit} leads) - please be patient...` })
    }

    // Check SDK availability
    const { available: availableSDKs, status: sdkStatus, sdkLimits, unavailable } = await checkSDKAvailability(supabase)
    if (availableSDKs.length === 0) {
      executionLogs += `❌ All SDKs exhausted: ${sdkStatus}\n`
      await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
      await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs })
      return { statusCode: 429, body: JSON.stringify({ error: executionLogs.trim() }) }
    }

    // Handle large requests by splitting into parallel Lambda jobs
    if (!isChildJob && limit > MAX_LEADS_PER_JOB) {
      executionLogs += `📊 Large request detected (${limit} > ${MAX_LEADS_PER_JOB})\n🔄 Initiating city-based parallel processing...\n`
      console.log(`📊 Large request detected, splitting into ${PARALLEL_LAMBDAS} parallel jobs...`)
    
      try {
        // Store initial start time in database for duration tracking
        await scraper.updateDBScraper(id, { 
          status: "pending",
          message: `🚀 Starting parallel processing at ${new Date().toISOString()}\n${executionLogs}` 
        })
    
        // Generate cities using scraper method with detailed logging
        executionLogs += `🤖 Calling OpenAI to generate cities for location: "${location}" (isReverse: ${isReverse})\n`
        console.log(`🤖 Calling OpenAI to generate cities for location: "${location}" (isReverse: ${isReverse})`)
        
        // Update status to show OpenAI is being called
        await scraper.updateDBScraper(id, { 
          message: `🤖 Generating cities using AI for "${location}"...\n${executionLogs}` 
        })
        await pusher.trigger(channelId, "scraper:update", { 
          id, 
          message: `🤖 Generating cities using AI for "${location}"...` 
        })
        
        const openaiStart = Date.now()
        const allCities = await scraper.generateRegionalChunks(location, isReverse)
        const openaiTime = Math.round((Date.now() - openaiStart) / 1000)
        
        // Log OpenAI response details
        if (typeof allCities === 'string') {
          executionLogs += `❌ OpenAI error (${openaiTime}s): ${allCities}\n`
          console.error(`❌ OpenAI error (${openaiTime}s): ${allCities}`)
          
          // Update database with error
          await scraper.updateDBScraper(id, { 
            status: "error", 
            message: `❌ Failed to generate cities: ${allCities}\n${executionLogs}` 
          })
          await pusher.trigger(channelId, "scraper:error", { 
            id, 
            error: `❌ Failed to generate cities: ${allCities}` 
          })
          
          throw new Error(allCities)
        }
        
        // Validate cities array
        if (!Array.isArray(allCities) || allCities.length === 0) {
          const errorMsg = `Invalid cities response: ${Array.isArray(allCities) ? 'empty array' : typeof allCities}`
          executionLogs += `❌ ${errorMsg}\n`
          console.error(`❌ ${errorMsg}`, allCities)
          throw new Error(errorMsg)
        }
        
        executionLogs += `✅ OpenAI success (${openaiTime}s): Generated ${allCities.length} cities\n`
        executionLogs += `🏙️ Sample cities: ${allCities.slice(0, 5).join(', ')}${allCities.length > 5 ? ` (+${allCities.length - 5} more)` : ''}\n`
        
        console.log(`✅ OpenAI generated ${allCities.length} cities in ${openaiTime}s:`, 
          allCities.slice(0, 5), 
          allCities.length > 5 ? `... (+${allCities.length - 5} more)` : ''
        )
        
        // Update progress
        await scraper.updateDBScraper(id, { 
          message: `✅ Generated ${allCities.length} cities, creating ${PARALLEL_LAMBDAS} parallel jobs...\n${executionLogs}` 
        })
        await pusher.trigger(channelId, "scraper:update", { 
          id, 
          message: `✅ Generated ${allCities.length} cities, creating parallel jobs...` 
        })
        
        // Split cities into chunks for parallel processing
        const cityChunks = chunkCities(allCities, PARALLEL_LAMBDAS)
        const leadsPerJob = Math.ceil(limit / PARALLEL_LAMBDAS)
        
        executionLogs += `📊 Split ${allCities.length} cities into ${cityChunks.length} chunks (${leadsPerJob} leads per job)\n`
        console.log(`📊 City chunks created:`, 
          cityChunks.map((chunk, i) => 
            `Chunk ${i + 1}: ${chunk.slice(0, 3).join(', ')}${chunk.length > 3 ? `... (+${chunk.length - 3})` : ''}`
          )
        )
    
        // Rest of the parallel job creation logic...
        const childJobs = cityChunks.map((cityChunk, index) => ({
          id: uuidv4(),
          keyword,
          location: cityChunk.join(', '),
          limit: leadsPerJob,
          channel_id: channelId,
          parent_id: id,
          region: `Chunk ${index + 1}/${cityChunks.length}`,
          status: "pending",
          created_at: new Date().toISOString(),
          leads_count: 0,
          message: `🚀 Initialized: Processing ${cityChunk.length} cities`
        }))
    
        const { error: insertError } = await supabase.from("scraper").insert(childJobs)
        if (insertError) {
          executionLogs += `❌ Database insert failed: ${insertError.message}\n`
          throw new Error(`Database insert failed: ${insertError.message}`)
        }
    
        const invocationResults = await Promise.allSettled(
          childJobs.map((job, index) => {
            const jobCities = cityChunks[index]
            const jobPayload = { 
              keyword, 
              location: job.location, 
              limit: leadsPerJob, 
              channelId, 
              id: job.id, 
              parentId: id, 
              cities: jobCities, 
              isReverse 
            }
            
            console.log(`🚀 Triggering child Lambda ${index + 1}/${cityChunks.length}:`, { 
              jobId: job.id, 
              cities: jobCities.slice(0, 3).join(', ') + (jobCities.length > 3 ? `... (+${jobCities.length - 3})` : ''),
              leadsTarget: leadsPerJob 
            })
            
            executionLogs += `🚀 Child Job ${index + 1}: ${JSON.stringify({ 
              id: job.id, 
              cities: jobCities.slice(0, 3), 
              totalCities: jobCities.length, 
              leadsTarget: leadsPerJob 
            }, null, 2)}\n`
            
            return scraper.invokeChildLambda(jobPayload)
          })
        )
    
        const successful = invocationResults.filter((r) => r.status === 'fulfilled' && r.value.success).length
        if (successful === 0) {
          executionLogs += `❌ All child Lambda invocations failed\n`
          throw new Error("All child Lambda invocations failed")
        }
    
        executionLogs += `✅ Successfully triggered ${successful}/${childJobs.length} parallel Lambda jobs\n`
        console.log(`✅ Successfully triggered ${successful}/${childJobs.length} parallel Lambda jobs`)
    
        await scraper.updateDBScraper(id, {
          status: "pending",
          message: `🔄 Split into ${successful} parallel jobs processing ${allCities.length} cities\n${executionLogs}`
        })
    
        return {
          statusCode: 202,
          body: JSON.stringify({
            message: `Split into ${successful} parallel jobs`,
            id,
            cities: allCities,
            city_chunks: cityChunks.length,
            status: "pending",
            leads_per_job: leadsPerJob,
            total_expected: successful * leadsPerJob,
            openai_cities_generated: allCities.length,
            openai_processing_time: openaiTime
          })
        }
      } catch (error) {
        executionLogs += `❌ Parallel job splitting failed: ${(error as Error).message}\n`
        console.error(`❌ Full error details:`, error)
        
        await scraper.updateDBScraper(id, { status: "error", message: executionLogs })
        await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs })
        throw error
      }
    }
    

    // Load existing leads on retry
    let existingLeads: Lead[] = []
    if (retryCount > 0) {
      existingLeads = await loadExistingLeads(id)
      const remaining = limit - existingLeads.length
      executionLogs += `🔄 Retry ${retryCount}: Found ${existingLeads.length} existing leads (scraping for ${remaining} more)\n`
      console.log(`🔄 Retry ${retryCount}: Found ${existingLeads.length} existing leads (scraping for ${remaining} more)`)
      currentLeadsCount = existingLeads.length
    }

    executionLogs += `📈 Starting progress updates every ${PROGRESS_UPDATE_INTERVAL/1000}s\n`
    progressInterval = startProgressUpdater(id, channelId, () => currentLeadsCount, () => executionLogs, start)

    executionLogs += `🔍 Starting city-based lead scraping process...\n`
    console.log(`🔍 Starting city-based lead scraping process...`)
    console.log(`🏙️ Processing cities: ${cities?.slice(0, 5).join(', ')}${cities?.length > 5 ? `... (${cities.length} total)` : ''}`)
    const scrapeStart = Date.now()

    try {
      // Use cities from payload for child jobs, or generate for direct processing
      const citiesToScrape = cities?.length ? cities : [location]
      
      // Scrape leads and accumulate all logs
      const leads = await scraper.scrapeLeads(
        keyword,
        citiesToScrape,
        limit,
        existingLeads,
        (count: number) => { currentLeadsCount = count },
        (logs: string) => { 
          // Accumulate scraping logs with execution logs
          executionLogs = executionLogs.split('🔍 Starting city-based lead scraping process...')[0] + 
                         '🔍 Starting city-based lead scraping process...\n' + logs
        },
        sdks,
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

      // Retry logic for insufficient leads
      const shouldRetry = foundRatio < 0.8 && retryCount < MAX_RETRIES && limit <= 10000 && newLeadsFound > 0
      if (shouldRetry) {
        const remaining = limit - leads.length
        executionLogs += `🔄 Insufficient leads found (${Math.round(foundRatio * 100)}%)\n🔄 Retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found - searching for ${remaining} more\n`
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
        
        const retryMessage = `🔄 Retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found, searching for ${remaining} more...\n${executionLogs}`
        await scraper.updateDBScraper(id, { message: retryMessage })
        await pusher.trigger(channelId, "scraper:update", { id, message: retryMessage })
        
        return handler({ ...event, retryCount: retryCount + 1 })
      }

      executionLogs += `📄 Generating CSV file...\n`
      console.log(`📄 Generating CSV file...`)
      
      const header = "Name,Address,Phone,Email,Website"
      const csvRows = leads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website].map(cell => `"${(cell || '').replace(/"/g, '""')}"`) .join(","))
      const csv = [header, ...csvRows].join("\n")
      const fileName = `${limit}_${keyword.replace(/\W+/g, '-')}_${location.replace(/\W+/g, '-')}-${getCurrentDate()}.csv`

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

      // Handle child job completion and parent updates
      if (isChildJob && parentId) {
        console.log(`🔗 Child job completed, updating parent progress...`)
        const { data: childJobs, error: fetchError } = await supabase.from("scraper").select("id, status, leads_count, message").eq("parent_id", parentId)

        if (!fetchError && childJobs) {
          const completedCount = childJobs.filter(job => job.status === "completed").length
          const totalLeads = childJobs.reduce((sum: number, job: any) => sum + job.leads_count, 0)
          const totalJobs = childJobs.length
          
          const parentMessage = `🎯 ${completedCount}/${totalJobs} parallel jobs completed, ${totalLeads} leads collected\n📊 Progress: ${Math.round(completedCount/totalJobs*100)}%`

          await scraper.updateDBScraper(parentId, { leads_count: totalLeads, message: parentMessage })
          await pusher.trigger(channelId, "scraper:update", { id: parentId, leads_count: totalLeads, message: parentMessage })

          // Calculate total duration from parent job start when all child jobs complete
          if (completedCount === totalJobs) {
            console.log(`🔗 All parallel jobs completed, scheduling merge...`)
            
            // Get parent job creation time to calculate total duration
            const { data: parentJob } = await supabase.from("scraper").select("created_at").eq("id", parentId).single()
            const parentStartTime = parentJob ? new Date(parentJob.created_at).getTime() : start
            const totalDuration = Math.round((Date.now() - parentStartTime) / 1000)
            
            // Update parent with total duration before merge
            await scraper.updateDBScraper(parentId, { 
              completed_in_s: totalDuration,
              message: `🎯 All ${totalJobs} parallel jobs completed in ${formatDuration(totalDuration)}, ${totalLeads} leads collected\n📄 Merging results...`
            })
            
            setTimeout(() => scraper.checkAndMergeResults(parentId, channelId, BUCKET), 5000)
          }
        }

        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Parallel job complete (${cities?.length || 1} cities processed)`,
            id,
            downloadable_link: downloadUrl,
            completed_in_s: processingTime,
            leads_count: leads.length,
            parent_id: parentId
          })
        }
      } else {
        const statusCode = foundRatio < 0.8 ? 206 : 200
        const responseMessage = foundRatio < 0.8 
          ? (isUnrealisticRequest ? "⚠️ Location may not have enough businesses of this type" : `⚠️ Not enough leads found after ${MAX_RETRIES} attempts`)
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