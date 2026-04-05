import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { hilog } from "@kit.PerformanceAnalysisKit";

class Leaf {
    value: string = "";
    safe: string = "safe";
}

class Level2 {
    leaf: Leaf = new Leaf();
}

class Level1 {
    inner: Level2 = new Level2();
}

export default class ArkMainDeepFieldState003 extends UIAbility {
    private holder: Level1 = new Level1();

    onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
        this.holder.inner.leaf.value = want.parameters;
    }

    onForeground(): void {
        hilog.info(0x0000, "testTag", "%{public}s", this.holder.inner.leaf.value);
    }
}

export function arkmain_deep_field_state_003_T(): void {
    void ArkMainDeepFieldState003;
}
