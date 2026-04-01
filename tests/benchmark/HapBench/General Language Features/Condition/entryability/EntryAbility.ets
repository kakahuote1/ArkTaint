import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';



export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = '';
    if (want.bundleName) {
      info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    } else {
      info = 'no tiant';
    }
    this.log(info);
  }

  log(s: string) {
    hilog.info(0x0000, 'testTag', '%{public}s', s); //sink, leak
  }
}
