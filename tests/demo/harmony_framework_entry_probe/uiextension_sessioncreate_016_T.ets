import { UiExtensionAbility, taint } from "./taint_mock";

class ProbeUiExtension extends UiExtensionAbility {
    onSessionCreate(): void {
        taint.Sink(taint.Source());
    }
}

export function uiextension_sessioncreate_016_T(): void {
    void ProbeUiExtension;
}
