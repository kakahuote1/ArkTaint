import { State, Watch, taint } from "./taint_mock";

class ReactivePage005 {
    @State token: string = "";

    aboutToAppear(): void {
        this.token = taint.Source();
    }

    @Watch("other")
    onOtherWatch(): void {
        taint.Sink(this.token);
    }
}

export function reactive_non_watched_005_T(): void {
    void ReactivePage005;
}

