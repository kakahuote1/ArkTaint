import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import { User } from './User';

export default class EntryAbility extends UIAbility {
  user: User = new User();
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    this.user.setInfo(info);
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(0x0000, 'testTag', '%{public}s', this.user.getInfo()); //sink, leak
  }
}