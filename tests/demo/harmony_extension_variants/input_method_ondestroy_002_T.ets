import { InputMethodExtensionAbility, taint } from "./taint_mock";

class ProbeInputMethodExtension extends InputMethodExtensionAbility {
    onDestroy(): void {
        taint.Sink("safe");
    }
}

export function input_method_ondestroy_002_T(): void {
    void ProbeInputMethodExtension;
}

