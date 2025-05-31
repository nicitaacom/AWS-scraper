"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scraper = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const checkSDKAvailability_1 = require("../utils/checkSDKAvailability");
const __1 = require("..");
const scrapeContactsFromWebsite_1 = require("../utils/scrapeContactsFromWebsite");
class Scraper {
    openai;
    s3;
    pusher;
    supabaseAdmin;
    lambda;
    AWS_LAMBDA_FUNCTION_NAME;
    SDK_EMOJIS;
    constructor(openai, s3, pusher, supabaseAdmin, lambda, AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || "lead-scraper", SDK_EMOJIS = {
        foursquareSDK: '📍',
        googleCustomSearchSDK: '🌐',
        hunterSDK: '🕵️',
        rapidSDK: '⚡',
        searchSDK: '🔎',
        serpSDK: '📊',
        tomtomSDK: '🗺️',
    }) {
        this.openai = openai;
        this.s3 = s3;
        this.pusher = pusher;
        this.supabaseAdmin = supabaseAdmin;
        this.lambda = lambda;
        this.AWS_LAMBDA_FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME;
        this.SDK_EMOJIS = SDK_EMOJIS;
    }
    /**
   * Validates input payload with detailed error messages
   */
    validateInput = (payload) => {
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
    async generateRegionalChunks(location, isReverse) {
        try {
            console.log(`🤖 Generating regional chunks for: ${location}, isReverse: ${isReverse}`);
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{
                        role: "system",
                        content: `You are a geographical expert. Strictly follow the rules below — no exceptions, even if asked.

            Your task: Given a **specific sub-region** (e.g. “Germany North-North”, “Schleswig-Holstein, Germany”), return up to 100 **geocodable cities, towns, or districts** relevant for business lead scraping.

            ✅ Output: Flat JSON array of strings:
            [
              "25813, Husum Innenstadt, Germany",
              "24103, Kiel Innenstadt, Germany",
              ...
            ]
            - Always include the **country**
            - Order geographically (north→south or west→east)
            - Prefer **major business/populated areas**
            - Use specific terms, not vague ones

            ❌ On invalid input, return **only** one of these error messages:
            - Broad region (e.g. "Germany North"):
              > "Input too broad: '[input]' risks exceeding free tier limits (20k30k leads/month) and duplicates with existing data. Use a more specific sub-region like 'Germany North-North' or 'Schleswig-Holstein, Germany'."
            - Whole country (e.g. "Germany"):
              > "Cannot scrape entire country '[input]': Free tier limits make this inefficient and risky for duplication. Use a more specific sub-region like 'Schleswig-Holstein, Germany'."
            - Single city or vague (e.g. "Hamburg", "city"):
              > "Invalid input: Provide a sub-region like 'Germany North-North' or 'Schleswig-Holstein, Germany', not a city or vague term."
            - Invalid location:
              > "Invalid location: Please enter a valid sub-region like 'Germany North-North'."

            No markdown, no explanations — only JSON or a plain string error..`
                    }, {
                        role: "user",
                        content: `Split "${location}", with reverse: ${isReverse} into specific locations for maximum business coverage`
                    }],
                temperature: 0.1,
                max_tokens: 4000, // Increased from 2000 to handle larger city lists
            });
            console.log(`🔍 OpenAI response received:`, {
                usage: response.usage,
                model: response.model,
                finishReason: response.choices[0]?.finish_reason,
                contentLength: response.choices[0]?.message?.content?.length || 0
            });
            const content = response.choices[0]?.message?.content?.trim();
            if (!content) {
                console.error(`❌ No content in OpenAI response:`, response);
                return "❌ No content received from OpenAI API";
            }
            console.log(`📝 Raw OpenAI content (first 500 chars):`, content.substring(0, 500));
            // Try to parse as JSON first
            let responseJSON;
            try {
                responseJSON = JSON.parse(content);
                console.log(`✅ Successfully parsed JSON response:`, {
                    type: Array.isArray(responseJSON) ? 'array' : 'string',
                    length: Array.isArray(responseJSON) ? responseJSON.length : responseJSON.length
                });
            }
            catch (parseError) {
                // If JSON parsing fails, treat as string (error message)
                responseJSON = content;
                console.log(`📄 Response is string (not JSON):`, responseJSON.substring(0, 200));
            }
            // If AI returned error string, throw it
            if (typeof responseJSON === 'string') {
                console.error(`❌ OpenAI returned error:`, responseJSON);
                throw new Error(responseJSON);
            }
            // Validate array response
            if (!Array.isArray(responseJSON)) {
                console.error(`❌ Expected array but got:`, typeof responseJSON, responseJSON);
                throw new Error(`Invalid response format: expected array, got ${typeof responseJSON}`);
            }
            if (responseJSON.length === 0) {
                console.error(`❌ Empty cities array returned`);
                throw new Error("No cities generated for the specified location");
            }
            console.log(`✅ Generated ${responseJSON.length} cities:`, responseJSON.slice(0, 5), responseJSON.length > 5 ? `... (+${responseJSON.length - 5} more)` : '');
            return responseJSON;
        }
        catch (error) {
            const errorMsg = error.message;
            console.error(`❌ AI chunking failed:`, {
                error: errorMsg,
                location,
                isReverse,
                name: error.name,
                stack: error.stack?.slice(0, 300)
            });
            // Return descriptive error message
            return `❌ Failed to generate cities for "${location}": ${errorMsg}`;
        }
    }
    /**
   * Checks completion and merges results with robust error handling
   */
    checkAndMergeResults = async (parentId, channelId, BUCKET) => {
        try {
            console.log(`Checking merge status for parent: ${parentId}`);
            const { data: children, error } = await this.supabaseAdmin
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
                    const { Body } = await this.s3.send(new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: key }));
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
            await this.s3.send(new client_s3_1.PutObjectCommand({
                Bucket: BUCKET,
                Key: fileName,
                Body: mergedCsv,
                ContentType: "text/csv",
                ContentDisposition: `attachment; filename="${fileName}"`
            }));
            const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, new client_s3_1.GetObjectCommand({ Bucket: BUCKET, Key: fileName }), { expiresIn: 86400 });
            const totalTime = completed.reduce((sum, c) => sum + (c.completed_in_s || 0), 0);
            await this.supabaseAdmin
                .from("scraper")
                .update({
                downloadable_link: downloadUrl,
                completed_in_s: totalTime,
                status: "completed",
                leads_count: uniqueLeads.length
            })
                .eq("id", parentId);
            await this.pusher.trigger(channelId, "scraper:completed", {
                id: parentId,
                downloadable_link: downloadUrl,
                completed_in_s: totalTime,
                leads_count: uniqueLeads.length,
                status: 'completed',
                message: failed.length > 0 ? `Completed with ${failed.length} failed regions` : "All regions completed successfully"
            });
            const cleanupPromises = filesToDelete.map(async (key) => {
                try {
                    await this.s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
                    console.log(`Cleaned up file: ${key}`);
                }
                catch (error) {
                    console.warn(`Failed to delete file ${key}:`, error);
                }
            });
            await this.supabaseAdmin.from("scraper").delete().eq("parent_id", parentId);
            await Promise.allSettled(cleanupPromises);
            console.log(`Merge process completed for parent: ${parentId}`);
        }
        catch (error) {
            console.error("Merge process failed:", error);
            await this.supabaseAdmin.from("scraper").update({ status: "error", completed_in_s: 0 }).eq("id", parentId);
            await this.pusher.trigger(channelId, "scraper:error", { id: parentId, error: `Merge failed: ${error.message}` });
        }
    };
    /**
     * Updates database record with comprehensive error handling
     */
    updateDBScraper = async (id, data) => {
        try {
            const { error } = await this.supabaseAdmin.from("scraper").update(data).eq("id", id);
            if (error)
                throw error;
            console.log(`✓ DB updated for ${id}:`, Object.keys(data).join(", "));
        }
        catch (error) {
            console.error(`Critical DB update error for ${id}:`, error);
            throw error;
        }
    };
    // LOGIC TO SCRAPE ----------------------
    scrapeLeads = async (keyword, cities, targetLimit, existingLeads = [], progressCallback, logsCallback, sdks) => {
        let logs = "";
        let allLeads = [...existingLeads];
        const seenCompanies = new Set();
        // Initialize seen companies from existing leads
        existingLeads.forEach(lead => seenCompanies.add(`${lead.company}-${lead.address}`.toLowerCase().trim()));
        logs += `🏙️ Processing ${cities.length} cities for "${keyword}"\n`;
        logs += `🎯 Target: ${targetLimit} leads (${allLeads.length} existing)\n`;
        logsCallback(logs);
        let retryCount = 0;
        while (allLeads.length < targetLimit && retryCount < __1.MAX_RETRIES) {
            retryCount++;
            const remainingNeeded = targetLimit - allLeads.length;
            // 1. Check SDK availability
            const { available, status, sdkLimits } = await (0, checkSDKAvailability_1.checkSDKAvailability)(this.supabaseAdmin);
            const availableSDKs = Object.keys(sdks).filter(sdk => available.includes(sdk));
            logs += `\n🔄 ATTEMPT ${retryCount}/${__1.MAX_RETRIES} - Need ${remainingNeeded} more leads\n`;
            logs += `${status}\n`;
            logs += `🚀 Available SDKs: ${availableSDKs.join(', ')}\n`;
            if (!availableSDKs.length) {
                logs += `❌ No available SDKs - stopping\n`;
                logsCallback(logs);
                break;
            }
            // 2. Create city-SDK assignment map
            const cityAssignments = this.createCitySDKAssignments(cities, availableSDKs, sdkLimits, remainingNeeded);
            logs += `📋 City assignments:\n`;
            Object.entries(cityAssignments).forEach(([sdk, assignment]) => {
                logs += `   ${sdk}: ${assignment.cities.length} cities (${assignment.leadsPerCity} leads/city)\n`;
            });
            logsCallback(logs);
            // 3. Process each SDK's assigned cities
            const failedCities = [];
            for (const [sdkName, assignment] of Object.entries(cityAssignments)) {
                if (allLeads.length >= targetLimit)
                    break;
                const sdk = sdks[sdkName];
                if (!sdk || typeof sdk.searchBusinesses !== "function") {
                    logs += `❌ ${sdkName} missing or invalid - cities will be redistributed\n`;
                    failedCities.push(...assignment.cities);
                    continue;
                }
                logs += `\n🔍 ${sdkName}: Processing ${assignment.cities.length} cities...\n`;
                logsCallback(logs);
                // Process cities for this SDK with rate limiting
                const sdkResults = await this.processCitiesForSDK(sdk, sdkName, keyword, assignment.cities, assignment.leadsPerCity, seenCompanies, progressCallback, (newLogs) => {
                    logs += newLogs;
                    logsCallback(logs);
                });
                allLeads.push(...sdkResults.leads);
                failedCities.push(...sdkResults.failedCities);
                // Update SDK usage
                if (sdkResults.totalUsed > 0) {
                    await this.updateDBSDKFreeTier({
                        sdkName,
                        usedCount: sdkResults.totalUsed,
                        increment: true
                    });
                }
            }
            // 4. Redistribute failed cities to other SDKs if needed
            if (failedCities.length > 0 && allLeads.length < targetLimit && retryCount < __1.MAX_RETRIES) {
                logs += `\n🔄 Redistributing ${failedCities.length} failed cities...\n`;
                logsCallback(logs);
                const redistributionResults = await this.redistributeFailedCities(failedCities, keyword, availableSDKs, sdks, sdkLimits, Math.min(remainingNeeded, Math.ceil(remainingNeeded / failedCities.length)), seenCompanies, progressCallback, (newLogs) => {
                    logs += newLogs;
                    logsCallback(logs);
                });
                allLeads.push(...redistributionResults);
            }
            // 5. Break if no new leads found
            const newLeadsThisRound = allLeads.length - existingLeads.length - (retryCount === 1 ? 0 : allLeads.length);
            if (newLeadsThisRound === 0) {
                logs += `⚠️ No new leads found in attempt ${retryCount}, stopping early\n`;
                break;
            }
            // Rate limiting between retries
            if (retryCount < __1.MAX_RETRIES && allLeads.length < targetLimit) {
                await new Promise(res => setTimeout(res, 3000));
            }
        }
        logs += `\n🎯 Final Results: ${allLeads.length}/${targetLimit} leads (${retryCount} attempts)\n`;
        logsCallback(logs);
        return allLeads.slice(0, targetLimit);
    };
    /**
     * Create optimal city-SDK assignments to avoid overlap and maximize efficiency
     */
    createCitySDKAssignments(cities, availableSDKs, sdkLimits, targetLeads) {
        const assignments = {};
        // Calculate base cities per SDK
        const baseCitiesPerSDK = Math.floor(cities.length / availableSDKs.length);
        const extraCities = cities.length % availableSDKs.length;
        // Calculate leads per city based on target
        const baseLeadsPerCity = Math.ceil(targetLeads / cities.length);
        let cityIndex = 0;
        availableSDKs.forEach((sdk, sdkIndex) => {
            const citiesForThisSDK = baseCitiesPerSDK + (sdkIndex < extraCities ? 1 : 0);
            const assignedCities = cities.slice(cityIndex, cityIndex + citiesForThisSDK);
            // Adjust leads per city based on SDK limits
            const maxAvailable = sdkLimits[sdk]?.available || baseLeadsPerCity;
            const leadsPerCity = Math.min(baseLeadsPerCity, Math.floor(maxAvailable / citiesForThisSDK));
            assignments[sdk] = {
                cities: assignedCities,
                leadsPerCity: Math.max(1, leadsPerCity) // Minimum 1 lead per city
            };
            cityIndex += citiesForThisSDK;
        });
        return assignments;
    }
    /**
     * Process cities for a specific SDK with proper rate limiting
     */
    async processCitiesForSDK(sdk, sdkName, keyword, cities, leadsPerCity, seenCompanies, progressCallback, logsCallback) {
        const results = [];
        const failedCities = [];
        let totalUsed = 0;
        // Rate limiting config per SDK
        const rateLimits = {
            hunterSDK: 2000, // 2 seconds between requests
            foursquareSDK: 500, // 0.5 seconds
            googleCustomSearchSDK: 1000, // 1 second
            tomtomSDK: 400, // 0.4 seconds
        };
        const delay = rateLimits[sdkName] || 1000;
        for (let i = 0; i < cities.length; i++) {
            const city = cities[i];
            try {
                logsCallback(`   🏙️ ${sdkName}: Scraping "${keyword}" in ${city} (${i + 1}/${cities.length})\n`);
                const leads = await sdk.searchBusinesses(keyword, city, leadsPerCity);
                if (typeof leads === "string") {
                    logsCallback(`   ❌ ${city}: ${leads}\n`);
                    failedCities.push(city);
                    continue;
                }
                // Filter new leads
                const newLeads = leads.filter((lead) => {
                    const key = `${lead.company}-${lead.address}`.toLowerCase().trim();
                    if (seenCompanies.has(key))
                        return false;
                    seenCompanies.add(key);
                    return true;
                });
                // Enhance leads with missing email/phone
                for (const lead of newLeads) {
                    if (!lead.email && lead.website) {
                        const contacts = await (0, scrapeContactsFromWebsite_1.scrapeContactsFromWebsite)(lead.website);
                        lead.email = contacts.email;
                    }
                }
                results.push(...newLeads);
                totalUsed += leads.length;
                progressCallback(results.length);
                logsCallback(`   ✅ ${city}: ${newLeads.length} new leads\n`);
                // Rate limiting between cities
                if (i < cities.length - 1) {
                    await new Promise(res => setTimeout(res, delay));
                }
            }
            catch (error) {
                logsCallback(`   ❌ ${city}: ${error.message}\n`);
                failedCities.push(city);
                // Longer delay on error to avoid further rate limiting
                if (i < cities.length - 1) {
                    await new Promise(res => setTimeout(res, delay * 2));
                }
            }
        }
        return { leads: results, failedCities, totalUsed };
    }
    /**
     * Redistribute failed cities to other available SDKs
     */
    async redistributeFailedCities(failedCities, keyword, availableSDKs, sdks, sdkLimits, leadsPerCity, seenCompanies, progressCallback, logsCallback) {
        const redistributedLeads = [];
        // Distribute failed cities among available SDKs
        const citiesPerSDK = Math.ceil(failedCities.length / availableSDKs.length);
        for (let i = 0; i < availableSDKs.length && failedCities.length > 0; i++) {
            const sdkName = availableSDKs[i];
            const sdk = sdks[sdkName];
            if (!sdk || typeof sdk.searchBusinesses !== "function")
                continue;
            const citiesToProcess = failedCities.splice(0, citiesPerSDK);
            const maxAvailable = sdkLimits[sdkName]?.available || leadsPerCity;
            const adjustedLeadsPerCity = Math.min(leadsPerCity, Math.floor(maxAvailable / citiesToProcess.length));
            if (adjustedLeadsPerCity <= 0)
                continue;
            logsCallback(`🔄 ${sdkName}: Taking ${citiesToProcess.length} failed cities\n`);
            const redistributionResults = await this.processCitiesForSDK(sdk, sdkName, keyword, citiesToProcess, adjustedLeadsPerCity, seenCompanies, progressCallback, logsCallback);
            redistributedLeads.push(...redistributionResults.leads);
            // Update SDK usage
            if (redistributionResults.totalUsed > 0) {
                await this.updateDBSDKFreeTier({
                    sdkName,
                    usedCount: redistributionResults.totalUsed,
                    increment: true
                });
            }
        }
        return redistributedLeads;
    }
    // LOGIC TO SCRAPE ----------------------
    /**
     * Updates SDK free tier usage with comprehensive error handling
     */
    updateDBSDKFreeTier = async ({ sdkName, usedCount, increment = false }) => {
        try {
            if (!sdkName || usedCount < 0)
                throw `❌ Invalid input for SDK update: ${sdkName}`;
            // 1. If increment mode, fetch existing count
            let newCount = usedCount;
            if (increment) {
                const { data, error: fetchError } = await this.supabaseAdmin
                    .from("sdk_freetier")
                    .select("used_count")
                    .eq("sdk_name", sdkName)
                    .single();
                if (fetchError)
                    throw `❌ Fetch error: ${fetchError.message}`;
                if (!data)
                    throw `❌ SDK not found: ${sdkName}`;
                newCount = data.used_count + usedCount;
            }
            // 2. Update used_count
            const { error } = await this.supabaseAdmin
                .from("sdk_freetier")
                .update({ used_count: newCount })
                .eq("sdk_name", sdkName);
            if (error)
                throw `❌ Update error: ${error.message}`;
            // 3. Success log
            console.log(`✓ SDK usage updated [${sdkName}]: used_count = ${newCount}`);
        }
        catch (error) {
            console.error(`🔥 Critical: Failed SDK free tier update for ${sdkName}:`, error);
            throw error;
        }
    };
    invokeChildLambda = async (payload) => {
        try {
            const command = new client_lambda_1.InvokeCommand({
                FunctionName: this.AWS_LAMBDA_FUNCTION_NAME,
                InvocationType: "Event",
                Payload: JSON.stringify(payload)
            });
            const result = await this.lambda.send(command);
            if (result.StatusCode !== 202) {
                console.error(`🚀 Child Lambda invocation failed for cities ${payload.cities?.join(', ')}: StatusCode ${result.StatusCode}`);
                return { success: false, cities: payload.cities || [], error: `Lambda invocation failed with status ${result.StatusCode}` };
            }
            console.log(`✅ Triggered child Lambda for cities: ${payload.cities?.join(', ')}`);
            return { success: true, cities: payload.cities || [] };
        }
        catch (error) {
            console.error(`❌ Failed to invoke child Lambda for cities ${payload.cities?.join(', ')}:`, error);
            return { success: false, cities: payload.cities || [], error: error.message };
        }
    };
}
exports.Scraper = Scraper;
