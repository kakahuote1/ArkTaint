import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';



export default class EntryAbility extends UIAbility {
  info: string = "";

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let func = (): void => {
      this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    }
    func();
  }

  onDestroy(): void | Promise<void> {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
  }
}
