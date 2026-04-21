import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class A{
  str: string = ''
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let c = new A();
    this.tiant(c)
    hilog.info(0x0000, 'testTag', '%{public}s', c.str); //sink, leak
  }

  tiant(a: A) {
    let b = a;
    b.str = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}
