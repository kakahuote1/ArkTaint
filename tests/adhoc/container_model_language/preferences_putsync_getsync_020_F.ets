import { Preferences, taint } from "./taint_mock";

export function preferences_putsync_getsync_020_F(taint_src: string): void {
    const p = new Preferences();
    p.putSync("token_alt", taint_src);
    taint.Sink(p.getSync("token"));
}
