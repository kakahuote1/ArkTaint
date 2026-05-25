import { P2pClient, P2pMessage, taint } from "./taint_mock";

export function wearengine_p2p_message_receiver_001_T(): void {
    const client = new P2pClient();
    client.registerMessageReceiver("device", {}, (msg: P2pMessage): void => {
        const content = msg.content;
        taint.Sink(content);
    });
}
