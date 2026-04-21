class UIExtensionAbility {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class PanelExtension extends UIExtensionAbility {
    onSessionCreate(): void {
        const data = Source();
        Sink(data);
    }
}

export function uiextension_sessioncreate_015_T(): void {}
