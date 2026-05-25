import { ObjectLink, Observed, State, taint } from "./taint_mock";

@Observed
class Profile019 {
    name: string = "";
    uuid: string = "";
}

class Child019 {
    @ObjectLink()
    profile: Profile019 = new Profile019();

    build(): void {
        taint.Sink(this.profile.uuid);
    }
}

class Parent019 {
    @State()
    profile: Profile019 = new Profile019();

    build(): void {
        const child = new Child019({ profile: this.profile });
        child.build();
    }
}

export function objectlink_sibling_field_019_F(taint_src: string): void {
    const p = new Parent019();
    p.profile.name = taint_src;
    p.profile.uuid = "safe";
    p.build();
}
