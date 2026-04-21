import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


class A {
  info: string = ''
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let tiant = JSON.stringify(geoLocationManager.getLastLocation()); //source
    let a = new A();
    a.info = tiant;
    let v = tiant;
    a.info = '';
    v = '';
    hilog.info(0x0000, 'testTag', '%{public}s', a.info); //sink, no leak
    hilog.info(0x0000, 'testTag', '%{public}s', v); //sink, no leak
  }
}
