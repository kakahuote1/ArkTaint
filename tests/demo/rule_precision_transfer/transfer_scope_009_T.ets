import { taint } from "./taint_mock";

export function transfer_scope_009_T(taint_src: string) {
    const host = new taint.ScopeHostAllowed();
    const out = host.BridgeScope(taint_src);
    taint.Sink(out);
}
