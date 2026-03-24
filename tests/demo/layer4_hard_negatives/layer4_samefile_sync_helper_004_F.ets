import { taint } from "./taint_mock";

function transformPayload(raw: string, cb: (value: string) => string): string {
    return cb(raw.trim());
}

class Layer4SyncHelperPage {
    build(): void {
        const normalized = transformPayload(" token ", (value) => {
            taint.Sink(value);
            return value.toUpperCase();
        });
        void normalized;
    }
}

export function layer4_samefile_sync_helper_004_F(): void {
    void Layer4SyncHelperPage;
}
