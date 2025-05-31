import Pusher from "pusher";
import type { PusherEventMap } from "../interfaces/interfaces";
export declare class TypedPusher extends Pusher {
    constructor(options: Pusher.Options);
    trigger<EventName extends keyof PusherEventMap>(channel: string, event: EventName, data: PusherEventMap[EventName]): Promise<Pusher.Response>;
}
export declare const pusherInstance: TypedPusher;
//# sourceMappingURL=pusher.d.ts.map