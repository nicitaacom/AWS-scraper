/**
 * Formats a number of seconds into a human-readable string like `1h 05m 30s` or `45s`.
 * @param seconds - The number of seconds to format
 * @returns A formatted duration string
 * @example
 * formatDuration(75) // "1m 15s"
 * formatDuration(3665) // "1h 01m 05s"
 */
export declare const formatDuration: (seconds: number) => string;
/**
 * Returns the current date in `dd.mm` format.
 * @returns A string representing today's date (e.g., "30.05")
 * @example
 * getCurrentDate() // "30.05"
 */
export declare const getCurrentDate: () => string;
//# sourceMappingURL=date-utils.d.ts.map