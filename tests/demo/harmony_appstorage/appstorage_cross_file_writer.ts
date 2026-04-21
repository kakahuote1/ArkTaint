import { AppStorage } from "./taint_mock";

export function writeToken(v: any): void {
    AppStorage.set("token", v);
}

export function writeSafe(v: any): void {
    AppStorage.set("safe", v);
}
