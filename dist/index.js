"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.BUCKET = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const node_fetch_1 = __importDefault(require("node-fetch"));
const uuid_1 = require("uuid");
const scraper_1 = require("./SDK/scraper");
const initializeSDK_1 = require("./utils/initializeSDK");
// Constants
exports.BUCKET = process.env.S3_BUCKET || "scraper-files-eu-central-1";
const MAX_RUNTIME_MS = 13 * 60 * 1000; // 13min safe margin for 15min Lambda timeout
const LEADS_PER_MINUTE = 30; // Conservative estimate: 1 lead per 2 seconds
const MAX_LEADS_PER_JOB = Math.floor(MAX_RUNTIME_MS / 60000 * LEADS_PER_MINUTE);
const PROGRESS_UPDATE_INTERVAL = 30000; // Update every 30 seconds
const MAX_RETRIES = 3;
const SDK_EMOJIS = {
    duckduckGoSDK: '🦆',
    foursquareSDK: '📍',
    googleCustomSearchSDK: '🌐',
    hunterSDK: '🕵️',
    openCorporatesSDK: '🏢',
    puppeteerGoogleMapsSDK: '🧠',
    searchSDK: '🔎',
    serpSDK: '📊',
    tomtomSDK: '🗺️',
};
/**
 * Safely extracts email from website with comprehensive error handling
 */
const extractEmailSafely = async (url) => {
    try {
        if (!url.startsWith('http://') && !url.startsWith('https://'))
            url = 'https://' + url;
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Email extraction timeout')), 4000));
        const res = await Promise.race([
            (0, node_fetch_1.default)(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" }, timeout: 3500 }),
            timeoutPromise
        ]);
        if (!res.ok)
            return "";
        const html = await res.text();
        const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}/g);
        return emails?.find(e => !/(example|test|placeholder|noreply|no-reply|admin|info@example)/.test(e.toLowerCase()) &&
            e.length < 50) || "";
    }
    catch {
        return "";
    }
};
/**
 * Updates progress in database and triggers Pusher event every 30 seconds
 */
const startProgressUpdater = (id, channelId, getCurrentCount, getCurrentLogs, startTime) => {
    const updateProgress = async () => {
        try {
            const currentCount = getCurrentCount();
            const currentLogs = getCurrentLogs();
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const formattedTime = formatDuration(elapsedSeconds);
            const message = `⏱️ Progress: ${currentCount} leads found in ${formattedTime}\n${currentLogs}`;
            await scraper.updateDBScraper(id, { leads_count: currentCount, message });
            await pusher.trigger(channelId, "scraper:update", { id, leads_count: currentCount, message });
        }
        catch (error) {
            console.error(`🔄 Progress update error for ${id}:`, error);
        }
    };
    return setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL);
};
/**
 * Formats duration in human-readable format
 */
const formatDuration = (seconds) => {
    if (seconds < 0)
        return "0s";
    if (seconds < 60)
        return `${Math.floor(seconds)}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return hours > 0
        ? `${hours}h ${minutes.toString().padStart(2, "0")}m ${remainingSeconds.toString().padStart(2, "0")}s`
        : `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
};
/**
 * Check SDK free tier usage and availability
 */
const checkSDKAvailability = async (supabase) => {
    const { data: usageData, error } = await supabase
        .from('sdk_freetier')
        .select('sdk_name, limit_value, used_count, period_start, period_duration, limit_type');
    if (error)
        return { available: [], unavailable: [], status: `❌ Database error: ${error.message}` };
    const available = [];
    const unavailable = [];
    const now = new Date();
    usageData?.forEach((sdk) => {
        const { sdk_name, limit_value, used_count, period_start, period_duration, limit_type } = sdk;
        // Check if period has expired and should reset
        let currentUsage = used_count;
        if (period_duration && period_start) {
            const periodStartDate = new Date(period_start);
            const periodEndDate = new Date(periodStartDate.getTime());
            // Add period duration to start date
            if (limit_type === 'daily') {
                periodEndDate.setDate(periodEndDate.getDate() + 1);
            }
            else if (limit_type === 'monthly') {
                periodEndDate.setMonth(periodEndDate.getMonth() + 1);
            }
            // If current time is past period end, usage should be considered 0
            if (now >= periodEndDate) {
                currentUsage = 0;
            }
        }
        const isAvailable = currentUsage < limit_value;
        const statusText = isAvailable ? sdk_name : `${sdk_name} (${currentUsage}/${limit_value})`;
        (isAvailable ? available : unavailable).push(statusText);
    });
    const status = available.length === 0
        ? `❌ All SDKs exhausted: ${unavailable.join(', ')}`
        : `✅ Available: ${available.join(', ')}${unavailable.length ? ` | ❌ Unavailable: ${unavailable.join(', ')}` : ''}`;
    return { available, unavailable, status };
};
/**
 * Generate current date in DD.MM format
 */
