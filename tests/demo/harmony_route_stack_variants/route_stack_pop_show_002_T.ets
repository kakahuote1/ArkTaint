import { NavPathStack, taint } from "./taint_mock";

class SourcePage002 {
    build(): void {
        const stack = new NavPathStack();
        stack.pushPath({ name: "MiddlePage", params: { token: "clean" } });
        stack.pushPath({ name: "TargetPage", params: { token: taint.Source() } });
        stack.pop();
        stack.pushPath({ name: "TargetPage", params: { token: taint.Source() } });
    }
}

class TargetPage002 {
    aboutToAppear(): void {
        const params = new NavPathStack().getParams();
        taint.Sink(params.token);
    }
}

export function route_stack_pop_show_002_T(): void {
    void SourcePage002;
    void TargetPage002;
}
