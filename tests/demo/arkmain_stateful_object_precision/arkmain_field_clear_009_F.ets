import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import geoLocationManager from "@ohos.geoLocationManager";

class UserModel {
    info: string = "";
}

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        const payload = JSON.stringify(geoLocationManager.getLastLocation());
        const user = new UserModel();
        let localCopy = payload;
        user.info = payload;
        user.info = "";
        localCopy = "";
        hilog.info(0x0000, "testTag", "%{public}s", user.info);
        hilog.info(0x0000, "testTag", "%{public}s", localCopy);
    }
}
