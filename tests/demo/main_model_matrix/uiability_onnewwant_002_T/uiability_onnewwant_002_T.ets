class UIAbility {}
class Want {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class EntryAbility extends UIAbility {
    onNewWant(_want: Want): void {
        const data = Source();
        Sink(data);
    }
}

export function uiability_onnewwant_002_T(): void {}
