import { NavPathStack, taint } from "./taint_mock";

class NavigationDetailPage007 {
    build(): void {
        const params = NavPathStack.getParams();
        taint.Sink(params);
    }
}

export function navigation_pushPath_007_T(taint_src: string): void {
    NavPathStack.pushPath({ name: "DetailPage", param: taint_src });
    const detail = new NavigationDetailPage007();
    detail.build();
}
