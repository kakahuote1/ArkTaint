import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import http from '@ohos.net.http';
import geoLocationManager from '@ohos.geoLocationManager';
import { hilog } from '@kit.PerformanceAnalysisKit';
import sim from '@ohos.telephony.sim'

class A{
  str: string = ''
}

class B{
  a: A = new A();
}

export default class EntryAbility extends UIAbility {
  aliasFlow(): void {
    let a1 = new A(), a2 = new A();
    let b1 = new B(), b2 = new B();
    let a: A, b: B;
    if (Math.random() < 0.5) {
      a = a1;
      b = b1;
    } else {
      a = a2;
      b = b2;
    }
    b.a = a;
    a2.str = JSON.stringify(geoLocationManager.getLastLocation()); //source
    hilog.info(0x0000, 'testTag', '%{public}s', a.str); //sink, leak
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.aliasFlow();
  }
}