const getCurrentDate = () => {
    const now = new Date();
    return `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}`;
};
/**
 * Scrape places using multiple SDKs with free tier management and continue until limit is reached
 */
const scrapePlaces = async (keyword, location, limit, progressCallback, logsCallback, sdks, supabase) => {
    let logs = "";
    let allLeads = [];
    const seenCompanies = new Set();
    let attempts = 0;
    const maxAttempts = 8;
    const sdkOrder = [
        'duckduckGoSDK',
        'foursquareSDK',
        'googleCustomSearchSDK',
        'hunterSDK',
        'openCorporatesSDK',
        'puppeteerGoogleMapsSDK',
        'searchSDK',
        'serpSDK',
        'tomtomSDK'
    ];
    try {
        while (allLeads.length < limit && attempts < maxAttempts) {
            attempts++;
            // 🔍 Step 1: Check SDK availability
            const { available, status } = await checkSDKAvailability(supabase);
            logs += `🔍 Attempt ${attempts}: SDK Status: ${status}\n`;
            const availableSDKs = sdkOrder.filter(sdk => available.includes(sdk));
            if (availableSDKs.length === 0) {
                logs += `❌ No available SDKs for attempt ${attempts}\n`;
                logsCallback(logs);
                break;
            }
            // 🎯 Step 2: Remaining leads
            const remaining = limit - allLeads.length;
            logs += `🎯 Need ${remaining} more leads (${allLeads.length}/${limit})\n`;
            // 🚀 Step 3: SDK order log
            logs += `🚀 Attempt ${attempts} with ${availableSDKs.length} SDKs: ${availableSDKs.map(s => SDK_EMOJIS[s] + s).join(', ')}\n`;
            logsCallback(logs);
            // 🔁 Step 4: Scrape with each SDK
            let newLeadsThisAttempt = 0;
            for (const sdkName of availableSDKs) {
                if (allLeads.length >= limit)
                    break;
                const sdkLimit = Math.min(limit - allLeads.length, Math.max(5, Math.ceil(remaining / availableSDKs.length)));
                try {
                    const sdkStart = Date.now();
                    logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: Starting scrape for ${sdkLimit} leads...\n`;
                    logsCallback(logs);
                    const sdk = sdks[sdkName];
                    if (!sdk || typeof sdk.searchBusinesses !== 'function') {
                        logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ SDK not available or missing searchBusinesses method\n`;
                        continue;
                    }
                    const leads = await sdk.searchBusinesses(keyword, location, sdkLimit);
                    if (typeof leads === 'string') {
                        logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ SDK returned error: ${leads}\n`;
                        continue;
                    }
                    // ✅ Step 5: Dedup leads
                    const newLeads = leads.filter((lead) => {
                        const key = `${lead.company}-${lead.address}`.toLowerCase().trim();
                        if (seenCompanies.has(key))
                            return false;
                        seenCompanies.add(key);
                        return true;
                    });
                    // 📧 Step 6: Extract missing emails
                    let emailsExtracted = 0;
                    for (const lead of newLeads) {
                        if (!lead.email && lead.website) {
                            const email = await extractEmailSafely(lead.website);
                            if (email) {
                                lead.email = email;
                                emailsExtracted++;
                            }
                        }
                    }
                    allLeads.push(...newLeads);
                    newLeadsThisAttempt += newLeads.length;
                    progressCallback(allLeads.length);
                    const sdkTime = Math.round((Date.now() - sdkStart) / 1000);
                    logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ${newLeads.length} leads in ${sdkTime}s${emailsExtracted ? ` (📧 ${emailsExtracted} emails)` : ''}\n`;
                    logsCallback(logs);
                    // 📊 Step 7: Track SDK usage (no mapping needed)
                    await scraper.updateDBSDKFreeTier({ sdkName, usedCount: leads.length, increment: true });
                }
                catch (error) {
                    logs += `${SDK_EMOJIS[sdkName]} ${sdkName}: ❌ Failed - ${error.message}\n`;
                    logsCallback(logs);
                    continue;
                }
            }
            // 🛑 Step 8: Break if nothing found
            if (newLeadsThisAttempt === 0) {
                logs += `⚠️ No new leads found in attempt ${attempts}, stopping\n`;
                break;
            }
            // ⏱️ Step 9: Wait between attempts
            if (allLeads.length < limit && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        logs += `🎯 Final results: ${allLeads.length}/${limit} leads after ${attempts} attempts\n`;
        logsCallback(logs);
        return allLeads;
    }
    catch (error) {
        logs += `❌ Critical scraping error: ${error.message}\n`;
        logsCallback(logs);
        throw error;
    }
};
// Initialize clients
const init = (0, initializeSDK_1.initializeClients)();
if (typeof init === 'string')
    throw Error(init);
const { lambda, s3, supabase, pusher, openai, duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, puppeteerGoogleMapsSDK, searchSDK, serpSDK } = init;
const scraper = new scraper_1.Scraper(openai, s3, pusher, supabase, lambda);
const sdks = { duckduckGoSDK, foursquareSDK, googleCustomSearchSDK, hunterSDK, openCorporatesSDK, puppeteerGoogleMapsSDK, searchSDK, serpSDK };
/**
 * Main Lambda handler for lead scraping with regional splitting and comprehensive error handling
 */
const handler = async (event) => {
    const start = Date.now();
    let progressInterval = null;
    let currentLeadsCount = 0;
    let executionLogs = "";
    try {
        // 1. Validate input payload
        const validation = scraper.validateInput(event);
        if (!validation.valid) {
            executionLogs += `❌ Input validation failed: ${validation.error}\n`;
            console.error("❌ Input validation failed:", validation.error);
            return { statusCode: 400, body: JSON.stringify({ error: `Input validation failed: ${validation.error}`, received: event }) };
        }
        executionLogs += `🚀 Lambda execution started\n📋 Payload: ${JSON.stringify(event, null, 2)}\n`;
        console.log("=== 🚀 LAMBDA EXECUTION START ===");
        const { keyword, location, channelId, id, limit, parentId, region: jobRegion, retryCount = 0 } = event;
        const isChildJob = Boolean(parentId && jobRegion);
        const processingType = isChildJob ? 'Child' : 'Parent';
        executionLogs += `🎯 ${processingType} job: "${keyword}" in "${location}" (${limit} leads, retry ${retryCount}/${MAX_RETRIES})\n`;
        console.log(`🎯 ${processingType} job started: "${keyword}" in "${location}" (${limit} leads)`);
        // 2. Handle unrealistic limits early
        if (limit > 100000 && retryCount === 0) {
            executionLogs += `⚠️ Unrealistic limit detected: ${limit} leads requested\n🔄 Adjusting expectations for location capacity...\n`;
            console.log(`⚠️ Unrealistic limit detected: ${limit} leads`);
            await scraper.updateDBScraper(id, {
                message: `⚠️ Very large request (${limit} leads) - this may take time or return fewer results than expected\n${executionLogs}`
            });
            await pusher.trigger(channelId, "scraper:update", {
                id,
                message: `⚠️ Processing large request (${limit} leads) - please be patient...`
            });
        }
        // 3. Check SDK availability before processing
        const { available, status: sdkStatus } = await checkSDKAvailability(supabase);
        if (available.length === 0) {
            executionLogs += `❌ All SDKs exhausted: ${sdkStatus}\n`;
            await scraper.updateDBScraper(id, { status: "error", message: executionLogs });
            await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs });
            return { statusCode: 429, body: JSON.stringify({ error: executionLogs.trim() }) };
        }
        // 4. Handle parent job (large request splitting)
        if (!isChildJob && limit > MAX_LEADS_PER_JOB) {
            executionLogs += `📊 Large request detected (${limit} > ${MAX_LEADS_PER_JOB})\n🔄 Initiating regional split...\n`;
            console.log(`📊 Large request detected, splitting into regions...`);
            try {
                const regions = await scraper.generateRegionalChunks(location);
                const leadsPerRegion = Math.ceil(limit / 4);
                executionLogs += `📍 Generated regions: ${regions.map(r => `${r.region} (${r.location})`).join(', ')}\n`;
                executionLogs += `📊 Leads per region: ${leadsPerRegion}\n`;
                // Create child job records
                const childJobs = regions.map((r) => ({
                    id: (0, uuid_1.v4)(),
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
                }));
                const { error: insertError } = await supabase.from("scraper").insert(childJobs);
                if (insertError) {
                    executionLogs += `❌ Database insert failed: ${insertError.message}\n`;
                    throw new Error(`Database insert failed: ${insertError.message}`);
                }
                // Invoke child Lambdas
                const invocationResults = await Promise.allSettled(childJobs.map((job) => {
                    console.log(`🚀 Triggering child Lambda for region: ${job.region}`, { keyword, location: job.location, limit: leadsPerRegion });
                    return scraper.invokeChildLambda({
                        keyword,
                        location: job.location,
                        limit: leadsPerRegion,
                        channelId,
                        id: job.id,
                        parentId: id,
                        region: job.region
                    });
                }));
                const successful = invocationResults.filter((r) => r.status === 'fulfilled' && r.value.success).length;
                if (successful === 0) {
                    executionLogs += `❌ All child Lambda invocations failed\n`;
                    throw new Error("All child Lambda invocations failed");
                }
                executionLogs += `✅ Successfully triggered ${successful}/${childJobs.length} child Lambdas\n`;
                console.log(`✅ Successfully triggered ${successful}/${childJobs.length} child Lambdas`);
                console.log(`📍 Regions triggered: ${regions.map(r => r.region).join(', ')}`);
                await scraper.updateDBScraper(id, {
                    status: "pending",
                    message: `🔄 Split into ${successful} regional jobs: ${regions.map(r => r.region).join(", ")}\n${executionLogs}`
                });
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
                };
            }
            catch (error) {
                executionLogs += `❌ Regional splitting failed: ${error.message}\n`;
                await scraper.updateDBScraper(id, { status: "error", message: executionLogs });
                await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs });
                throw error;
            }
        }
        // 5. Handle child job (or small parent job)
        executionLogs += `📈 Starting progress updates every ${PROGRESS_UPDATE_INTERVAL / 1000}s\n`;
        progressInterval = startProgressUpdater(id, channelId, () => currentLeadsCount, () => executionLogs, start);
        executionLogs += `🔍 Starting lead scraping process...\n`;
        console.log(`🔍 Starting lead scraping process...`);
        const scrapeStart = Date.now();
        try {
            const leads = await scrapePlaces(keyword, location, limit, (count) => { currentLeadsCount = count; }, (logs) => { executionLogs = logs; }, sdks, supabase);
            const scrapeTime = Math.round((Date.now() - scrapeStart) / 1000);
            executionLogs += `✅ Scraping completed in ${scrapeTime}s\n📊 Results: ${leads.length}/${limit} leads (${Math.round(leads.length / limit * 100)}%)\n`;
            console.log(`✅ Scraping completed: ${leads.length}/${limit} leads in ${scrapeTime}s`);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            const processingTime = Math.round((Date.now() - start) / 1000);
            const foundRatio = leads.length / limit;
            // 6. Retry logic for insufficient leads - but cap retries for unrealistic limits
            const shouldRetry = foundRatio < 0.8 && retryCount < MAX_RETRIES && limit <= 10000;
            if (shouldRetry) {
                executionLogs += `🔄 Insufficient leads found (${Math.round(foundRatio * 100)}%)\n🔄 Retry ${retryCount + 1}/${MAX_RETRIES} starting...\n`;
                console.log(`🔄 Insufficient leads, retrying ${retryCount + 1}/${MAX_RETRIES}...`);
                const retryMessage = `🔄 Retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found\n${executionLogs}`;
                await scraper.updateDBScraper(id, { message: retryMessage });
                await pusher.trigger(channelId, "scraper:update", { id, message: retryMessage });
                return (0, exports.handler)({ ...event, retryCount: retryCount + 1 });
            }
            // 7. Generate and upload CSV
            executionLogs += `📄 Generating CSV file...\n`;
            console.log(`📄 Generating CSV file...`);
            const header = "Name,Address,Phone,Email,Website";
            const csvRows = leads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website]
                .map(cell => `"${(cell || '').replace(/"/g, '""')}"`)
                .join(","));
            const csv = [header, ...csvRows].join("\n");
            const fileName = `${limit}_${keyword.replace(/\W+/g, '-')}_${location.replace(/\W+/g, '-')}-${getCurrentDate()}${jobRegion ? `_${jobRegion}` : ''}.csv`;
            await s3.send(new client_s3_1.PutObjectCommand({
                Bucket: exports.BUCKET,
                Key: fileName,
                Body: csv,
                ContentType: "text/csv",
                ContentDisposition: `attachment; filename="${fileName}"`
            }));
            const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.GetObjectCommand({ Bucket: exports.BUCKET, Key: fileName }), { expiresIn: 86400 });
            executionLogs += `💾 Uploaded to S3: ${fileName} (${csvRows.length + 1} rows)\n`;
            // 8. Update database with completion status
            const isUnrealisticRequest = limit > 10000 && foundRatio < 0.3;
            const completionMessage = isUnrealisticRequest
                ? `⚠️ Large request completed: ${leads.length} leads found (${location} may not have ${limit} "${keyword}" businesses)`
                : `✅ Completed: ${leads.length} leads found in ${formatDuration(processingTime)}`;
            const finalMessage = `${completionMessage}\n${executionLogs}`;
            await scraper.updateDBScraper(id, {
                downloadable_link: downloadUrl,
                completed_in_s: processingTime,
                status: "completed",
                leads_count: leads.length,
                message: finalMessage
            });
            console.log(`✅ Job completed: ${leads.length}/${limit} leads in ${processingTime}s`);
            // 9. Handle child job completion
            if (isChildJob && parentId) {
                console.log(`🔗 Child job completed, updating parent progress...`);
                // Aggregate child job progress for parent
                const { data: childJobs, error: fetchError } = await supabase
                    .from("scraper")
                    .select("id, status, leads_count, message")
                    .eq("parent_id", parentId);
                if (!fetchError && childJobs) {
                    const completedCount = childJobs.filter(job => job.status === "completed").length;
                    const totalLeads = childJobs.reduce((sum, job) => sum + job.leads_count, 0);
                    const totalRegions = childJobs.length;
                    // Combine SDK performance from all completed children
                    const sdkPerformance = childJobs
                        .filter(job => job.status === "completed")
                        .map(job => job.message?.split('\n').filter((line) => line.includes('leads in') && line.includes('s')).join('\n'))
                        .filter(Boolean)
                        .join('\n');
                    const parentMessage = `🎯 ${completedCount}/${totalRegions} regions completed, ${totalLeads} leads collected\n\n📊 SDK Performance:\n${sdkPerformance}`;
                    await scraper.updateDBScraper(parentId, { leads_count: totalLeads, message: parentMessage });
                    await pusher.trigger(channelId, "scraper:update", { id: parentId, leads_count: totalLeads, message: parentMessage });
                    // Schedule merge if all children are complete
                    if (completedCount === totalRegions) {
                        console.log(`🔗 All child jobs completed, scheduling merge...`);
                        setTimeout(() => scraper.checkAndMergeResults(parentId, channelId, exports.BUCKET), 5000);
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
                };
            }
            else {
                // 10. Handle small parent job completion
                const statusCode = foundRatio < 0.8 ? 206 : 200;
                const responseMessage = foundRatio < 0.8
                    ? (isUnrealisticRequest ? "⚠️ Location may not have enough businesses of this type" : "⚠️ Not enough leads in this location")
                    : "✅ Scraping completed successfully";
                await pusher.trigger(channelId, "scraper:completed", {
                    id,
                    downloadable_link: downloadUrl,
                    completed_in_s: processingTime,
                    leads_count: leads.length,
                    message: finalMessage,
                    status: 'completed'
                });
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
                };
            }
        }
        catch (scrapeError) {
            const processingTime = Math.round((Date.now() - start) / 1000);
            executionLogs += `❌ Scraping failed: ${scrapeError.message} (${processingTime}s, retry ${retryCount})\n`;
            if (progressInterval)
                clearInterval(progressInterval);
            await scraper.updateDBScraper(id, { status: "error", completed_in_s: processingTime, message: executionLogs });
            await pusher.trigger(channelId, "scraper:error", { id, error: executionLogs });
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: executionLogs.trim(),
                    id,
                    processing_time: processingTime
                })
            };
        }
    }
    catch (error) {
        const processingTime = Math.round((Date.now() - start) / 1000);
        executionLogs += `❌ Critical error: ${error.message} (${processingTime}s, retry ${event.retryCount || 0})\n`;
        console.error("❌ LAMBDA EXECUTION FAILED:", executionLogs);
        if (progressInterval)
            clearInterval(progressInterval);
        try {
            await scraper.updateDBScraper(event.id, { completed_in_s: processingTime, status: "error", message: executionLogs });
            await pusher.trigger(event.channelId, "scraper:error", { id: event.id, error: executionLogs });
        }
        catch (notifyError) {
            console.error("❌ Failed to handle error state:", notifyError);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: executionLogs.trim(),
                id: event.id,
                processing_time: processingTime
            })
        };
    }
    finally {
        const totalTime = Math.round((Date.now() - start) / 1000);
        console.log(`=== ✅ LAMBDA EXECUTION END (${totalTime}s) ===`);
    }
};
exports.handler = handler;
