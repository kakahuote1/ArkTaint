import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class A {
  info: string = '';
  fake: string = '';
  setInfo(i: string) {
    this.info = i;
  }
  getInfo(): string {
    return this.info;
  }
  setFake(i: string) {
    this.fake = i;
  }
  getFake(): string {
    return this.fake;
  }
}

export default class EntryAbility extends UIAbility {
  private a: A = new A();
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.a = this.setTiant(this.a);
    this.logTiant();
  }

  setTiant(a: A): A {
    a.setInfo(JSON.stringify(geoLocationManager.getLastLocation())); //source
    return a;
  }

  logTiant() {
    hilog.info(0x0000, 'testTag', '%{public}s', this.a.getFake()); //sink, no leak
  }
}
