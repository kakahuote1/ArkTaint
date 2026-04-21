
import geoLocationManager from '@ohos.geoLocationManager';
import EntryAbility from '../entryability/EntryAbility';

@Entry
@Component
struct Index {

  build() {
    RelativeContainer() {
      Button('press').onClick(() => {
        EntryAbility.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
      });
    }
    .height('100%')
    .width('100%')
  }
}