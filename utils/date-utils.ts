/**
 * Formats a number of seconds into a human-readable string like `1h 05m 30s` or `45s`.
 * @param seconds - The number of seconds to format
 * @returns A formatted duration string
 * @example
 * formatDuration(75) // "1m 15s"
 * formatDuration(3665) // "1h 01m 05s"
 */
export const formatDuration = (seconds: number): string => {
  if (seconds < 0) return "0s"
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, "0")}m ${remainingSeconds.toString().padStart(2, "0")}s`
    : `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`
}

/**
 * Returns the current date in `dd.mm` format.
 * @returns A string representing today's date (e.g., "30.05")
 * @example
 * getCurrentDate() // "30.05"
 */
export const getCurrentDate = (): string => {
  const now = new Date()
  return `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}`
}
