import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';



export default class Generalbility extends UIAbility {

  static info: string = ''

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Generalbility.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}
