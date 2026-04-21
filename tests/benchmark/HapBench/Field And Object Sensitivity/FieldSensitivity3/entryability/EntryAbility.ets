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
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let a = new A();
    a.setInfo(JSON.stringify(geoLocationManager.getLastLocation())); //source
    hilog.info(0x0000, 'testTag', '%{public}s', a.getInfo()); //sink, leak
  }
}
