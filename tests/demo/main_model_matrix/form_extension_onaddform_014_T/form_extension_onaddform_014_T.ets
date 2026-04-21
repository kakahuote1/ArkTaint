class FormExtensionAbility {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class CardExtension extends FormExtensionAbility {
    onAddForm(): void {
        const data = Source();
        Sink(data);
    }
}

export function form_extension_onaddform_014_T(): void {}
