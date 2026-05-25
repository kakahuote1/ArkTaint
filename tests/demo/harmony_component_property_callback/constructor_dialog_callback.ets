declare class CustomDialogController {
  constructor(options: object);
}

declare function TextInput(): any;
declare function sink(value: string): void;

@CustomDialog
export struct ConstructorDialog {
  confirm?: (value: string) => void;
  @Link value: string;

  build() {
    TextInput()
      .onChange((value: string) => {
        this.value = value;
      })
    Button()
      .onClick(() => {
        this.confirm && this.confirm(this.value);
      })
  }
}

@Entry
@Component
struct HostPage {
  @State value: string = "";

  dialogController: CustomDialogController = new CustomDialogController({
    builder: ConstructorDialog({
      value: $value,
      confirm: (value: string) => {
        this.accept(value);
      }
    })
  });

  accept(value: string) {
    sink(value);
  }

  build() {
    Button()
      .onClick(() => {
        this.dialogController;
      })
  }
}
