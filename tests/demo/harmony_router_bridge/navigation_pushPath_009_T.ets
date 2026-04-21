import { NavPathStack, taint } from "./taint_mock";

class NavigationDetailPage009 {
    build(): void {
        const params = NavPathStack.getParams();
        taint.Sink("safe_" + params);
    }
}

export function navigation_pushPath_009_T(taint_src: string): void {
    NavPathStack.pushPath({ name: "SafePage", param: "safe_literal_param" });
    const detail = new NavigationDetailPage009();
    detail.build();
    const _unused = taint_src;
    void _unused;
}
