/** Lead data structure - in order to match types with frontent - don't add any additional properties*/
export type Lead = {
  company: string
  address: string
  phone: string
  email: string
  website: string
}

/** Regional chunk for parallel processing */
export type RegionChunk = {
  region: string
  location: string
  description: string
}

/** Job input payload */
export type JobPayload = {
  keyword: string // to find leads withing specific niche e.g restaurants, dentists, lawyers
  location: string // to find leads withing specific location and then split location using openAI to optimize performace
  limit: number // to check if CSV length less then limit
  channelId: string // for pusher channelId
  id: string
  parentId?: string
  region?: string
  retryCount?: number // to handle cases "roofers" in "Hamburg" "500000" - so it's 1M people in Hamburg and not 500000 roofers
  isReverse:boolean
}

export interface Job {
  id: string;
  keyword: string;
  location: string;
  limit: number;
  channel_id: string;
  parent_id: string;
  region: string;
  status: string; // should be only "completed" | "pending" | "error"
  created_at: string;
  leads_count: number;
  message: string;
}


/**
 * Also I have scraper class that initialized as new Scraper()
 * public validateInput = (payload: any): { valid: boolean; error?: string } => {
 * public async generateRegionalChunks(location: string): Promise<RegionChunk[]> {
 * public checkAndMergeResults = async (parentId: string, channelId: string,BUCKET:string): Promise<void> => {
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
 * public invokeChildLambda = async (payload: JobPayload): Promise<{ success: boolean; region: string; error?: string }> => {
 */