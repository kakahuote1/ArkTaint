import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


class A {
  getInfo(): string {
    return '';
  }
}

class B extends A {
  getInfo(): string {
    return JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}

class C extends A {
  getInfo(): string {
    return 'a';
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let a: A = new C();
    hilog.info(0x0000, 'testTag', '%{public}s', a.getInfo()); //sink, no leak
  }
}
