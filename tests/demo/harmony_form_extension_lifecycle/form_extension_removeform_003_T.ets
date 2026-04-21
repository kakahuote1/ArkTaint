import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension003 extends FormExtensionAbility {
    onRemoveForm(_formId: number): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_removeform_003_T(): void {
    void CardExtension003;
}
