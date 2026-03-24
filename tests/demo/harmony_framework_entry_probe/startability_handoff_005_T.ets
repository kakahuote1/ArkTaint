import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility extends UIAbility {
    onCreate(want: Want): void {
        void want;
        taint.Sink("safe");
    }
}

class EntryPage {
    context = new TargetAbility().context;

    build(taint_src: string): void {
        this.context.startAbility(new Want(taint_src));
    }
}

export function startability_handoff_005_T(taint_src: string): void {
    new EntryPage().build(taint_src);
}
