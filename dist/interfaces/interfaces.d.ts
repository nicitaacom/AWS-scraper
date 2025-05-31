/** Lead data structure - in order to match types with frontend - don't add any additional properties*/
export type Lead = {
    company: string;
    address: string;
    phone: string;
    email: string;
    website: string;
};
/** Job input payload for sequential auto-chaining jobs */
export type JobPayload = {
    keyword: string;
    location: string;
    limit: number;
    channelId: string;
    id: string;
    cities?: string[];
    retryCount?: number;
    isReverse: boolean;
    jobNumber?: number;
    originalJobId?: string;
};
export interface ScrapingError {
    type: 'NOT_FOUND' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'UNKNOWN';
    message: string;
    city: string;
    sdkName: string;
    statusCode?: number;
    retryable: boolean;
}
/** City processing result with detailed error info */
export interface CityResult {
    city: string;
    leads: Lead[];
    error?: ScrapingError;
    usedQuota: number;
}
/** SDK processing summary */
export interface SDKProcessingSummary {
    leads: Lead[];
    failedCities: string[];
    retriableCities: string[];
    permanentFailures: string[];
    totalUsed: number;
}
/** SDK availability check result */
export type SDKAvailability = {
    available: string[];
    unavailable: string[];
    status: string;
    sdkLimits: Record<string, number>;
};
/** Progress update data for real-time updates */
export type ProgressUpdate = {
    id: string;
    leads_count: number;
    message: string;
    elapsed_time?: number;
};
/** SDK free tier usage update */
export type SDKUsageUpdate = {
    sdkName: string;
    usedCount: number;
    increment?: boolean;
};
export type DBUpdate = {
    status: "pending" | "error" | "completed";
} & Partial<{
    downloadable_link: string;
    completed_in_s: number;
    leads_count: number;
    message: string;
}>;
export type JobCompletion = {
    id: string;
    downloadable_link: string;
    completed_in_s: number;
    leads_count: number;
    message: string;
    job_number?: number;
    chain_completed?: boolean;
};
export type JobUpdate = {
    id: string;
    leads_count?: number;
    message: string;
};
export type JobError = {
    id: string;
    message: string;
    job_number?: number;
};
export type PusherEventMap = {
    'scraper:error': JobError;
    'scraper:update': JobUpdate;
    'scraper:completed': JobCompletion;
};
/**
 * Also I have scraper class that initialized as new Scraper()
 * public validateInput = (payload: any): { valid: boolean; error?: string } => {
 * public async generateCitiesFromRegion(location: string, isReverse: boolean): Promise<string[] | string> {
 * public checkAndMergeResults = async (parentId: string, channelId: string,s3BucketName:string): Promise<void> => {
 * public updateDBScraper = async (id: string,data: Partial<{ downloadable_link: string; completed_in_s: number;
 * status: string; leads_count: number; message: string }>): Promise<void> => {
 * public updateDBSDKFreeTier = async ({
      sdkName,
      usedCount,
      increment = false
    }:  {
      sdkName: string // 🧠 Required SDK name
      usedCount: number // 🔢 New used count to set
      increment?: boolean // ➕ If true, will increment instead of replacing
    }): Promise<void> => {
 * public invokeChildLambda = async (payload: JobPayload): Promise<{ success: boolean; cities: string[]; error?: string }> => {
 */ 
//# sourceMappingURL=interfaces.d.ts.map