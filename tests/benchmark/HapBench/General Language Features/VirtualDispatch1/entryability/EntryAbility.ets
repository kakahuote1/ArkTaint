import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class NoLeak {
  info: string;
  constructor(i: string) {
    this.info = i;
  }
  getInfo(): string {
    return this.info;
  }
  log() {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info);
  }
}

class Leak extends NoLeak {
  constructor(i: string) {
    super(i);
  }
  log() {
    hilog.info(0x0000, 'testTag', '%{public}s', super.getInfo()); //sink, leak
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    let d: NoLeak = new Leak(info);
    d.log()
  }
}
