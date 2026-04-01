import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import sim from '@ohos.telephony.sim'


export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let s: string[][] = [[]];
    s[0][0] = JSON.stringify(geoLocationManager.getLastLocation());//source
    hilog.info(0x0000, 'testTag', '%{public}s', s[0]); //sink, leak
  }
}
