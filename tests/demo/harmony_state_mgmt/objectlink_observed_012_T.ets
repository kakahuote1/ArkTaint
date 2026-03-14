import { ObjectLink, Observed, State, taint } from "./taint_mock";

@Observed
class Profile012 {
    name: string = "";
}

class Child012 {
    @ObjectLink()
    profile: Profile012 = new Profile012();

    build(): void {
        taint.Sink(this.profile.name);
    }
}

class Parent012 {
    @State()
    profile: Profile012 = new Profile012();

    build(): void {
        const child = new Child012({ profile: this.profile });
        child.build();
    }
}

export function objectlink_observed_012_T(taint_src: string): void {
    const p = new Parent012();
    p.profile.name = taint_src;
    p.build();
}

