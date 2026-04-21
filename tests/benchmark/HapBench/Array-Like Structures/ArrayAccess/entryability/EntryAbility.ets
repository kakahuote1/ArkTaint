import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import geoLocationManager from '@ohos.geoLocationManager';


export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let s: string[] = new Array(2);
    s[0] = JSON.stringify(geoLocationManager.getLastLocation()); //source
    hilog.info(0x0000, 'testTag', '%{public}s', s[0]); //sink, leak
  }
}
