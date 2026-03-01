import { Router, taint } from "./taint_mock";

class Page018 {
    cache: string = "";

    build(): void {
        const p = Router.getParams();
        this.cache = p;
        taint.Sink(this.cache);
    }
}

export function lifecycle_router_getparams_alias_018_T(): void {
    const page = new Page018();
    page.build();
}

