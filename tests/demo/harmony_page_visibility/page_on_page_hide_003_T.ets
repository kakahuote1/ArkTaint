import { taint } from "./taint_mock";

class Page003 {
    onPageHide(): void {
        const v = taint.Source();
        taint.Sink(v);
    }
}

export function page_on_page_hide_003_T(): void {
    void Page003;
}

