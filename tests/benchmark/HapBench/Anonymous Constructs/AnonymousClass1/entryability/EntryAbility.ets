import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import geoLocationManager from '@ohos.geoLocationManager';
import { taint } from '../Util';

interface A {
  info: string;
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let s = JSON.stringify(geoLocationManager.getLastLocation()); //source
    taint(s);
  }
}
