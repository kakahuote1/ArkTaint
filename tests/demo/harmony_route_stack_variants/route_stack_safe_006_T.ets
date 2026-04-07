import { NavPathStack, taint } from "./taint_mock";

class SourcePage006 {
    build(): void {
        new NavPathStack().pushPath({ name: "TargetPage", params: { token: "clean" } });
    }
}

class TargetPage006 {
    onPageShow(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_safe_006_T(): void {
    const source = new SourcePage006();
    source.build();
    const target = new TargetPage006();
    target.onPageShow();
}
