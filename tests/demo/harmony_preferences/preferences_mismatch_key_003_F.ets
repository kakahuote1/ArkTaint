import { Preferences, taint } from "./taint_mock";

export function preferences_mismatch_key_003_F(taint_src: string): void {
    const p = new Preferences();
    p.put("token_alt", taint_src);
    const out = p.get("token");
    taint.Sink(out);
}
