import { Preferences, taint } from "./taint_mock";

export function preferences_putsync_getsync_019_T(taint_src: string): void {
    const p = new Preferences();
    p.putSync("token", taint_src);
    taint.Sink(p.getSync("token"));
}
