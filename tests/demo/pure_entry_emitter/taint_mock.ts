export class Emitter {
    on(event: string, callback: (payload: string) => void): void {
        void event;
        void callback;
    }

    emit(event: string, payload: string): void {
        void event;
        void payload;
    }
}

export namespace taint {
    export function Sink(value: unknown): void {
        void value;
    }
}
