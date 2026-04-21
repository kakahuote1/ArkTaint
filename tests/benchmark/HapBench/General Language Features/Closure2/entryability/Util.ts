import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


export function outFunction() {
  function inFunction1() {
    function inFunction2() {
      hilog.info(0x0000, 'testTag', '%{public}s', info); //sink, leak
    }
    inFunction2()
  }
  let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  inFunction1();
}