import EntryAbility from '../entryability/EntryAbility';
import hilog from '@ohos.hilog';

@Entry
@Component
struct Index {
  @State message: string = 'Hello World';
  aboutToRecycle?(): void {

    hilog.info(0x0000, 'testTag', '%{public}s', EntryAbility.info);
  }

  build() {
    RelativeContainer() {
      Text(this.message)
        .id('HelloWorld')
        .fontSize(50)
        .fontWeight(FontWeight.Bold)
        .alignRules({
          center: { anchor: '__container__', align: VerticalAlign.Center },
          middle: { anchor: '__container__', align: HorizontalAlign.Center }
        })
    }
    .height('100%')
    .width('100%')
  }
}