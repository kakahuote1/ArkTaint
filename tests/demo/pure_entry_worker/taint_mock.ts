export class Worker {
    onMessage(callback: (payload: string) => void): void {
        void callback;
    }

    postMessage(payload: string): void {
        void payload;
    }
}

export class TaskPool {
    execute(job: (value: string) => void, value: string): void {
        void job;
        void value;
    }
}

export namespace taint {
    export function Sink(value: unknown): void {
        void value;
    }
}
