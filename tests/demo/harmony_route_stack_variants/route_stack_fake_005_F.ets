import { FakeNavPathStack, taint } from "./taint_mock";

class FakeTargetPage005 {
    onPageShow(): void {
        const params = new FakeNavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_fake_005_F(): void {
    const target = new FakeTargetPage005();
    target.onPageShow();
}
