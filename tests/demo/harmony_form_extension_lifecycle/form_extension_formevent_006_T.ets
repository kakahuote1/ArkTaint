import { FormExtensionAbility, taint } from "./taint_mock";

class CardExtension006 extends FormExtensionAbility {
    onFormEvent(_event: string): void {
        taint.Sink(taint.Source());
    }
}

export function form_extension_formevent_006_T(): void {
    void CardExtension006;
}
