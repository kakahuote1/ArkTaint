import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';


export default class EntryAbility extends UIAbility {
  info: string = ''
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    this.info = JSON.stringify(geoLocationManager.getLastLocation()); //source
  }

  onShare(wantParam: Record<string, Object>): void {
    hilog.info(0x0000, 'testTag', '%{public}s', this.info); //sink, leak
  }
}
