import OpenAI from "openai";
import Pusher from "pusher";
import { SupabaseClient } from "@supabase/supabase-js";
import { DBUpdate, JobPayload, Lead } from "../interfaces/interfaces";
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
export declare class Scraper {
    private openai;
    private s3;
    private pusher;
    protected supabaseAdmin: SupabaseClient<any, "public", any>;
    protected lambda: LambdaClient;
    protected AWS_LAMBDA_FUNCTION_NAME: string;
    protected SDK_EMOJIS: SDKs;
    constructor(openai: OpenAI, s3: S3Client, pusher: Pusher, supabaseAdmin: SupabaseClient<any, "public", any>, lambda: LambdaClient, AWS_LAMBDA_FUNCTION_NAME?: string, SDK_EMOJIS?: SDKs);
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
    /** Scrapes leads with optimized parallel SDK allocation */
    scrapeLeads(keyword: string, cities: string[], targetLimit: number, existingLeads: Lead[], progressCallback: (count: number) => void, logsCallback: (logs: string) => void, sdks: Record<string, any>): Promise<Lead[]>;
    /** Allocates cities evenly across available SDKs based on their credit limits */
    private allocateCitiesToSDKs;
    /** Processes multiple SDKs in parallel with timeout protection */
    private processSDKsInParallel;
    /** Processes a single SDK's allocated cities */
    private processSDKAllocation;
    /** Retries failed cities with remaining available SDKs */
    private retryFailedCities;
    private categorizeError;
    mergeAndDeduplicateLeads: (existingLeads: Lead[], newLeads: Lead[]) => Lead[];
    private removeDuplicateLeads;
    calculateEstimatedCompletion: (startTime: number, currentCount: number, targetCount: number) => number;
    generateCSV: (leads: Lead[]) => string;
    /**
     * Updates SDK free tier usage with comprehensive error handling
     */
    updateDBSDKFreeTier: ({ sdkName, usedCount, increment }: {
        sdkName: string;
        usedCount: number;
        increment?: boolean;
    }) => Promise<void>;
    invokeChildLambda: (payload: JobPayload) => Promise<{
        success: boolean;
        cities: string[];
        error?: string;
    }>;
}
export {};
//# sourceMappingURL=scraper.d.ts.map