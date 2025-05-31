export const checkSDKAvailability = async (supabase: any): Promise<{ 
  available: string[], 
  unavailable: string[], 
  status: string,
  sdkLimits: Record<string, { available: number, total: number }> 
}> => {
  const { data: usageData, error } = await supabase.from('sdk_freetier').select('sdk_name, limit_value, used_count, period_start, period_duration, limit_type')
  if (error) return { available: [], unavailable: [], status: `❌ Database error: ${error.message}`, sdkLimits: {} }

  const available: string[] = []
  const unavailable: string[] = []
  const sdkLimits: Record<string, { available: number, total: number }> = {}
  const now = new Date()

  usageData?.forEach((sdk: any) => {
    const { sdk_name, limit_value, used_count, period_start, period_duration, limit_type } = sdk
    let currentUsage = used_count
    
    if (period_duration && period_start) {
      const periodStartDate = new Date(period_start)
      const periodEndDate = new Date(periodStartDate.getTime())
      if (limit_type === 'daily') periodEndDate.setDate(periodEndDate.getDate() + 1)
      else if (limit_type === 'monthly') periodEndDate.setMonth(periodEndDate.getMonth() + 1)
      if (now >= periodEndDate) currentUsage = 0
    }
    
    const availableCount = Math.max(0, limit_value - currentUsage)
    const isAvailable = availableCount > 0
    
    sdkLimits[sdk_name] = { available: availableCount, total: limit_value }
    
    const statusText = isAvailable ? sdk_name : `${sdk_name} (${currentUsage}/${limit_value})`
    ;(isAvailable ? available : unavailable).push(statusText)
  })

  const status = available.length === 0 
  ? `❌ All SDKs exhausted: ${unavailable.join(', ')}`
  : `SDK Status:\n✅ Available: ${available.join(', ')}${unavailable.length ? `\n❌ Unavailable: ${unavailable.join(', ')}` : ''}`
  
  return { available, unavailable, status, sdkLimits }
}