/** Lead data structure - in order to match types with frontend - don't add any additional properties*/
export type Lead = {
  company: string
  address: string
  phone: string
  email: string
  website: string
}

/** Job input payload for sequential auto-chaining jobs */
export type JobPayload = {
  keyword: string // to find leads within specific niche e.g restaurants, dentists, lawyers
  location: string // to find leads within specific location and then split location using openAI to optimize performance
  limit: number // to check if CSV length less then limit
  channelId: string // for pusher channelId
  id: string
  cities?: string[] // optional - if not provided, will be generated using OpenAI
  retryCount?: number // to handle cases where not enough leads found
  isReverse: boolean // for OpenAI city generation strategy - required
  jobNumber?: number // current job number in the chain (Job1, Job2, etc.)
  originalJobId?: string // ID of the first job in the chain (for tracking)
}

/** SDK availability check result */
export type SDKAvailability = {
  available: string[]
  unavailable: string[]
  status: string
  sdkLimits: Record<string, number>
}

/** Progress update data for real-time updates */
export type ProgressUpdate = {
  id: string
  leads_count: number
  message: string
  elapsed_time?: number
}

/** Job completion data */
export type JobCompletion = {
  id: string
  downloadable_link: string
  completed_in_s: number
  leads_count: number
  message: string
  status: "completed"
  job_number?: number
  chain_completed?: boolean
}

/** Job error data */
export type JobError = {
  id: string
  error: string
  job_number?: number
}

/** Database scraper update payload */
export type ScraperDBUpdate = Partial<{
  downloadable_link: string
  completed_in_s: number
  status: "pending" | "completed" | "error"
  leads_count: number
  message: string
}>

/** SDK free tier usage update */
export type SDKUsageUpdate = {
  sdkName: string
  usedCount: number
  increment?: boolean
}

/**
 * Also I have scraper class that initialized as new Scraper()
 * public validateInput = (payload: any): { valid: boolean; error?: string } => {
 * public async generateRegionalChunks(location: string, isReverse: boolean): Promise<string[] | string> {
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