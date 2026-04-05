import { taint, UIAbility } from "./taint_mock";

class Leaf {
    value: string = "";
    safe: string = "safe";
}

class Level2 {
    leaf: Leaf = new Leaf();
}

class Level1 {
    inner: Level2 = new Level2();
}

class EntryAbility extends UIAbility {
    private holder: Level1 = new Level1();

    onCreate(seed: object): void {
        const info = JSON.stringify(seed);
        this.holder.inner.leaf.value = info;
    }

    onForeground(): void {
        taint.Sink(this.holder.inner.leaf.value);
    }
}

export function stringify_deep_field_009_T(seed: object): void {
    const ability = new EntryAbility();
    ability.onCreate(seed);
    ability.onForeground();
}
