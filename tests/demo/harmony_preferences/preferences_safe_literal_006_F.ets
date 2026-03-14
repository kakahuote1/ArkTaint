import { Preferences, taint } from "./taint_mock";

export function preferences_safe_literal_006_F(): void {
    const p = new Preferences();
    p.put("token", "safe");
    taint.Sink(p.get("token"));
}
