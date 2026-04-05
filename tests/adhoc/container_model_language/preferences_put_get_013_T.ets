import { Preferences, taint } from "./taint_mock";

export function preferences_put_get_013_T(taint_src: string): void {
    const p = new Preferences();
    p.put("token", taint_src);
    taint.Sink(p.get("token"));
}
