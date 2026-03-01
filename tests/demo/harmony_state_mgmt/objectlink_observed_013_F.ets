import { ObjectLink, Observed, State, taint } from "./taint_mock";

@Observed
class Profile013 {
    name: string = "";
}

class Child013 {
    @ObjectLink()
    profile: Profile013 = new Profile013();

    build(): void {
        taint.Sink(this.profile.name);
    }
}

class Parent013 {
    @State()
    profile: Profile013 = new Profile013();

    @State()
    other: string = "";

    build(): void {
        const child = new Child013({ profile: this.profile });
        child.build();
    }
}

export function objectlink_observed_013_F(taint_src: string): void {
    const p = new Parent013();
    p.other = taint_src;
    p.profile.name = "safe";
    p.build();
}

