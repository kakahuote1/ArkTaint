import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";
import { CrossFileUserModel } from "./crossfile_user_model";

export default class ArkMainCrossFileAccessor006 extends UIAbility {
    private user: CrossFileUserModel = new CrossFileUserModel();

    onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
        this.user.setInfo(want.parameters);
    }

    onForeground(): void {
        hilog.info(0x0000, "testTag", "%{public}s", this.user.getOther());
    }
}

export function arkmain_crossfile_accessor_006_F(): void {
    void ArkMainCrossFileAccessor006;
}
