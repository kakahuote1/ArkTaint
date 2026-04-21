import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import geoLocationManager from '@ohos.geoLocationManager';
import fileio from '@ohos.fileio';
import fs from '@ohos.file.fs';


export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    let info = JSON.stringify(geoLocationManager.getLastLocation()); //source
    let file = fs.openSync('a.txt');
    fs.write(file.fd, info) //sink, leak
  }

  onDestroy(): void | Promise<void> {
    let file = fs.openSync('a.txt');
    let info: ArrayBuffer = new ArrayBuffer(1024);
    fs.write(file.fd, info)
    hilog.info(0x0000, 'testTag', '%{public}s', info);
  }
}
