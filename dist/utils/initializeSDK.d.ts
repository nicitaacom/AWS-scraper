import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import OpenAI from "openai";
import { TypedPusher } from "../libs/pusher";
import { GoogleCustomSearchSDK } from "../SDK/GoogleCustomSearchSDK";
import { HunterSDK } from "../SDK/HunterSDK";
import { SearchSDK } from "../SDK/SearchSDK";
import { SerpSDK } from "../SDK/SerpSDK";
import { RapidSDK } from "../SDK/RapidSDK";
export declare function initializeClients(): string | {
    lambda: LambdaClient;
    s3: S3Client;
    supabase: import("@supabase/supabase-js").SupabaseClient<any, "public", any>;
    pusher: TypedPusher;
    openai: OpenAI;
    googleCustomSearchSDK: GoogleCustomSearchSDK;
    hunterSDK: HunterSDK;
    searchSDK: SearchSDK;
    serpSDK: SerpSDK;
    rapidSDK: RapidSDK;
};
//# sourceMappingURL=initializeSDK.d.ts.map