import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

export default class EntryAbility extends UIAbility {
  a : A = new A();
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    this.a.b.c.d = info;
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(0x0000, 'testTag', '%{public}s', this.a.b.c.d); //sink, leak
  }
}

class A {
  b: B = new B();
}

class B {
  c: C = new C();
}

class C {
  d: string = "";
}
