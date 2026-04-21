// Case: AbilityStage performing app-global initialization
// Real apps use AbilityStage.onCreate to set up shared services
import { AbilityStage, AppStorage, taint } from "./taint_mock";

export default class SmartHomeAbilityStage extends AbilityStage {
    onCreate(): void {
        AppStorage.setOrCreate("appInitialized", true);
        const deviceToken = this.loadCachedToken();
        taint.Sink(deviceToken);
    }

    private loadCachedToken(): string {
        return "cached_device_token";
    }
}
