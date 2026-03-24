import { UiExtensionAbility, taint } from "./taint_mock";

class ProbeUiExtension extends UiExtensionAbility {
    sessionCreate(): void {
        taint.Sink("session-token");
    }
}

export function uiextension_sessioncreate_017_F(): void {
    void ProbeUiExtension;
}
