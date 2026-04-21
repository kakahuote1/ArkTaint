import { UIAbility, Want, taint } from "./taint_mock";

class TargetAbility extends UIAbility {
    onNewWant(want: Want): void {
        taint.Sink(want.token);
    }
}

class EntryPage {
    context = new TargetAbility().context;

    build(taint_src: string): void {
        this.context.startAbilityForResult(new Want(taint_src));
    }
}

export function startability_for_result_012_T(taint_src: string): void {
    new EntryPage().build(taint_src);
}
