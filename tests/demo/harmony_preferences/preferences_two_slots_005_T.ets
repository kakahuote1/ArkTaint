import { Preferences, taint } from "./taint_mock";

export function preferences_two_slots_005_T(taint_src: string): void {
    const p = new Preferences();
    p.put("safe", "const");
    p.put("token", taint_src);
    taint.Sink(p.get("token"));
}
