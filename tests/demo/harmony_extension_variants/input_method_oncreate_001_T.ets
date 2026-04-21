import { InputMethodExtensionAbility, taint } from "./taint_mock";

class ProbeInputMethodExtension extends InputMethodExtensionAbility {
    onCreate(): void {
        taint.Sink(taint.Source());
    }
}

export function input_method_oncreate_001_T(): void {
    void ProbeInputMethodExtension;
}
