import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

@Entry
@Component
struct Index {
  @State message: string = 'Hello World';
  info: string = ''

  onPageHide(): void {
    this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
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
