import { UiExtensionAbility, Want, taint } from "./taint_mock";

class ProbeUiExtension extends UiExtensionAbility {
    onNewWant(_want: Want): void {
        taint.Sink(taint.Source());
    }
}

export function uiextension_onnewwant_015_T(): void {
    void ProbeUiExtension;
}
