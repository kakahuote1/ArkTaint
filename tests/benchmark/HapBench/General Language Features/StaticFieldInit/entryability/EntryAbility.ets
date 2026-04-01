import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import geoLocationManager from '@ohos.geoLocationManager';



export default class EntryAbility extends UIAbility {
  static info: string = JSON.stringify(geoLocationManager.getLastLocation()); //source

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'testTag', '%{public}s', EntryAbility.info); //sink, leak
  }
}
