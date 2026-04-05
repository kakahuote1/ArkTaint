import { taint, UIAbility } from "./taint_mock";
import { CrossFileUserModel } from "./crossfile_user_model";

class EntryAbility extends UIAbility {
    private user: CrossFileUserModel = new CrossFileUserModel();

    onCreate(seed: string): void {
        this.user.setInfo(seed);
    }

    onForeground(): void {
        taint.Sink(this.user.getOther());
    }
}

export function crossfile_accessor_012_F(): void {
    const ability = new EntryAbility();
    const taint_src = taint.Source();
    ability.onCreate(taint_src);
    ability.onForeground();
}
