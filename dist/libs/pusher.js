"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pusherInstance = exports.TypedPusher = void 0;
const pusher_1 = __importDefault(require("pusher"));
class TypedPusher extends pusher_1.default {
    constructor(options) {
        super(options);
    }
    async trigger(channel, event, data) {
        return super.trigger(channel, event, data);
    }
}
exports.TypedPusher = TypedPusher;
// Create and export a singleton instance with your configuration
exports.pusherInstance = new TypedPusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});
