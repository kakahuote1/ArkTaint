import { Computed, State, taint } from "./taint_mock";

class PageV2Computed018 {
    @State()
    token: string = "";

    @Computed
    getToken(): string {
        return this.token;
    }

    build(): void {
        taint.Sink(this.getToken());
    }
}

export function state_v2_computed_018_T(taint_src: string): void {
    const page = new PageV2Computed018();
    page.token = taint_src;
    page.build();
}
