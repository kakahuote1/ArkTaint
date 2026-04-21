function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class LocalStorage {
    static get(_key: string): string {
        return "local";
    }
}

function Source(): string {
    return "taint";
}

function Sink(_value: string): void {}

@Entry
@Component
struct DemoPage {
    hydrateFromStorage(): void {
        const _stored = LocalStorage.get("token");
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function localstorage_trigger_012_T(): void {}
