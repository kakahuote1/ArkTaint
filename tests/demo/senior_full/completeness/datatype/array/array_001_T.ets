import { taint } from '../../../../pages/taint';
/**
 * Introduction 组数类型
 */
export function array_001_T(taint_src : string[]) : void {
  taint.Sink(taint_src);
}
