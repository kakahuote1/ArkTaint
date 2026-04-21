import { State, Watch, taint } from "./taint_mock";

class ReactivePage004 {
    @State token: string = "";

    aboutToAppear(): void {
        this.token = taint.Source();
    }

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink("safe");
    }
}

export function reactive_watch_safe_004_T(): void {
    const page = new ReactivePage004();
    page.aboutToAppear();
    page.onTokenWatch();
}

