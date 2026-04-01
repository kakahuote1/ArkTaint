import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import radio from '@ohos.telephony.radio';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    callA((i: string) => {
      hilog.info(0x0000, 'testTag', '%{public}s', i); //sink, leak
    });
  }
}

function callA(callback: (i: string) => void) {
  let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  callback(info);
}


