function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct LandingShell {
    hydrateLaunchData(): void {
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function external_entry_llm_001_T(): void {}
