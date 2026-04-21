// Case: ServiceExtensionAbility with onConnect/onDisconnect pattern
// Used in HarmonyOS for background services that other abilities bind to
import { ServiceExtensionAbility, Want, taint } from "./taint_mock";

export default class DeviceSyncService extends ServiceExtensionAbility {
    private connections: Map<number, string> = new Map();

    onCreate(want: Want): void {
        const serviceConfig = want.parameters?.["sync_config"];
        taint.Sink(serviceConfig);
    }

    onConnect(want: Want): any {
        const clientId = want.parameters?.["client_id"];
        this.connections.set(Date.now(), clientId);
        taint.Sink(clientId);
        return { syncData: "connected" };
    }

    onDisconnect(want: Want): void {
        const clientId = want.parameters?.["client_id"];
        taint.Sink(clientId);
    }

    onDestroy(): void {
        this.connections.clear();
    }
}
