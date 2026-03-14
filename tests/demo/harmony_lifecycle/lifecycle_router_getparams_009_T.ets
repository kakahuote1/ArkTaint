import { taint, Router } from "./taint_mock";

class ParamsPage009 {
    build(): void {
        const params = Router.getParams();
        taint.Sink(params);
    }
}

export function lifecycle_router_getparams_009_T(): void {
    const page = new ParamsPage009();
    page.build();
}

