"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const supabase_js_1 = require("@supabase/supabase-js");
const pusher_1 = __importDefault(require("pusher"));
const openai_1 = __importDefault(require("openai"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const uuid_1 = require("uuid");
// Environment variables with validation
const requiredEnvVars = {
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    PUSHER_APP_ID: process.env.PUSHER_APP_ID,
    NEXT_PUBLIC_PUSHER_APP_KEY: process.env.NEXT_PUBLIC_PUSHER_APP_KEY,
    PUSHER_SECRET: process.env.PUSHER_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    REGION: process.env.REGION,
    ACCESS_KEY_ID: process.env.ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.SECRET_ACCESS_KEY,
    OPENAI_KEY: process.env.OPENAI_KEY
};
const missingVars = Object.entries(requiredEnvVars).filter(([_, value]) => !value).map(([key]) => key);
if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}
const { GOOGLE_MAPS_API_KEY: mapsKey, PUSHER_APP_ID: appId, NEXT_PUBLIC_PUSHER_APP_KEY: pubKey, PUSHER_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_URL: supabaseUrl, REGION: region, ACCESS_KEY_ID: accessKey, SECRET_ACCESS_KEY: secretKey, OPENAI_KEY: openaiKey } = requiredEnvVars;
const AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || "lead-scraper";
const BUCKET = process.env.S3_BUCKET || "scraper-files-eu-central-1";
// Initialize clients with error handling
let lambda, s3, supabase, pusher, openai;
try {
    lambda = new client_lambda_1.LambdaClient({ region });
    s3 = new client_s3_1.S3Client({
        region,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }
    });
    supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    pusher = new pusher_1.default({ appId: appId, key: pubKey, secret: secret, cluster: "eu", useTLS: true });
    openai = new openai_1.default({ apiKey: openaiKey });
}
catch (error) {
    console.error("Failed to initialize AWS/external clients:", error);
    throw new Error(`Client initialization failed: ${error}`);
}
// Constants
const MAX_RUNTIME_MS = 13 * 60 * 1000; // 13min safe margin for 15min Lambda timeout
const LEADS_PER_MINUTE = 100;
const MAX_LEADS_PER_JOB = Math.floor(MAX_RUNTIME_MS / 60000 * LEADS_PER_MINUTE);
const PROGRESS_UPDATE_INTERVAL = 30000; // 30 seconds
const MAX_RETRIES = 3;
/**
 * Validates input payload with detailed error messages
 */
const validateInput = (payload) => {
    if (!payload)
        return { valid: false, error: "Payload is required" };
    const { keyword, location, channelId, id, limit } = payload;
    if (!keyword?.trim())
        return { valid: false, error: "keyword is required and cannot be empty" };
    if (!location?.trim())
        return { valid: false, error: "location is required and cannot be empty" };
    if (!channelId?.trim())
        return { valid: false, error: "channelId is required and cannot be empty" };
    if (!id?.trim())
        return { valid: false, error: "id is required and cannot be empty" };
    const numLimit = Number(limit || 10);
    if (isNaN(numLimit) || numLimit < 1 || numLimit > 500000) {
        return { valid: false, error: "limit must be a number between 1 and 500000" };
    }
    return { valid: true };
};
/**
 * Safely extracts JSON from OpenAI response, handling markdown code blocks
 */
