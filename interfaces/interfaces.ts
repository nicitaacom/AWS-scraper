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



export interface ScrapingError {
  type: 'NOT_FOUND' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'UNKNOWN'
  message: string
  city: string
  sdkName: string
  statusCode?: number
  retryable: boolean
}

/** City processing result with detailed error info */
export interface CityResult {
  city: string
  leads: Lead[]
  error?: ScrapingError
  usedQuota: number // Track actual API calls made
}

/** SDK processing summary */
export interface SDKProcessingSummary {
  leads: Lead[]
  failedCities: string[]
  retriableCities: string[]
  permanentFailures: string[]
  totalUsed: number
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

/** SDK free tier usage update */
export type SDKUsageUpdate = {
  sdkName: string
  usedCount: number
  increment?: boolean
}


export type DBUpdate = {
  status: "pending" | "error" | "completed" // adjust if needed
} & Partial<{
  downloadable_link: string
  completed_in_s: number
  leads_count: number
  message: string
}>



// pusher + DB related interfaces

export type JobCompletion = {
  id: string
  downloadable_link: string
  completed_in_s: number
  leads_count: number
  message: string
  // decided to update status on frontend in order to keep code consicer
  job_number?: number
  chain_completed?: boolean
}

export type JobUpdate = {
  id:string
  // don't put completed_in_s because this is only for time of all sequences
// decided to update status on frontend in order to keep code consicer
  leads_count?: number
  message: string // required because user need to know what's up
}


export type JobError = {
  id: string
  message: string
  // decided to update status on frontend in order to keep code consicer
  job_number?: number
}

export type PusherEventMap = {
  'scraper:error': JobError
  'scraper:update': JobUpdate
  'scraper:completed': JobCompletion
}

/**
 * Also I have scraper class that initialized as new Scraper()
 * 
 * 
  /**
 * Validates input payload with detailed error messages
 * public validateInput = (payload: JobPayload): { valid: boolean; error?: string } => {
*
* 
 * public async generateCitiesFromRegion(location: string, isReverse: boolean): Promise<string[] | string> {
 * public checkAndMergeResults = async (parentId: string, channelId: string,s3BucketName:string): Promise<void> => {
 * public updateDBScraper = async (id: string,data: Partial<{ downloadable_link: string; completed_in_s: number; 
 *        status: string; leads_count: number; message: string }>): Promise<void> => {
  public async scrapeLeads(keyword: string,cities: string[],targetLimit: number,existingLeads: Lead[],progressCallback: (count: number) => void,
  logsCallback: (logs: string) => void,sdks: Record<string, any>): Promise<Lead[]>
 * 

 * Assigns cities to SDKs based on availability and prior attempts
  private createCitySDKAssignments(cities: string[],availableSDKs: string[],sdkLimits: Record<string, { available: number }>,targetLeads: number,
  triedSDKs: Map<string, Set<string>>): Record<string, { cities: string[]; leadsPerCity: number }> {
 *private async processCitiesForSDK(sdk: any,sdkName: string,keyword: string,cities: string[],leadsPerCity: number,
  seenCompanies: Set<string>,progressCallback: (count: number) => void,logsCallback: (logs: string) => void,
  triedSDKs: Map<string, Set<string>>): Promise<SDKProcessingSummary> {

  public mergeAndDeduplicateLeads = (existingLeads: Lead[], newLeads: Lead[]): Lead[] => {

  private removeDuplicateLeads(leads: Lead[], fields: (keyof Lead)[] = ['email', 'phone']): Lead[] {

  public calculateEstimatedCompletion = (startTime: number, currentCount: number, targetCount: number): number => {

  private async redistributeFailedCities(failedCities: string[],keyword: string,availableSDKs: string[],sdks: Record<string, any>,
  sdkLimits: Record<string, any>,leadsPerCity: number,seenCompanies: Set<string>,progressCallback: (count: number) => void,
  logsCallback: (logs: string) => void,triedSDKs: Map<string, Set<string>>,permanentFailures: Set<string>): Promise<Lead[]> {
  
  
  private categorizeError(error: any, city: string, sdkName: string): ScrapingError {

  public generateCSV = (leads: Lead[]): string => {

  public updateDBSDKFreeTier = async ({

  public updateDBSDKFreeTier = async ({sdkName,usedCount,increment = false}: SDKUsageUpdate): Promise<void> => {

  public invokeChildLambda = async (payload: JobPayload): Promise<{ success: boolean; cities: string[]; error?: string }> => {
 */