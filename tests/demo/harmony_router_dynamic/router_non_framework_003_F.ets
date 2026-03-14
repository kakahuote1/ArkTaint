import { FakeRouter, taint } from "./taint_mock";

export function router_non_framework_003_F(): void {
    const p = FakeRouter.getParams();
    taint.Sink("safe_" + p);
}
