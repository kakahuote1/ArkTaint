import { InputMethodExtensionAbility, sinkHelper, taint } from "./taint_mock";

class ProbeInputMethod001 extends InputMethodExtensionAbility {
    onCreate(): void {
        sinkHelper(taint.Source());
    }
}

export function inputmethod_helper_001_T(): void {
    void ProbeInputMethod001;
}
