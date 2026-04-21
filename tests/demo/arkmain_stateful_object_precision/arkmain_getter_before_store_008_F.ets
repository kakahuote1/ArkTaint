import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import geoLocationManager from "@ohos.geoLocationManager";

class UserModel {
    private info: string = "";

    setInfo(next: string): void {
        this.info = next;
    }

    getInfo(): string {
        return this.info;
    }
}

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        const user = new UserModel();
        hilog.info(0x0000, "testTag", "%{public}s", user.getInfo());
        const payload = JSON.stringify(geoLocationManager.getLastLocation());
        user.setInfo(payload);
    }
}
