import { UIAbility, Want, taint } from "./taint_mock";

class FinalAbility003 extends UIAbility {
    onCreate(want: Want): void {
        taint.Sink(want.token);
    }
}

class MidAbility003 extends UIAbility {
    onCreate(want: Want): void {
        new FinalAbility003().context.startAbility(new Want(want.token));
    }
}

class EntryPage003 {
    build(): void {
        new MidAbility003().context.startAbility(new Want(taint.Source()));
    }
}

export function multiability_two_hop_create_003_T(): void {
    void FinalAbility003;
    void MidAbility003;
    void EntryPage003;
}
