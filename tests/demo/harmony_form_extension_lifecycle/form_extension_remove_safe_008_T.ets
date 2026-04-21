import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension008 extends FormExtensionAbility {
    onRemoveForm(_formId: number): void {
        taint.Sink("clean");
    }
}

export function form_extension_remove_safe_008_T(): void {
    void CardExtension008;
}