const extractJsonFromResponse = (content) => {
    if (!content?.trim()) {
        console.warn("Empty OpenAI response content");
        return [];
    }
    try {
        const cleanContent = content
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();
        const parsed = JSON.parse(cleanContent);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (parseError) {
        console.error("JSON parse error:", parseError);
        console.error("Raw content:", content);
        console.error("Cleaned content:", content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
        return [];
    }
};
/**
 * Generates regional chunks using AI with robust error handling
 */
const generateRegionalChunks = async (location) => {
    try {
        console.log(`Generating regional chunks for: ${location}`);
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                    role: "system",
                    content: `You are a geographical expert. Split the given location into exactly 4 distinct regions for business lead scraping.
        
        IMPORTANT: Return ONLY a valid JSON array with this exact structure:
        [
          {"region": "North", "location": "specific area name", "description": "brief description"},
          {"region": "South", "location": "specific area name", "description": "brief description"},
          {"region": "East", "location": "specific area name", "description": "brief description"},
          {"region": "West", "location": "specific area name", "description": "brief description"}
        ]
        
        Do not include markdown formatting, explanations, or any other text.`
                }, {
                    role: "user",
                    content: `Split "${location}" into 4 geographical regions with specific area names for maximum business coverage`
                }],
            temperature: 0.1,
            max_tokens: 500
        });
        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.warn("No content in OpenAI response");
            return getFallbackChunks(location);
        }
        const chunks = extractJsonFromResponse(content);
        const isValidChunk = (chunk) => chunk && typeof chunk.region === 'string' && typeof chunk.location === 'string';
        const validChunks = chunks.filter(isValidChunk);
        if (validChunks.length === 4) {
            console.log(`Successfully generated ${validChunks.length} regional chunks:`, validChunks.map(c => c.region).join(', '));
            return validChunks;
        }
        console.warn(`Invalid chunks received (${validChunks.length}/4), using fallback`);
        return getFallbackChunks(location);
    }
    catch (error) {
        console.error("AI chunking failed:", error);
        console.error("Error details:", {
            name: error.name,
            message: error.message,
            stack: error.stack?.slice(0, 500)
        });
        return getFallbackChunks(location);
    }
};
/**
 * Fallback regional chunks when AI fails
 */
const getFallbackChunks = (location) => {
    console.log(`Using fallback chunks for: ${location}`);
    return [
        { region: "North", location: `${location} North`, description: "Northern area coverage" },
        { region: "South", location: `${location} South`, description: "Southern area coverage" },
        { region: "East", location: `${location} East`, description: "Eastern area coverage" },
        { region: "West", location: `${location} West`, description: "Western area coverage" }
    ];
};
/**
 * Scrapes leads from Google Maps with progress callback
 */
const scrapePlaces = async (keyword, location, limit, onProgress) => {
    const allPlaces = new Map();
    const queries = [
        `${keyword} in ${location}`,
        `${keyword} near ${location}`,
        `best ${keyword} ${location}`,
        `top ${keyword} ${location}`,
        `${keyword} services ${location}`
    ];
    console.log(`Starting search with ${queries.length} queries for "${keyword}" in "${location}"`);
    const queryPromises = queries.map(async (query, index) => {
        const places = new Map();
        let token;
        let pages = 0;
        const maxPages = 3;
        console.log(`Query ${index + 1}/${queries.length}: "${query}"`);
        while (places.size < Math.ceil(limit / 2) && pages < maxPages) {
            try {
                const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
                url.searchParams.set("query", query);
                url.searchParams.set("key", mapsKey);
                if (token)
                    url.searchParams.set("pagetoken", token);
                const res = await (0, node_fetch_1.default)(url.toString(), { timeout: 10000 });
                if (!res.ok) {
                    console.error(`HTTP ${res.status} for query "${query}":`, res.statusText);
                    break;
                }
                const data = await res.json();
                if (data.status === "ZERO_RESULTS") {
                    console.log(`No results for query: "${query}"`);
                    break;
                }
                if (data.status !== "OK") {
                    console.error(`API error for query "${query}":`, data.status, data.error_message);
                    break;
                }
                const resultsCount = data.results?.length || 0;
                console.log(`Query "${query}" page ${pages + 1}: ${resultsCount} results`);
                data.results?.forEach((place) => {
                    if (place.place_id && !places.has(place.place_id)) {
                        places.set(place.place_id, place);
                    }
                });
                token = data.next_page_token;
                pages++;
                if (!token) {
                    console.log(`No more pages for query: "${query}"`);
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            catch (error) {
                console.error(`Query "${query}" page ${pages + 1} failed:`, error);
                break;
            }
        }
        console.log(`Query "${query}" completed: ${places.size} unique places`);
        return Array.from(places.values());
    });
    const results = await Promise.allSettled(queryPromises);
    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            result.value.forEach(place => {
                if (place.place_id && !allPlaces.has(place.place_id))
                    allPlaces.set(place.place_id, place);
            });
        }
        else {
            console.error(`Query ${index + 1} failed:`, result.reason);
        }
    });
    console.log(`Total unique places found: ${allPlaces.size}`);
    return processPlaces(Array.from(allPlaces.values()), limit, onProgress);
};
/**
 * Processes places into leads with progress updates
 */
