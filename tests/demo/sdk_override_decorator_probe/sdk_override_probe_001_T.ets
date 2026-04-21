import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";

export default class SdkOverrideProbeAbility extends UIAbility {
    override onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        void want;
        void launchParam;
    }

    override onNewWant(want: Want): void {
        void want;
    }

    helper(): void {}

    private hiddenHelper(): void {}

    static onDestroy(): void {}
}

class LocalBaseLifecycle {
    onCreate(): void {}
}

export class LocalDerivedLifecycle extends LocalBaseLifecycle {
    onCreate(): void {}

    static onDestroy(): void {}
}
