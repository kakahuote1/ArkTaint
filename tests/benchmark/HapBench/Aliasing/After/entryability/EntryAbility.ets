import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class A{
  str: string = ''
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const a = new A();
    a.str = JSON.stringify(geoLocationManager.getLastLocation()); //source
    const b = a;
    hilog.info(0x0000, 'testTag', '%{public}s', b.str); //sink, leak
  }
}
