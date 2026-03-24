import { taint } from "./taint_mock";

class Page004 {
    render(): void {
        const v = taint.Source();
        taint.Sink(v);
    }
}

export function page_non_visibility_method_004_F(): void {
    void Page004;
}