const processPlaces = async (places, limit, onBatchComplete) => {
    const leads = [];
    const seen = {
        emails: new Set(),
        phones: new Set(),
        companies: new Set()
    };
    console.log(`Processing ${places.length} places into leads (limit: ${limit})`);
    const batchSize = 15;
    let processedCount = 0;
    for (let i = 0; i < places.length && leads.length < limit; i += batchSize) {
        const batch = places.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: places ${i + 1}-${Math.min(i + batchSize, places.length)}`);
        const batchPromises = batch.map(async (place, batchIndex) => {
            try {
                if (!place.place_id) {
                    console.warn(`Place ${i + batchIndex + 1} missing place_id`);
                    return null;
                }
                const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,business_status&key=${mapsKey}`;
                const res = await (0, node_fetch_1.default)(detailsUrl, { timeout: 8000 });
                if (!res.ok) {
                    console.error(`Details API error for place ${place.place_id}: HTTP ${res.status}`);
                    return null;
                }
                const data = await res.json();
                if (data.status !== "OK") {
                    console.error(`Details API status error for place ${place.place_id}:`, data.status);
                    return null;
                }
                const result = data.result;
                if (!result?.name || result.business_status === "CLOSED_PERMANENTLY") {
                    return null;
                }
                const { name: company, formatted_address: address, formatted_phone_number: phone, website } = result;
                const normalizedCompany = company?.toLowerCase().trim();
                const normalizedPhone = phone?.replace(/\D/g, '');
                if (normalizedCompany && seen.companies.has(normalizedCompany))
                    return null;
                if (normalizedPhone && normalizedPhone.length > 5 && seen.phones.has(normalizedPhone))
                    return null;
                const email = website ? await extractEmailSafely(website) : "";
                if (email && seen.emails.has(email.toLowerCase()))
                    return null;
                if (normalizedCompany)
                    seen.companies.add(normalizedCompany);
                if (normalizedPhone)
                    seen.phones.add(normalizedPhone);
                if (email)
                    seen.emails.add(email.toLowerCase());
                processedCount++;
                return {
                    company: company || "",
                    address: address || "",
                    phone: phone || "",
                    email,
                    website: website || ""
                };
            }
            catch (error) {
                console.error(`Error processing place ${i + batchIndex + 1}:`, error);
                return null;
            }
        });
        const batchResults = await Promise.allSettled(batchPromises);
        const validLeads = batchResults
            .filter((r) => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);
        leads.push(...validLeads.slice(0, limit - leads.length));
        onBatchComplete(leads.length); // Update progress after each batch
        if (validLeads.length > 0) {
            console.log(`Batch completed: ${validLeads.length} valid leads added (total: ${leads.length}/${limit})`);
        }
    }
    console.log(`Final processing results: ${leads.length} leads from ${processedCount} processed places`);
    return leads.slice(0, limit);
};
/**
 * Safely extracts email from website with comprehensive error handling
 */
const extractEmailSafely = async (url) => {
    try {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Email extraction timeout')), 4000));
        const fetchPromise = (0, node_fetch_1.default)(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" },
            timeout: 3500
        });
        const res = await Promise.race([fetchPromise, timeoutPromise]);
        if (!res.ok)
            return "";
        const html = await res.text();
        const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}/g);
        const validEmail = emails?.find(e => !/(example|test|placeholder|noreply|no-reply|admin|info@example)/.test(e.toLowerCase()) &&
            e.length < 50);
        return validEmail || "";
    }
    catch (error) {
        if (!error.message.includes('timeout')) {
            console.warn(`Email extraction failed for ${url}:`, error.message);
        }
        return "";
    }
};
/**
 * Updates progress in database and triggers Pusher event every 30 seconds
 */
