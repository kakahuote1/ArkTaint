declare function input(): string;
declare function sink(value: string): void;
declare function ExternalButton(options: { onBtnClick: () => void }): void;
declare function registerAction(options: { onBtnClick: () => void }): void;

@Entry
@Component
struct HostPage {
  build() {
    ExternalButton({
      onBtnClick: () => {
        sink(input());
      }
    });

    registerAction({
      onBtnClick: () => {
        sink("not a component option callback");
      }
    });
  }
}
