import { NavPathStack, taint } from "./taint_mock";

class SourcePage001 {
    build(): void {
        const stack = new NavPathStack();
        stack.replacePath({ name: "TargetPage", params: { token: taint.Source() } });
    }
}

class TargetPage001 {
    onPageShow(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_replace_show_001_T(): void {
    const source = new SourcePage001();
    source.build();
    const target = new TargetPage001();
    target.onPageShow();
}
