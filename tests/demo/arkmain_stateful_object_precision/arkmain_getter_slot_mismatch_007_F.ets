import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import geoLocationManager from "@ohos.geoLocationManager";

class UserModel {
    private info: string = "";
    private other: string = "";

    setInfo(next: string): void {
        this.info = next;
    }

    getOther(): string {
        return this.other;
    }
}

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        const user = new UserModel();
        const payload = JSON.stringify(geoLocationManager.getLastLocation());
        user.setInfo(payload);
        hilog.info(0x0000, "testTag", "%{public}s", user.getOther());
    }
}
