import { taint } from "./taint_mock";

class Page001 {
    aboutToAppear(): void {
        const v = taint.Source();
        taint.Sink(v);
    }
}

export function page_about_to_appear_001_T(): void {
    void Page001;
}

