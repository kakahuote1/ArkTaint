import { Entry, taint } from "./taint_mock";

class FakeParamsProvider {
    static getParams(): string {
        return "fake";
    }
}

@Entry
class ParamsPage010 {
    build(): void {
        const params = FakeParamsProvider.getParams();
        taint.Sink(params);
    }
}

export function lifecycle_router_non_router_getparams_010_F(): void {
    const page = new ParamsPage010();
    page.build();
}
