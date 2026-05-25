import { wearEngine } from '@kit.WearEngine';

class MessageBox {
    content: string = '';
}

export function wearengine_p2p_unresolved_send_message_005_T(userInput: string, client: wearEngine.P2pClient): void {
    const message = new MessageBox();
    message.content = userInput;

    client.sendMessage('device', {}, message);
}
