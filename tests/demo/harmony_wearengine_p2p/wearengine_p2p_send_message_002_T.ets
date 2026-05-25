import { P2pClient, P2pMessage } from "./taint_mock";

export function wearengine_p2p_send_message_002_T(userInput: string): void {
    const client = new P2pClient();
    const message: P2pMessage = {
        content: userInput
    };
    client.sendMessage("device", {}, message);
}
