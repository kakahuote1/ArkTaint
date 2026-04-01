import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class A{
  str: string = ''
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let b = new A();
    hilog.info(0x0000, 'testTag', '%{public}s', b.str); //sink, no leak
    this.taint(b)
  }

  taint(a: A) {
    a = new A();
    a.str = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}
