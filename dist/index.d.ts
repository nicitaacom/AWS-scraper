import { JobPayload } from "./interfaces/interfaces";
export declare const BUCKET: string;
export declare const MAX_RUNTIME_MS: number;
export declare const MAX_RETRIES = 3;
export declare const handler: (event: JobPayload) => Promise<{
    statusCode: number;
    body: string;
}>;
//# sourceMappingURL=index.d.ts.map