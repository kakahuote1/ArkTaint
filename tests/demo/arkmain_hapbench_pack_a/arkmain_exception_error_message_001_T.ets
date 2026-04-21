import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import geoLocationManager from "@ohos.geoLocationManager";

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        try {
            const info = JSON.stringify(geoLocationManager.getLastLocation());
            throw new Error(info);
        } catch (err) {
            hilog.info(0x0000, "testTag", "%{public}s", err.message);
        }
    }
}
