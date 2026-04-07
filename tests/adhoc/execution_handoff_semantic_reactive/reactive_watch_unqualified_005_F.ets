import { Watch, taint } from "./taint_mock";

class ReactiveWatchUnqualified005 {
    token: string = "";

    update(v: string): void {
        this.token = v;
    }

    @Watch("token")
    onTokenChanged(): void {
        taint.Sink(this.token);
    }
}

export function reactive_watch_unqualified_005_F(taint_src: string): void {
    const page = new ReactiveWatchUnqualified005();
    page.update(taint_src);
}
