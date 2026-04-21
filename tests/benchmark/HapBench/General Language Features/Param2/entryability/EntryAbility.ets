import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';



export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let s = "ArkTS";
    this.log(s)
  }

  log(s: string) {
    hilog.info(0x0000, 'testTag', '%{public}s', s); //sink, no leak
  }

  unReachable() {
    let s = JSON.stringify(geoLocationManager.getLastLocation()); //source
    this.log(s);
  }
}
