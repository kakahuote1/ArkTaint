import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';



export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let a: Array<geoLocationManager.Location> = new Array(1);
    a[0] = geoLocationManager.getLastLocation(); //source
    let b: Array<geoLocationManager.Location> = JSON.parse(JSON.stringify(a));
    hilog.info(0x0000, 'testTag', '%{public}s', b[0]); //sink, leak
  }
}