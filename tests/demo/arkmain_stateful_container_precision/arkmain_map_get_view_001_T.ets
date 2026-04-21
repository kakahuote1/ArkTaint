import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import geoLocationManager from "@ohos.geoLocationManager";

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        const rows = new Map<string, string>();
        rows.set("hot", JSON.stringify(geoLocationManager.getLastLocation()));
        hilog.info(0x0000, "testTag", "%{public}s", rows.get("hot"));
    }
}
