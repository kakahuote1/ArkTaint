class UIAbility {}
class Want {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class EntryAbility extends UIAbility {
    onCreate(_want: Want): void {
        const data = Source();
        Sink(data);
    }
}

export function uiability_oncreate_001_T(): void {}
