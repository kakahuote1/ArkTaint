import { taint } from "./taint_mock";

class Page002 {
    onPageShow(): void {
        const v = taint.Source();
        taint.Sink(v);
    }
}

export function page_on_page_show_002_T(): void {
    void Page002;
}

