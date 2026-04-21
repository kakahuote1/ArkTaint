import { Preferences, taint } from "./taint_mock";

export function preferences_put_get_014_F(taint_src: string): void {
    const p = new Preferences();
    p.put("token_alt", taint_src);
    taint.Sink(p.get("token"));
}
