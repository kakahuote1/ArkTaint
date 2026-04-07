import { NavPathStack, taint } from "./taint_mock";

class SourcePage003 {
    build(): void {
        const stack = new NavPathStack();
        stack.pushPath({ name: "BasePage", params: { token: "clean" } });
        stack.pushPath({ name: "TargetPage", params: { token: taint.Source() } });
        stack.back();
        stack.pushPath({ name: "TargetPage", params: { token: taint.Source() } });
    }
}

class TargetPage003 {
    onPageHide(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_back_hide_003_T(): void {
    const source = new SourcePage003();
    source.build();
    const target = new TargetPage003();
    target.onPageHide();
}
