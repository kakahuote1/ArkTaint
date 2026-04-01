import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


interface I {
  getInfo(): string
}

class B implements I {
  getInfo(): string {
    return JSON.stringify(geoLocationManager.getLastLocation()); //source
  }
}

class C implements I {
  getInfo(): string {
    return 'a';
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let a: I = this.createC();
    hilog.info(0x0000, 'testTag', '%{public}s', a.getInfo()); //sink, no leak
  }

  createB(): I {
    return new B();
  }

  createC(): I {
    return new C();
  }
}
