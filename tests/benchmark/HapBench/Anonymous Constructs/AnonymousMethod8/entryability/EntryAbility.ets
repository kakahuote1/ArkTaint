import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';



export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    geoLocationManager.off('locationChange', () => {
      hilog.info(0x0000, 'testTag', '%{public}s', info); //sink, leak
    })
  }
}

