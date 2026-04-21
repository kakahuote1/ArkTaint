import { UiExtensionAbility, Want, taint } from "./taint_mock";

class ProbeUiExtension extends UiExtensionAbility {
    onCreate(_want: Want): void {
        taint.Sink(taint.Source());
    }
}

export function uiextension_oncreate_014_T(): void {
    void ProbeUiExtension;
}
