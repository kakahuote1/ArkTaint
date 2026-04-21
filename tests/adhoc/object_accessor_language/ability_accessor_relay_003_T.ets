import { taint, UIAbility } from "./taint_mock";

class User {
    private info: string = "";
    private other: string = "safe";

    setInfo(next: string): void {
        this.info = next;
    }

    getInfo(): string {
        return this.info;
    }

    getOther(): string {
        return this.other;
    }
}

class EntryAbility extends UIAbility {
    private user: User = new User();

    onCreate(seed: string): void {
        this.user.setInfo(seed);
    }

    onForeground(): void {
        taint.Sink(this.user.getInfo());
    }
}

export function ability_accessor_relay_003_T(): void {
    const ability = new EntryAbility();
    const taint_src = taint.Source();
    ability.onCreate(taint_src);
    ability.onForeground();
}