const startProgressUpdater = (id, channelId, getCurrentCount, startTime) => {
    const updateProgress = async () => {
        try {
            const currentCount = getCurrentCount();
            const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            const formattedTime = formatDuration(elapsedSeconds);
            const message = `Progress: ${currentCount} leads found in ${formattedTime}`;
            const { error } = await supabase
                .from("scraper")
                .update({ leads_count: currentCount, message })
                .eq("id", id);
            if (error) {
                console.error(`Progress update failed for ${id}:`, error);
            }
            else {
                console.log(`Progress updated: ${message}`);
            }
            await pusher.trigger(channelId, "scraper:update", {
                id,
                leads_count: currentCount,
                message,
            });
        }
        catch (error) {
            console.error(`Progress update error for ${id}:`, error);
        }
    };
    const interval = setInterval(updateProgress, 30000); // Update every 30 seconds
    return interval;
};
/**
 * Invokes child Lambda with comprehensive error handling
 */
const invokeChildLambda = async (payload) => {
    try {
        const command = new client_lambda_1.InvokeCommand({
            FunctionName: AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: "Event",
            Payload: JSON.stringify(payload)
        });
        const result = await lambda.send(command);
        if (result.StatusCode !== 202) {
            console.error(`Child Lambda invocation failed for region ${payload.region}: StatusCode ${result.StatusCode}`);
            return { success: false, region: payload.region || 'unknown', error: `Lambda invocation failed with status ${result.StatusCode}` };
        }
        console.log(`✓ Triggered child Lambda for region: ${payload.region}`);
        return { success: true, region: payload.region || 'unknown' };
    }
    catch (error) {
        console.error(`Failed to invoke child Lambda for region ${payload.region}:`, error);
        return { success: false, region: payload.region || 'unknown', error: error.message };
    }
};
/**
 * Checks completion and merges results with robust error handling
 */
