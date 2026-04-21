class UIAbility {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

class EntryAbility extends UIAbility {
    onDestroy(): void {
        const data = Source();
        Sink(data);
    }
}

export function uiability_ondestroy_003_T(): void {}
