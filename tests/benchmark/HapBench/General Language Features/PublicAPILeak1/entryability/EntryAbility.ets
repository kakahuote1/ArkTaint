import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';

class P{
  x:string = '';
  y:string = '';
  constructor(x: string, y: string) {
    this.x = x;
    this.y = y;
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'testTag', '%{public}s', 'Ability onCreate');
    let info = JSON.stringify(geoLocationManager.getLastLocation());//source
    let x = info.substring(0, 1), y = info.substring(1);
    let p = new P(x, y);
    hilog.info(0x0000, 'testTag', '%{public}s', p.x + p.y); //sink, leak
  }
}
