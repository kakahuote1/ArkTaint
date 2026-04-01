import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

abstract class Parent {
  abstract getInfo(): string
}

class Child1 extends Parent {
  getInfo(): string {
    return JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}

class Child2 extends Parent {
  getInfo(): string {
    return '';
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let a: Parent;
    if (Math.random() < 1) {
      a = new Child1();
    } else {
      a = new Child2();
    }
    hilog.info(0x0000, 'testTag', '%{public}s', a.getInfo()); //sink, leak
  }
}
