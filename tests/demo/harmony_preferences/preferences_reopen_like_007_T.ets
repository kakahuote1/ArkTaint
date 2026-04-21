import { Preferences, taint } from "./taint_mock";

export function preferences_reopen_like_007_T(taint_src: string): void {
    const p1 = new Preferences();
    const p2 = new Preferences();
    p1.put("token", taint_src);
    taint.Sink(p2.get("token"));
}
