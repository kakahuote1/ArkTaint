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

    onCreate(seed: string): void {
        this.holder.inner.leaf.value = seed;
    }

    onForeground(): void {
        taint.Sink(this.holder.inner.leaf.safe);
    }
}

export function ability_deep_field_relay_006_F(): void {
    const ability = new EntryAbility();
    const taint_src = taint.Source();
    ability.onCreate(taint_src);
    ability.onForeground();
}
