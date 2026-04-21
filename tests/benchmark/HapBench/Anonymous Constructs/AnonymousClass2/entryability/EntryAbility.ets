import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { taint } from '../Util';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    taint()
  }
}
