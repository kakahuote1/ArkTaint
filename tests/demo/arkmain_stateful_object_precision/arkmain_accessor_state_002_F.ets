import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";

class User {
    private info: string = "";
    private other: string = "safe";

    setInfo(next: string): void {
        this.info = next;
    }

    getInfo(): string {
        return this.info;
    }

    getOther(): string {
        return this.other;
    }
}

export default class ArkMainAccessorState002 extends UIAbility {
    private user: User = new User();

    onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
        this.user.setInfo(want.parameters);
    }

    onForeground(): void {
        hilog.info(0x0000, "testTag", "%{public}s", this.user.getOther());
    }
}

export function arkmain_accessor_state_002_F(): void {
    void ArkMainAccessorState002;
}
