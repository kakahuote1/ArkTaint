import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { emitSafeObjectLiteralFromHelper } from "./crossfile_helper";

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        void want;
        void launchParam;
        emitSafeObjectLiteralFromHelper();
    }
}
