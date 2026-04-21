import { InputMethodExtensionAbility, sinkHelper } from "./taint_mock";

class ProbeInputMethod002 extends InputMethodExtensionAbility {
    onCreate(): void {
        sinkHelper("clean");
    }
}

export function inputmethod_safe_002_T(): void {
    void ProbeInputMethod002;
}
