import { taint } from "./taint_mock"

/**
 * Introduction 路径敏感-区分if else分支
 */
export function conditional_if_001_T(taint_src : string) {
  let res = ""
  if (false) {
    res = "_"
  } else {
    res = taint_src
  }
  taint.Sink(res)
}
