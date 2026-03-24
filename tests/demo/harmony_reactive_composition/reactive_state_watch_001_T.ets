import { State, Watch, taint } from "./taint_mock";

class ReactivePage001 {
    @State token: string = "";

    aboutToAppear(): void {
        this.token = taint.Source();
    }

    @Watch("token")
    onTokenWatch(): void {
        taint.Sink(this.token);
    }
}

export function reactive_state_watch_001_T(): void {
    void ReactivePage001;
}

