import { taint } from "./taint_mock"

/**
 * Introduction 路径敏感-区分switch
 * Level 3
 */
export function conditional_switch_002_F(taint_src : string) {
  let data = ""
  let n = 2;
  switch (n) {
    case 1:
      data = taint_src
      break
  }
  taint.Sink(data)
}
