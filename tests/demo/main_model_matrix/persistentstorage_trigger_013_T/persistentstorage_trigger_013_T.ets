function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class PersistentStorage {
    static get(_key: string): string {
        return "persistent";
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
        const _stored = PersistentStorage.get("token");
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function persistentstorage_trigger_013_T(): void {}
