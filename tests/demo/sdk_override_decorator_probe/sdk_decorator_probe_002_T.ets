import { UIContext } from "@kit.ArkUI";

@Entry
@Component
struct SdkDecoratorProbePage {
    @State value: number = 0;

    @Watch("value")
    onValueWatch(): void {
        void UIContext;
    }

    build() {
        Text(`${this.value}`);
    }
}

@ComponentV2
export struct SdkDecoratorProbePageV2 {
    build() {
        Text("v2");
    }
}

class PlainDecoratorCarrier {
    @State value: number = 0;

    @Watch("value")
    onValueWatch(): void {}

    build(): void {}
}
