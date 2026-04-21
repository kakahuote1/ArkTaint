import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension007 extends FormExtensionAbility {
    refreshCard(): void {
        taint.Sink("clean");
    }
}

export function form_extension_nonform_007_F(): void {
    void CardExtension007;
}
