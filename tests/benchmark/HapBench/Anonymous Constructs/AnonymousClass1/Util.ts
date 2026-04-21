import { hilog } from '@kit.PerformanceAnalysisKit';

export function taint(s: string) {
  let a = {
    info : s
  };
  hilog.info(0x0000, 'testTag', '%{public}s', a.info); //sink, leak
}