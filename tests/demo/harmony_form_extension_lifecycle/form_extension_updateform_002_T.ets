import { FormBindingData, FormExtensionAbility, taint } from "./taint_mock";

class CardExtension002 extends FormExtensionAbility {
    onUpdateForm(_formBindingData: FormBindingData): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_updateform_002_T(): void {
    void CardExtension002;
}
