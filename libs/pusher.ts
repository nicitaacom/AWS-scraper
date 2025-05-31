import Pusher from "pusher"
import type { PusherEventMap } from "../interfaces/interfaces"

export class TypedPusher extends Pusher {
  constructor(options: Pusher.Options) {
    super(options)
  }

  async trigger<EventName extends keyof PusherEventMap>(
    channel: string,
    event: EventName,
    data: PusherEventMap[EventName]
  ): Promise<Pusher.Response> {
    return super.trigger(channel, event, data)
  }
}

// Create and export a singleton instance with your configuration
export const pusherInstance = new TypedPusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true
})
