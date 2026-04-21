import { Emitter, taint } from "./taint_mock";

class EmitterPage001 {
    build(): void {
        const emitter = new Emitter();
        emitter.on("login", (payload: string): void => {
            taint.Sink(payload);
        });
    }
}

export function emitter_on_build_001_T(): void {
    void EmitterPage001;
}