const checkAndMergeResults = async (parentId, channelId) => {
    try {
        console.log(`Checking merge status for parent: ${parentId}`);
        const { data: children, error } = await supabase
            .from("scraper")
            .select("*")
            .eq("parent_id", parentId)
            .order("region");
        if (error)
            throw error;
        if (!children || children.length === 0) {
            console.warn(`No child jobs found for parent: ${parentId}`);
            return;
        }
        const completed = children.filter((c) => c.status === "completed");
        const failed = children.filter((c) => c.status === "error");
        console.log(`Child job status: ${completed.length} completed, ${failed.length} failed, ${children.length - completed.length - failed.length} pending`);
        if (completed.length + failed.length !== 4)
            return;
        console.log("All child jobs finished, starting merge process...");
        const allLeads = [];
        const filesToDelete = [];
        for (const child of completed) {
            if (!child.downloadable_link) {
                console.warn(`Child job ${child.id} (${child.region}) has no downloadable link`);
                continue;
            }
            try {
                const key = new URL(child.downloadable_link).pathname.substring(1);
                const { Body } = await s3.send(new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: key }));
                if (!Body) {
                    console.error(`No body in S3 response for key: ${key}`);
                    continue;
                }
                const csv = await Body.transformToString();
                const lines = csv.split("\n").slice(1);
                let lineCount = 0;
                lines.forEach(line => {
                    if (line.trim()) {
                        try {
                            const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                            const clean = values.map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
                            if (clean.length >= 5) {
                                allLeads.push({
                                    company: clean[0] || "",
                                    address: clean[1] || "",
                                    phone: clean[2] || "",
                                    email: clean[3] || "",
                                    website: clean[4] || ""
                                });
                                lineCount++;
                            }
                        }
                        catch (parseError) {
                            console.warn(`Failed to parse CSV line: ${line.slice(0, 100)}...`);
                        }
                    }
                });
                console.log(`Processed ${lineCount} leads from ${child.region} region`);
                filesToDelete.push(key);
            }
            catch (error) {
                console.error(`Failed to process child result for ${child.region}:`, error);
            }
        }
        console.log(`Total leads before deduplication: ${allLeads.length}`);
        const seen = {
            emails: new Set(),
            phones: new Set(),
            companies: new Set()
        };
        const uniqueLeads = allLeads.filter(lead => {
            const company = lead.company?.toLowerCase().trim();
            const phone = lead.phone?.replace(/\D/g, '');
            const email = lead.email?.toLowerCase();
            if (company && seen.companies.has(company))
                return false;
            if (phone && phone.length > 5 && seen.phones.has(phone))
                return false;
            if (email && seen.emails.has(email))
                return false;
            if (company)
                seen.companies.add(company);
            if (phone)
                seen.phones.add(phone);
            if (email)
                seen.emails.add(email);
            return true;
        });
        const duplicatesRemoved = allLeads.length - uniqueLeads.length;
        console.log(`Deduplication complete: ${uniqueLeads.length} unique leads (${duplicatesRemoved} duplicates removed)`);
        const header = "Name,Address,Phone,Email,Website";
        const csvRows = uniqueLeads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website]
            .map(cell => `"${(cell || '').replace(/"/g, '""')}"`)
            .join(","));
        const mergedCsv = [header, ...csvRows].join("\n");
        const fileName = `merged-${Date.now()}-${uniqueLeads.length}leads.csv`;
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: BUCKET,
            Key: fileName,
            Body: mergedCsv,
            ContentType: "text/csv",
            ContentDisposition: `attachment; filename="${fileName}"`
        }));
        const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: fileName }), { expiresIn: 86400 });
        const totalTime = completed.reduce((sum, c) => sum + (c.completed_in_s || 0), 0);
        await supabase
            .from("scraper")
            .update({
            downloadable_link: downloadUrl,
            completed_in_s: totalTime,
            status: "completed",
            leads_count: uniqueLeads.length
        })
            .eq("id", parentId);
        await pusher.trigger(channelId, "scraper:completed", {
            id: parentId,
            downloadable_link: downloadUrl,
            completed_in_s: totalTime,
            leads_count: uniqueLeads.length,
            message: failed.length > 0 ? `Completed with ${failed.length} failed regions` : "All regions completed successfully"
        });
        const cleanupPromises = filesToDelete.map(async (key) => {
            try {
                await s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
                console.log(`Cleaned up file: ${key}`);
            }
            catch (error) {
                console.warn(`Failed to delete file ${key}:`, error);
            }
        });
        await supabase.from("scraper").delete().eq("parent_id", parentId);
        await Promise.allSettled(cleanupPromises);
        console.log(`Merge process completed for parent: ${parentId}`);
    }
    catch (error) {
        console.error("Merge process failed:", error);
        await supabase.from("scraper").update({ status: "error", completed_in_s: 0 }).eq("id", parentId);
        await pusher.trigger(channelId, "scraper:error", { id: parentId, error: `Merge failed: ${error.message}` });
    }
};
/**
 * Updates database record with comprehensive error handling
 */
