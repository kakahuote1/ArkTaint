declare function input(): string;
declare function sink(value: string): void;
declare function ExternalButton(options: { onBtnClick: (value: string) => void }): void;
declare function registerAction(options: { onBtnClick: (value: string) => void }): void;

@Entry
@Component
struct HostPage {
  build() {
    ExternalButton({
      onBtnClick: (content: string) => {
        sink(content);
        sink(input());
      }
    });

    registerAction({
      onBtnClick: (content: string) => {
        sink("not a component option callback");
      }
    });
  }
}
