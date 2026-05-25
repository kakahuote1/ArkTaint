import { wearEngine } from '@kit.WearEngine';
import { taint } from './taint_mock';

export function wearengine_p2p_unresolved_receiver_004_T(client: wearEngine.P2pClient): void {
    const callback: (msg: wearEngine.P2pMessage) => void = (msg: wearEngine.P2pMessage): void => {
        taint.Sink(msg.content);
    };

    client.registerMessageReceiver('device', {}, callback);
}
