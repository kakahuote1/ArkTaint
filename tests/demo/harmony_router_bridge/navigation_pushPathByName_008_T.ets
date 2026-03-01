import { NavPathStack, taint } from "./taint_mock";

class NavigationDetailPage008 {
    static render(): void {
        const params = NavPathStack.getParams();
        taint.Sink(params);
    }
}

export function navigation_pushPathByName_008_T(taint_src: string): void {
    NavPathStack.pushPathByName({ name: "CourseDetail", param: taint_src });
    NavigationDetailPage008.render();
}
