import { ObjectLink, Observed, State, taint } from "./taint_mock";

@Observed
class Profile020 {
    name: string = "";
    uuid: string = "";
}

class Child020 {
    @ObjectLink()
    profile: Profile020 = new Profile020();

    build(): void {
        const localProfile = this.profile;
        taint.Sink(localProfile.uuid);
    }
}

class Parent020 {
    @State()
    profile: Profile020 = new Profile020();

    build(): void {
        const child = new Child020({ profile: this.profile });
        child.build();
    }
}

export function objectlink_local_sibling_field_020_F(taint_src: string): void {
    const p = new Parent020();
    p.profile.name = taint_src;
    p.profile.uuid = "safe";
    p.build();
}
