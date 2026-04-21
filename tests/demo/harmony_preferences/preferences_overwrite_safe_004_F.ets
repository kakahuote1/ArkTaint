import { Preferences, taint } from "./taint_mock";

export function preferences_overwrite_safe_004_F(taint_src: string): void {
    const p = new Preferences();
    p.put("token", taint_src);
    p.put("token", "safe");
    taint.Sink(p.get("token"));
}
