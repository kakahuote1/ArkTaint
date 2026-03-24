import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension004 extends FormExtensionAbility {
    onCastToNormalForm(_formId: number): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_casttonormal_004_T(): void {
    void CardExtension004;
}