const updateDB = async (id, data) => {
    try {
        const { error } = await supabase.from("scraper").update(data).eq("id", id);
        if (error)
            throw error;
        console.log(`✓ DB updated for ${id}:`, Object.keys(data).join(", "));
    }
    catch (error) {
        console.error(`Critical DB update error for ${id}:`, error);
        throw error;
    }
};
function formatDuration(seconds) {
    if (seconds < 0)
        return "0s"; // Handle negative input
    if (seconds < 60)
        return `${Math.floor(seconds)}s`; // Less than 1 minute
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}h ${minutes.toString().padStart(2, "0")}m ${remainingSeconds.toString().padStart(2, "0")}s`;
    }
    return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}
/**
 * Main Lambda handler with comprehensive error handling and logging
 *
 * Processing Flow:
 * 1. Validate input payload with detailed error messages
 * 2. For large requests (>MAX_LEADS_PER_JOB): split into 4 regional child Lambdas
 * 3. For child jobs: process single region with retry logic (up to 3 attempts); on completion, update parent task with aggregated progress via Pusher `scraper:update` and database
 * 4. When all children complete: merge results and perform global deduplication
 * 5. Update progress every 30s with human-readable messages (elapsed time, leads, errors) for parent and child jobs
 * 6. Return appropriate status codes (200, 202, 206, 400, 500) with detailed messages
 *
 * Notes:
 * - Child jobs are backend-only and not visible on the frontend
 * - Child job completion updates parent task's `leads_count` and `message` (e.g., "1/4 regions completed")
 * - Pusher events for child completion use `scraper:update` with parent `id` to update parent task progress
 */
const handler = async (event) => {
    const start = Date.now();
    let progressInterval = null;
    let currentLeadsCount = 0;
    console.log("=== LAMBDA EXECUTION START ===");
    console.log("Event payload:", JSON.stringify(event, null, 2));
    console.log("Environment check:", {
        region,
        bucket: BUCKET,
        functionName: AWS_LAMBDA_FUNCTION_NAME,
        hasOpenAI: !!openaiKey,
        hasMapsKey: !!mapsKey
    });
    try {
        // Validate input payload
        const validation = validateInput(event);
        if (!validation.valid) {
            console.error("❌ Input validation failed:", validation.error);
            return { statusCode: 400, body: JSON.stringify({ error: `Input validation failed: ${validation.error}`, received: event }) };
        }
        const { keyword, location, channelId, id, limit, parentId, region: jobRegion, retryCount = 0 } = event;
        const isChildJob = Boolean(parentId && jobRegion);
        const processingType = isChildJob ? 'Child' : 'Parent';
        console.log(`\n🚀 ${processingType} job started:`);
        console.log(`   Keyword: "${keyword}"`);
        console.log(`   Location: "${location}"`);
        console.log(`   Limit: ${limit} leads`);
        console.log(`   Region: ${jobRegion || 'N/A'}`);
        console.log(`   Retry: ${retryCount}/${MAX_RETRIES}`);
        console.log(`   Job ID: ${id}`);
        console.log(`   Parent ID: ${parentId || 'N/A'}`);
        // Handle parent job (large request splitting)
        if (!isChildJob && limit > MAX_LEADS_PER_JOB) {
            console.log(`\n📊 Large request detected (${limit} > ${MAX_LEADS_PER_JOB})`);
            console.log("🔄 Initiating regional split process...");
            // Generate regional chunks
            const regions = await generateRegionalChunks(location);
            const leadsPerRegion = Math.ceil(limit / 4);
            console.log(`📍 Generated regions:`, regions.map(r => `${r.region} (${r.location})`).join(', '));
            console.log(`📊 Leads per region: ${leadsPerRegion}`);
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
                message: "Initialized: Waiting to start"
            }));
            const { error: insertError } = await supabase.from("scraper").insert(childJobs);
            if (insertError)
                throw new Error(`Database insert failed: ${insertError.message}`);
            console.log(`✅ Created ${childJobs.length} child job records in database`);
            // Invoke child Lambdas
            const invocationResults = await Promise.allSettled(childJobs.map((job) => invokeChildLambda({
                keyword,
                location: job.location,
                limit: leadsPerRegion,
                channelId,
                id: job.id,
                parentId: id,
                region: job.region
            })));
            const successful = invocationResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = invocationResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
            if (failed.length > 0) {
                console.error(`❌ ${failed.length}/${childJobs.length} child invocations failed`);
                failed.forEach((result, index) => {
                    const error = result.status === 'rejected' ? result.reason : result.value.error;
                    console.error(`   Region ${regions[index]?.region}:`, error);
                });
            }
            if (successful === 0)
                throw new Error("All child Lambda invocations failed");
            console.log(`✅ Successfully triggered ${successful}/${childJobs.length} child Lambdas`);
            console.log(`📍 Regions processing: ${regions.map(r => r.region).join(", ")}`);
            // Update parent job status
            await updateDB(id, {
                status: "processing_regions",
                message: `Split into ${successful} regional jobs: ${regions.map(r => r.region).join(", ")}`
            });
            return {
                statusCode: 202,
                body: JSON.stringify({
                    message: `Split into ${successful} regional jobs`,
                    id,
                    regions: regions.map(r => r.region),
                    status: "processing_regions",
                    leads_per_region: leadsPerRegion,
                    total_expected: successful * leadsPerRegion
                })
            };
        }
        // Handle child job (or small parent job)
        console.log(`\n📈 Starting progress updates every 30s`);
        progressInterval = startProgressUpdater(id, channelId, () => currentLeadsCount, start);
        console.log(`\n🔍 Starting lead scraping process...`);
        const scrapeStart = Date.now();
        try {
            const leads = await scrapePlaces(keyword, location, limit, (count) => {
                currentLeadsCount = count;
            });
            const scrapeTime = Math.round((Date.now() - scrapeStart) / 1000);
            console.log(`\n✅ Scraping completed in ${scrapeTime}s`);
            console.log(`📊 Results: ${leads.length}/${limit} leads (${Math.round(leads.length / limit * 100)}%)`);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            const processingTime = Math.round((Date.now() - start) / 1000);
            const foundRatio = leads.length / limit;
            // Retry logic for insufficient leads
            if (foundRatio < 0.8 && retryCount < MAX_RETRIES) {
                console.log(`\n🔄 Insufficient leads found (${Math.round(foundRatio * 100)}%)`);
                console.log(`   Retry ${retryCount + 1}/${MAX_RETRIES} starting...`);
                const retryMessage = `Retrying (${retryCount + 1}/${MAX_RETRIES}): ${leads.length} leads found`;
                await updateDB(id, { message: retryMessage });
                await pusher.trigger(channelId, "scraper:update", { id, message: retryMessage });
                return (0, exports.handler)({ ...event, retryCount: retryCount + 1 });
            }
            // Generate and upload CSV
            console.log(`\n📄 Generating CSV file...`);
            const header = "Name,Address,Phone,Email,Website";
            const csvRows = leads.map(lead => [lead.company, lead.address, lead.phone, lead.email, lead.website]
                .map(cell => `"${(cell || '').replace(/"/g, '""')}"`)
                .join(","));
            const csv = [header, ...csvRows].join("\n");
            const csvSize = Buffer.byteLength(csv, 'utf8');
            console.log(`📄 CSV generated: ${csv.split('\n').length - 1} rows, ${Math.round(csvSize / 1024)}KB`);
            const fileName = `${keyword.replace(/\W+/g, '-')}-${location.replace(/\W+/g, '-')}-${leads.length}-${Date.now()}${jobRegion ? `-${jobRegion}` : ''}.csv`;
            await s3.send(new client_s3_1.PutObjectCommand({
                Bucket: BUCKET,
                Key: fileName,
                Body: csv,
                ContentType: "text/csv",
                ContentDisposition: `attachment; filename="${fileName}"`
            }));
            console.log(`✅ Uploaded to S3: ${fileName}`);
            const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: fileName }), { expiresIn: 86400 });
            // Update database with completion status
            const finalMessage = `Completed: ${leads.length} leads found in ${formatDuration(processingTime)}`;
            await updateDB(id, {
                downloadable_link: downloadUrl,
                completed_in_s: processingTime,
                status: "completed",
                leads_count: leads.length,
                message: finalMessage
            });
            console.log(`\n✅ Job completed successfully:`);
            console.log(`   📊 Leads: ${leads.length}/${limit}`);
            console.log(`   ⏱️  Time: ${processingTime}s`);
            console.log(`   💾 File: ${fileName}`);
            console.log(`   🔄 Retries: ${retryCount}`);
            // Handle child job completion
            if (isChildJob && parentId) {
                console.log(`\n🔗 Child job completed, updating parent progress...`);
                // Update child job in database immediately
                await updateDB(id, {
                    downloadable_link: downloadUrl,
                    completed_in_s: processingTime,
                    status: "completed",
                    leads_count: leads.length,
                    message: finalMessage
                });
                // Aggregate child job progress for parent
                const { data: childJobs, error: fetchError } = await supabase
                    .from("scraper")
                    .select("id, status, leads_count")
                    .eq("parent_id", parentId);
                if (fetchError)
                    throw new Error(`Failed to fetch child jobs: ${fetchError.message}`);
                const completedCount = childJobs.filter((job) => job.status === "completed").length;
                const totalLeads = childJobs.reduce((sum, job) => sum + job.leads_count, 0);
                const totalRegions = childJobs.length;
                const parentMessage = `${completedCount}/${totalRegions} regions completed, ${totalLeads} leads collected`;
                // Update parent job in database
                await updateDB(parentId, {
                    leads_count: totalLeads,
                    message: parentMessage
                });
                // Trigger Pusher event for parent
                await pusher.trigger(channelId, "scraper:update", {
                    id: parentId,
                    leads_count: totalLeads,
                    message: parentMessage
                });
                // Schedule merge if all children are complete
                if (completedCount === totalRegions) {
                    console.log(`\n🔗 All child jobs completed, scheduling merge...`);
                    setTimeout(() => checkAndMergeResults(parentId, channelId), 5000);
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
                // Handle small parent job completion
                const statusCode = foundRatio < 0.8 ? 206 : 200;
                const message = foundRatio < 0.8 ? "Not enough leads in this location" : "Scraping completed successfully";
                console.log(`\n📡 Sending completion notification...`);
                await pusher.trigger(channelId, "scraper:completed", {
                    id,
                    downloadable_link: downloadUrl,
                    completed_in_s: processingTime,
                    leads_count: leads.length,
                    message,
                    success_rate: Math.round(foundRatio * 100)
                });
                return {
                    statusCode,
                    body: JSON.stringify({
                        message,
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
            const baseErrorMessage = `Scraping failed: ${scrapeError.message || String(scrapeError)}`;
            const errorMessage = `${baseErrorMessage} (Processing time: ${processingTime} seconds, Retry count: ${retryCount})`;
            console.error(`\n❌ Scraping error: ${errorMessage}`);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            await updateDB(id, {
                status: "error",
                completed_in_s: processingTime,
                message: errorMessage
            });
            await pusher.trigger(channelId, "scraper:error", {
                id,
                error: errorMessage
            });
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: errorMessage,
                    id,
                    processing_time: processingTime,
                    type: scrapeError.constructor?.name || 'Unknown'
                })
            };
        }
    }
    catch (error) {
        const processingTime = Math.round((Date.now() - start) / 1000);
        const baseErrorMessage = `Critical error: ${error.message || String(error)}`;
        const errorMessage = `${baseErrorMessage} (Processing time: ${processingTime} seconds, Retry count: ${event.retryCount || 0})`;
        console.error("\n❌ LAMBDA EXECUTION FAILED:");
        console.error("   Error:", baseErrorMessage);
        console.error("   Type:", error.constructor?.name || 'Unknown');
        console.error("   Stack:", error.stack?.slice(0, 1000));
        console.error("   Processing time:", processingTime + "s");
        if (progressInterval)
            clearInterval(progressInterval);
        try {
            await updateDB(event.id, {
                completed_in_s: processingTime,
                status: "error",
                message: errorMessage
            });
            await pusher.trigger(event.channelId, "scraper:error", {
                id: event.id,
                error: errorMessage
            });
        }
        catch (notifyError) {
            console.error("❌ Failed to handle error state:", notifyError);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: errorMessage,
                id: event.id,
                processing_time: processingTime,
                type: error.constructor?.name || 'Unknown'
            })
        };
    }
    finally {
        const totalTime = Math.round((Date.now() - start) / 1000);
        console.log(`\n=== LAMBDA EXECUTION END (${totalTime}s) ===`);
    }
};
exports.handler = handler;
