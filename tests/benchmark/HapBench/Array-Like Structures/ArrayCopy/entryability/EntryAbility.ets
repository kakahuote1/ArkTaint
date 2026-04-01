import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let s: string[] = new Array(2);
    s[0] = JSON.stringify(geoLocationManager.getLastLocation());//source
    let sCopy: string = JSON.parse(JSON.stringify(s));
    hilog.info(0x0000, 'testTag', '%{public}s', sCopy[0]); //sink, leak
  }
}
