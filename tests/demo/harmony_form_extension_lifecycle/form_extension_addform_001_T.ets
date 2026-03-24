import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension001 extends FormExtensionAbility {
    onAddForm(): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_addform_001_T(): void {
    void CardExtension001;
}
