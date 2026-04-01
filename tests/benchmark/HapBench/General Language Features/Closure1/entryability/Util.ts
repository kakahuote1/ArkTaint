import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


export function outFunction() {
  function inFunction() {
    hilog.info(0x0000, 'testTag', '%{public}s', info); //sink, leak
  }
  let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  inFunction();
}