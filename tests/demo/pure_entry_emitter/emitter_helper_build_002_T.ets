import { Emitter, taint } from "./taint_mock";

function registerLogin(emitter: Emitter): void {
    emitter.on("login", (payload: string): void => {
        taint.Sink(payload);
    });
}

class EmitterPage002 {
    build(): void {
        registerLogin(new Emitter());
    }
}

export function emitter_helper_build_002_T(): void {
    void EmitterPage002;
}
