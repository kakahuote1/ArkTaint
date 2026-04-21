import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import { CrossFileUserModel } from "./crossfile_user_model";

export default class ArkMainCrossFileAccessor005 extends UIAbility {
    private user: CrossFileUserModel = new CrossFileUserModel();

    onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
        this.user.setInfo(want.parameters);
    }

    onForeground(): void {
        hilog.info(0x0000, "testTag", "%{public}s", this.user.getInfo());
    }
}

export function arkmain_crossfile_accessor_005_T(): void {
    void ArkMainCrossFileAccessor005;
}
