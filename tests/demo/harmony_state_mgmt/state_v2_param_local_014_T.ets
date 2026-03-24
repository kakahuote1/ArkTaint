import { Local, Param, taint } from "./taint_mock";

class ChildV2Param014 {
    @Param()
    token: string = "";

    build(): void {
        taint.Sink(this.token);
    }
}

class ParentV2Local014 {
    @Local()
    token: string = "";

    build(): void {
        const child = new ChildV2Param014({ token: this.token });
        child.build();
    }
}

export function state_v2_param_local_014_T(taint_src: string): void {
    const parent = new ParentV2Local014();
    parent.token = taint_src;
    parent.build();
}
