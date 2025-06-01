import { SDKAvailabilityResult, SDKLimit } from "interfaces/interfaces"

export const checkSDKAvailability = async (supabase: any): Promise<SDKAvailabilityResult> => {
  const { data: usageData, error } = await supabase
    .from('sdk_freetier')
    .select('sdk_name, limit_value, used_count, period_start, period_duration, limit_type')

  if (error) {  
    return {
      availableSDKNames: [],
      exhaustedSDKNames: [],
      status: `❌ Database error: ${error.message}`,
      sdkCredits: {}
    }
  }

  const availableSDKNames: string[] = []
  const exhaustedSDKNames: string[] = []
  const sdkCredits: Record<string, SDKLimit> = {}
  const now = new Date()

  usageData?.forEach((sdk: any) => {
    const currentUsage = calculateCurrentUsage(sdk, now)
    const availableCredits = Math.max(0, sdk.limit_value - currentUsage)
    const hasCredits = availableCredits > 0

    sdkCredits[sdk.sdk_name] = {
      availableCredits,
      totalCredits: sdk.limit_value,
      usedCredits: currentUsage,
      limitType: sdk.limit_type
    }

    if (hasCredits) {
      availableSDKNames.push(sdk.sdk_name)
    } else {
      exhaustedSDKNames.push(`${sdk.sdk_name} (${currentUsage}/${sdk.limit_value})`)
    }
  })

  const status = availableSDKNames.length === 0
    ? `❌ All SDKs exhausted: ${exhaustedSDKNames.join(', ')}`
    : `✅ Available SDKs: ${availableSDKNames.join(', ')}${exhaustedSDKNames.length ? `\n❌ Exhausted: ${exhaustedSDKNames.join(', ')}` : ''}`

  return { availableSDKNames, exhaustedSDKNames, status, sdkCredits }
}

const calculateCurrentUsage = (sdk: any, now: Date): number => {
  const { used_count, period_start, period_duration, limit_type } = sdk

  if (!period_duration || !period_start || limit_type === 'fixed') {
    return used_count
  }

  const periodStart = new Date(period_start)
  const periodEnd = new Date(periodStart)

  if (limit_type === 'daily') {
    periodEnd.setDate(periodEnd.getDate() + 1)
  } else if (limit_type === 'monthly') {
    periodEnd.setMonth(periodEnd.getMonth() + 1)
  }

  return now >= periodEnd ? 0 : used_count
}