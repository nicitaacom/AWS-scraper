export declare const checkSDKAvailability: (supabase: any) => Promise<{
    available: string[];
    unavailable: string[];
    status: string;
    sdkLimits: Record<string, {
        available: number;
        total: number;
    }>;
}>;
//# sourceMappingURL=checkSDKAvailability.d.ts.map