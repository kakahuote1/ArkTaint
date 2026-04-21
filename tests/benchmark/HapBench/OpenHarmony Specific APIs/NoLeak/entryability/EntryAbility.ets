import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import sim from '@ohos.telephony.sim'


export default class EntryAbility extends UIAbility {
  info: string = '';
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onCreate');
    this.info = JSON.stringify(geoLocationManager.getLastLocation());//source
    this.info = "no";
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, no leak

  }
}
