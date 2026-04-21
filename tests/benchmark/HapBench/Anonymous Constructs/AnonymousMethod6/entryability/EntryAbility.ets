import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';

class A {
  static info: string = '';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    callA(() => {
      A.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    });
  }
}

function callA(callback: () => void) {
  let info = '';
  callback();
  hilog.info(0x0000, 'testTag', '%{public}s', A.info); //sink, leak
}


