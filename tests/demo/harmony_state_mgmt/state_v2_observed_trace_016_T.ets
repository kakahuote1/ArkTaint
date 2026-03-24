import { ObservedV2, State, Trace, taint } from "./taint_mock";

@ObservedV2
class Profile016 {
    @Trace()
    token: string = "";
}

class ChildV2Trace016 {
    @Trace()
    profile: Profile016 = new Profile016();

    build(): void {
        taint.Sink(this.profile.token);
    }
}

class ParentV2Trace016 {
    @State()
    profile: Profile016 = new Profile016();

    build(): void {
        const child = new ChildV2Trace016({ profile: this.profile });
        child.build();
    }
}

export function state_v2_observed_trace_016_T(taint_src: string): void {
    const parent = new ParentV2Trace016();
    parent.profile.token = taint_src;
    parent.build();
}
