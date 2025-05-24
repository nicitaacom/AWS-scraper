"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const pusher_1 = __importDefault(require("pusher"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const supabase_js_1 = require("@supabase/supabase-js");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const { GOOGLE_MAPS_API_KEY: mapsKey, PUSHER_APP_ID: appId, NEXT_PUBLIC_PUSHER_APP_KEY: pubKey, PUSHER_SECRET: secret, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, } = process.env;
if (!mapsKey || !appId || !pubKey || !secret || !serviceKey || !SUPABASE_URL)
    throw new Error("Missing required environment variables");
const pusher = new pusher_1.default({ appId, key: pubKey, secret, cluster: "eu", useTLS: true });
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
});
const s3 = new client_s3_1.S3Client({
    region: process.env.REGION,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
    },
});
const validateInput = (payload) => {
    if (!payload.keyword || !payload.location || !payload.channelId || !payload.id) {
        return { isValid: false, message: "keyword, location & channelId & id required" };
    }
    const limit = Number(payload.limit || 10);
    if (isNaN(limit))
        return { isValid: false, message: "Limit must be a number" };
    if (limit < 1 || limit > 500000) {
        return { isValid: false, message: "Limit must be between 1 and 500000" };
    }
    return { isValid: true };
};
const extractEmails = async (url) => {
    try {
        const res = await (0, node_fetch_1.default)(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 10000,
        });
        if (!res.ok)
            return [];
        const html = await res.text();
        return (html
            .match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)
            ?.filter((email, i, all) => all.indexOf(email) === i && !/example\.com|test\.com|placeholder/.test(email))
            .slice(0, 3) || []);
    }
    catch {
        return [];
    }
};
const fetchAllPlaces = async (keyword, location, limit) => {
    let allResults = [];
    let pageToken = undefined;
    while (allResults.length < limit) {
        const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
        url.searchParams.set("query", `${keyword} in ${location}`);
        url.searchParams.set("key", mapsKey);
        if (pageToken)
            url.searchParams.set("pagetoken", pageToken);
        const res = await (0, node_fetch_1.default)(url.toString());
        const data = await res.json();
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
            throw new Error(data.status);
        if (!Array.isArray(data.results))
            break;
        allResults.push(...data.results);
        if (!data.next_page_token || allResults.length >= limit)
            break;
        pageToken = data.next_page_token;
        await new Promise(r => setTimeout(r, 2000)); // required delay for token activation
    }
    return allResults.slice(0, limit);
};
const updateDBDownloadableLink = async (id, downloadable_link, completed_in_s) => {
    const { error: updateDBErr } = await supabase
        .from("scraper")
        .update({ downloadable_link, completed_in_s, status: 'completed' })
        .eq("id", id);
    if (updateDBErr) {
        console.error("Database update failed:", updateDBErr);
        throw new Error("Failed to save record");
    }
};
const handler = async (event) => {
    const start = Date.now(); // ← START TIMER
    const payload = typeof event.body === "string" ? JSON.parse(event.body) : event.body ?? event;
    const validation = validateInput(payload);
    if (!validation.isValid) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: validation.message }),
        };
    }
    const { keyword, location, channelId, id } = payload;
    const limit = Math.min(Number(payload.limit || 10), 500000);
    try {
        const places = await fetchAllPlaces(keyword, location, limit);
        const leads = (await Promise.all(places.map(async (p) => {
            const det = await (0, node_fetch_1.default)(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=name,formatted_address,formatted_phone_number,website&key=${mapsKey}`).then(r => r.json());
            if (det.status !== "OK")
                return null;
            const { name: company = "", formatted_address: address = "", formatted_phone_number: phone = "", website = "", } = det.result;
            const email = website ? (await extractEmails(website))[0] ?? "" : "";
            return company ? { company, address, phone, email, website } : null;
        }))).filter((l) => Boolean(l));
        const csv = ["Name,Address,Phone,Email,Website"]
            .concat(leads.map(l => [l.company, l.address, l.phone, l.email, l.website]
            .map(c => `"${c.replace(/"/g, '""')}"`)
            .join(",")))
            .join("\n");
        const fileName = `leads-${keyword.replace(/\W/g, "-")}-${location.replace(/\W/g, "-")}-${Date.now()}.csv`;
        await s3.send(new client_s3_1.PutObjectCommand({
            Bucket: "scraper-files-eu-central-1",
            Key: fileName,
            Body: csv,
            ContentType: "text/csv",
        }));
        const urlCommand = new client_s3_1.GetObjectCommand({
            Bucket: "scraper-files-eu-central-1",
            Key: fileName,
        });
        const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, urlCommand, { expiresIn: 86400 });
        // compute elapsed time
        const completed_in_s = Math.round((Date.now() - start) / 1000);
        await updateDBDownloadableLink(id, downloadUrl, completed_in_s);
        const record = {
            id,
            downloadable_link: downloadUrl,
            status: 'completed',
            completed_in_s,
        };
        // notify client
        await pusher.trigger(channelId, "scraper:completed", record);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Scraping complete", ...record }),
        };
    }
    catch (err) {
        const details = err instanceof Error ? err.message : String(err);
        if (typeof channelId === "string") {
            console.log(193, 'triggerring pusher and updating supabase to status "error"');
            await pusher.trigger(channelId, "scraper:error", {
                id: id,
                error: details,
                details: "lambda (scraper) - scraper:error",
            });
            await supabase
                .from("scraper")
                .update({ status: 'error' })
                .eq("id", id);
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Internal server error",
                details,
                timestamp: new Date().toISOString(),
            }),
        };
    }
};
exports.handler = handler;
