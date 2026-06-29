import {
    BuilderNode,
    UIAbility,
    WrappedBuilder,
    wrapBuilder,
} from "./taint_mock";

class PlainBuilderNode {
    build(_builder: WrappedBuilder<() => void>): void {}
}

class DemoAbility extends UIAbility {
    onCreate(): void {
        const node = new BuilderNode<string>();

        const wrapped = wrapBuilder((_value: string) => {
            this.handleWrappedBuilder();
        });
        node.build(wrapped, "value");

        node.build(wrapBuilder(() => {
            this.handleInlineWrappedBuilder();
        }));

        const constructed = new WrappedBuilder((_value: string) => {
            this.handleConstructedWrappedBuilder();
        });
        node.build(constructed, "value", { nestingBuilderSupported: true });

        const plain = new PlainBuilderNode();
        plain.build(wrapBuilder(() => {
            this.handlePlainBuild();
        }));
    }

    handleWrappedBuilder(): void {}
    handleInlineWrappedBuilder(): void {}
    handleConstructedWrappedBuilder(): void {}
    handlePlainBuild(): void {}
}

export function arkmain_buildernode_build_callback_001(): void {
    const ability = new DemoAbility();
    ability.onCreate();
}
