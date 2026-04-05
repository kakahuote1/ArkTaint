import { hilog } from '@kit.PerformanceAnalysisKit';
import sim from '@ohos.telephony.sim'
import geoLocationManager from '@ohos.geoLocationManager';

@Entry
@Component
struct Index {
  @State info: string = 'Hello World';

  build() {
    RelativeContainer() {
      Text(this.info)
        .id('HelloWorld')
        .fontSize(50)
        .fontWeight(FontWeight.Bold)
        .alignRules({
          center: { anchor: '__container__', align: VerticalAlign.Center },
          middle: { anchor: '__container__', align: HorizontalAlign.Center }
        })
      Button('press').onClick(() => {
        this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
        hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
      });
    }
    .height('100%')
    .width('100%')
  }
}
