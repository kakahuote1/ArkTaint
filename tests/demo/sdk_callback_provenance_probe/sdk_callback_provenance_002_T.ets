import { UIContext } from "@kit.ArkUI";

@Entry
@Component
struct SdkCallbackProbeDsl {
    @State value: number = 0;

    aboutToAppear(): void {
        void UIContext;
    }

    build() {
        Column() {
            Button("Tap")
                .onClick(() => {
                    this.value += 1;
                });

            Slider({ value: this.value })
                .onChange((next: number) => {
                    this.value = next;
                });

            Text(`${this.value}`);
        }
        .gesture(
            TapGesture().onAction(() => {
                this.value += 2;
            })
        );
    }
}
