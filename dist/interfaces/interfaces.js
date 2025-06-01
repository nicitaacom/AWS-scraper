"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Also I have scraper class that initialized as new Scraper()
 *
 *
 interface SDKs {
   foursquareSDK: string
   googleCustomSearchSDK: string
   hunterSDK: string
   rapidSDK:string
   searchSDK: string
   serpSDK: string
   tomtomSDK: string
   [index: string]: string
 }
 
 interface SDKPersonality {
   emoji: string
   name: string
   greeting: (cities: string[]) => string
   cityList: (cities: string[]) => string
   success: (count: number) => string
   handoff: (cities: string[]) => string
   failure: string
   acceptance?: string // Make acceptance optional
 }
 
 // Update your constructor with the fixed SDK_PERSONALITIES
 export class Scraper {
   constructor(
     private openai: OpenAI,
     private s3: S3Client,
     private pusher: Pusher,
     protected supabaseAdmin: SupabaseClient<any, "public", any>,
     protected lambda: LambdaClient,
     protected AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || "lead-scraper",
     protected SDK_EMOJIS: SDKs = {
       foursquareSDK: '📍',
       googleCustomSearchSDK: '🌐',
       hunterSDK: '🕵️',
       rapidSDK: '⚡',
       searchSDK: '🔎',
       serpSDK: '📊',
       tomtomSDK: '🗺️',
     },
     private readonly SDK_PERSONALITIES: Record<string, SDKPersonality> = {
       hunterSDK: {
         emoji: '🕵️',
         name: 'hunterSDK',
         greeting: (cities: string[]) => `🕵️ hunterSDK: I'm on it! gonna blast through ${cities.length} cities:`,
         cityList: (cities: string[]) => `   [${cities.slice(0, 4).join(', ')}${cities.length > 4 ? `, …]` : ']'}`,
         success: (count: number) => `   I found ${count} leads 🔥`,
         handoff: (cities: string[]) => `hey **googleCustomSearchSDK**, could you take on my cities? - I'm kinda getting 429s 😮`,
         failure: `   getting some timeouts here 😤`,
         acceptance: `sure thing! I'll handle these cities for ya 🕵️`
       },
       foursquareSDK: {
         emoji: '🏢',
         // etc
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
 * private async searchBusinessesUsingSDK(sdk: BusinessSDK, sdkName: string, keyword: string, cities: string[], leadsPerCity: number,
   seenCompanies: Set<string>, progressCallback: (count: number) => void, logsCallback: (logs: string) => void, triedSDKs: Map<string, Set<string>>
): Promise<SDKProcessingSummary> {
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
