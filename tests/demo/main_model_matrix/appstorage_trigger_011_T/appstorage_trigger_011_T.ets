function Entry<T extends Function>(_target: T): void {}
function Component<T extends Function>(_target: T): void {}

class AppStorage {
    static get(_key: string): string {
        return "storage";
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
        const _stored = AppStorage.get("token");
        const data = Source();
        Sink(data);
    }

    build(): void {}
}

export function appstorage_trigger_011_T(): void {}
