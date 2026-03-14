import { Preferences, taint } from "./taint_mock";

export function preferences_put_get_alias_002_T(taint_src: string): void {
    const p = new Preferences();
    p.put("token", taint_src);
    const copy = p.get("token");
    taint.Sink(copy);
}
