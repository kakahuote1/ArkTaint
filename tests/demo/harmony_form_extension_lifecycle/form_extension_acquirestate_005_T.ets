import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension005 extends FormExtensionAbility {
    onAcquireFormState(): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_acquirestate_005_T(): void {
    void CardExtension005;
}
