import OpenAI from "openai";
import Pusher from "pusher";
import { SupabaseClient } from "@supabase/supabase-js";
import { DBUpdate, JobPayload, Lead, SDKUsageUpdate } from "../interfaces/interfaces";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
interface SDKs {
    foursquareSDK: string;
    googleCustomSearchSDK: string;
    hunterSDK: string;
    rapidSDK: string;
    searchSDK: string;
    serpSDK: string;
    tomtomSDK: string;
    [index: string]: string;
}
interface SDKPersonality {
    emoji: string;
    name: string;
    greeting: (cities: string[]) => string;
    cityList: (cities: string[]) => string;
    success: (count: number) => string;
    handoff: (cities: string[]) => string;
    failure: string;
    acceptance?: string;
}
export declare class Scraper {
    private openai;
    private s3;
    private pusher;
    protected supabaseAdmin: SupabaseClient<any, "public", any>;
    protected lambda: LambdaClient;
    protected AWS_LAMBDA_FUNCTION_NAME: string;
    protected SDK_EMOJIS: SDKs;
    private readonly SDK_PERSONALITIES;
    constructor(openai: OpenAI, s3: S3Client, pusher: Pusher, supabaseAdmin: SupabaseClient<any, "public", any>, lambda: LambdaClient, AWS_LAMBDA_FUNCTION_NAME?: string, SDK_EMOJIS?: SDKs, SDK_PERSONALITIES?: Record<string, SDKPersonality>);
    /**
   * Validates input payload with detailed error messages
   */
    validateInput: (payload: JobPayload) => {
        valid: boolean;
        error?: string;
    };
    generateCitiesFromRegion(location: string, isReverse: boolean): Promise<string[] | string>;
    /**
   * Checks completion and merges results with robust error handling
   */
    checkAndMergeResults: (parentId: string, channelId: string, s3BucketName: string) => Promise<void>;
    /**
     * Updates database record with comprehensive error handling
     */
    updateDBScraper: (id: string, data: DBUpdate) => Promise<void>;
    /** Scrapes leads with retry and SDK redistribution logic */
    scrapeLeads(keyword: string, cities: string[], targetLimit: number, existingLeads: Lead[], progressCallback: (count: number) => void, logsCallback: (logs: string) => void, sdks: Record<string, any>): Promise<Lead[]>;
    /** Assigns cities to SDKs based on availability and prior attempts */
    private createCitySDKAssignments;
    /** Processes cities for an SDK with rate limiting */
    private processCitiesForSDK;
    /**
     * Merges two lead arrays and removes duplicates
     * @param existingLeads Current leads
     * @param newLeads Newly scraped leads
     * @returns Combined unique leads array
     */
    mergeAndDeduplicateLeads: (existingLeads: Lead[], newLeads: Lead[]) => Lead[];
    /**
       * Removes duplicate leads based on specified fields
       * @param leads Array of leads to deduplicate
       * @param fields Fields to use for deduplication (defaults to email and phone)
       * @returns Array of unique leads
       */
    private removeDuplicateLeads;
    /**
     * Calculates estimated completion time based on current progress
     * @param startTime Start timestamp
     * @param currentCount Current leads count
     * @param targetCount Target leads count
     * @returns Estimated completion time in seconds
     */
    calculateEstimatedCompletion: (startTime: number, currentCount: number, targetCount: number) => number;
    /** Redistributes failed cities to other SDKs */
    /** Enhanced redistribution with failure tracking and smart SDK selection */
    private redistributeFailedCities;
    private categorizeError;
    /**
     * Generates CSV content from leads array
     * @param leads Array of lead objects
     * @returns CSV string with proper escaping
     */
    generateCSV: (leads: Lead[]) => string;
    /**
     * Updates SDK free tier usage with comprehensive error handling
     */
    updateDBSDKFreeTier: ({ sdkName, usedCount, increment }: SDKUsageUpdate) => Promise<void>;
    invokeChildLambda: (payload: JobPayload) => Promise<{
        success: boolean;
        cities: string[];
        error?: string;
    }>;
    private withTimeout;
}
export {};
//# sourceMappingURL=scraper.d.ts.map