import { taint } from "./taint_mock"

/**
 * Introduction 路径敏感-区分switch
 * Level 3
 */
export function conditional_switch_001_T(taint_src : string) {
  let data = ""
  let n = 2;
  switch (n) {
    case 2:
      data = taint_src
      break
  }
  taint.Sink(data)
}
