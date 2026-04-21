import { NavPathStack, taint } from "./taint_mock";

class SourcePage004 {
    build(): void {
        const stack = new NavPathStack();
        stack.pushPath({ name: "MiddlePage", params: { token: taint.Source() } });
    }
}

class MiddlePage004 {
    onPageShow(): void {
        const params = new NavPathStack().getParams();
        new NavPathStack().replacePath({ name: "TargetPage", params });
    }
}

class TargetPage004 {
    onPageShow(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_multi_page_004_T(): void {
    const source = new SourcePage004();
    source.build();
    const middle = new MiddlePage004();
    middle.onPageShow();
    const target = new TargetPage004();
    target.onPageShow();
}
