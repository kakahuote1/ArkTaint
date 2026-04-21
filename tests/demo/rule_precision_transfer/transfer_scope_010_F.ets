import { taint } from "./taint_mock";

export function transfer_scope_010_F(taint_src: string) {
    const host = new taint.ScopeHostBlocked();
    const out = host.BridgeScope(taint_src);
    taint.Sink(out);
}
