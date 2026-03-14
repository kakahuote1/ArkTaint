import { AppStorage, taint } from "./taint_mock";

export function readTokenSink(): void {
    const out = AppStorage.get("token");
    taint.Sink(out);
}

export function readSafeSink(): void {
    const out = AppStorage.get("safe");
    taint.Sink(out);
}
