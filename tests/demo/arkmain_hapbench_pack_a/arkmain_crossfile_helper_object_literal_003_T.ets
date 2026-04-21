import { AbilityConstant, UIAbility, Want } from "@kit.AbilityKit";
import { emitGeoObjectLiteralFromHelper } from "./crossfile_helper";

export default class EntryAbility extends UIAbility {
    onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
        void want;
        void launchParam;
        emitGeoObjectLiteralFromHelper();
    }
}
