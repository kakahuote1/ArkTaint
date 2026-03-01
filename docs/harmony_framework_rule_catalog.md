# Harmony Framework Rule Catalog (Phase 7.7.2.3)

## Purpose
This catalog tracks threat-oriented framework rules in `rules/framework.rules.json`.
It is the evidence index for `7.7.2.3` (framework-layer expansion).

## Threat Mapping (T1-T7)

| Threat | Source Rules | Sink Rules | Transfer Rules |
| --- | --- | --- | --- |
| T1 WebView injection | `source.harmony.router.getParams`, `source.harmony.network.http.requestAsync.callback.arg0`, `source.harmony.network.http.request.result`, `source.harmony.webview.onMessage.callback.arg0` | `sink.harmony.web.create.arg0`, `sink.harmony.webcontroller.loadUrl.arg0`, `sink.harmony.webcontroller.runJavaScript.arg0` | `transfer.harmony.json.parse.arg0_to_result`, `transfer.harmony.json.parse.arg0_to_result.sig`, `transfer.harmony.json.stringify.arg0_to_result`, `transfer.harmony.json.stringify.arg0_to_result.sig`, `transfer.harmony.string.concat.arg0_to_result` |
| T2 Information leak | `source.harmony.lifecycle.onCreate.want.arg0`, `source.harmony.lifecycle.onNewWant.want.arg0`, `source.harmony.lifecycle.onRestore.arg0`, `source.harmony.window.loadContent.callback.arg0`, `source.harmony.window.loadContent.callback.arg1`, `source.harmony.preferences.getSync.result`, `source.harmony.preferences.get.result`, `source.harmony.rdb.query.result`, `source.harmony.rdb.querySql.result`, `source.harmony.globalcontext.getObject.result`, `source.harmony.privacy.pasteboard.getSystemPasteboard.result` (disabled), `source.harmony.privacy.contacts.queryContacts.result` (disabled) | `sink.harmony.hilog.info.arg3`, `sink.harmony.hilog.info.arg3.sig`, `sink.harmony.hilog.error.arg3`, `sink.harmony.hilog.error.arg3.sig`, `sink.harmony.console.log.arg0`, `sink.harmony.http.request.body.arg1`, `sink.harmony.axios.post.body.arg1` | `transfer.harmony.globalcontext.setObject.arg1_to_base`, `transfer.harmony.globalcontext.getObject.base_to_result` |
| T3 SSRF / URL injection | `source.harmony.router.getParams`, `source.harmony.input.onChange.arg0`, `source.harmony.input.onInput.arg0`, `source.harmony.input.onSubmit.arg0`, `source.harmony.network.http.requestAsync.callback.arg0`, `source.harmony.network.http.request.result` | `sink.harmony.http.request.url.arg0`, `sink.harmony.axios.get.url.arg0`, `sink.harmony.axios.post.url.arg0`, `sink.harmony.router.pushUrl.arg0` | `transfer.harmony.http.request.arg1_to_result`, `transfer.harmony.axios.get.arg0_to_result`, `transfer.harmony.axios.post.arg1_to_result` |
| T4 SQL injection | `source.harmony.router.getParams`, `source.harmony.input.onChange.arg0`, `source.harmony.input.onInput.arg0`, `source.harmony.input.onSubmit.arg0` | `sink.harmony.rdb.executeSql.arg0`, `sink.harmony.rdb.querySql.arg0`, `sink.harmony.rdb.update.arg1`, `sink.harmony.rdb.update.arg2`, `sink.harmony.rdb.execDML.arg0`, `sink.harmony.rdb.execDQL.arg0`, `sink.harmony.rdb.insertSync.arg1` | `transfer.harmony.rdb.insert.arg1_to_base`, `transfer.harmony.rdb.query.base_to_result`, `transfer.harmony.rdb.querySql.arg0_to_result` |
| T5 Sensitive persistence | `source.harmony.lifecycle.onCreate.want.arg0`, `source.harmony.lifecycle.onNewWant.want.arg0`, `source.harmony.network.http.requestAsync.callback.arg0`, `source.harmony.abilitystage.context_call` | `sink.harmony.preferences.put.arg1`, `sink.harmony.preferences.putSync.arg1`, `sink.harmony.globalcontext.setObject.arg1`, `sink.harmony.fs.write.arg1` | `transfer.harmony.preferences.put.arg1_to_base`, `transfer.harmony.preferences.putSync.arg1_to_base`, `transfer.harmony.preferences.get.base_to_result`, `transfer.harmony.preferences.getSync.base_to_result` |
| T6 File operation injection | `source.harmony.router.getParams`, `source.harmony.input.onChange.arg0`, `source.harmony.input.onInput.arg0`, `source.harmony.input.onSubmit.arg0`, `source.harmony.lifecycle.onCreate.want.arg0` | `sink.harmony.fs.open.arg0`, `sink.harmony.fs.write.arg1`, `sink.harmony.fs.rename.arg0`, `sink.harmony.fs.rename.arg1`, `sink.harmony.fs.unlink.arg0` | `transfer.harmony.string.concat.arg0_to_result` |
| T7 Intent/Ability injection | `source.harmony.router.getParams`, `source.harmony.lifecycle.onCreate.want.arg0`, `source.harmony.input.onChange.arg0`, `source.harmony.input.onInput.arg0`, `source.harmony.input.onSubmit.arg0` | `sink.harmony.ability.startAbility.arg0`, `sink.harmony.ability.startAbilityForResult.arg0` | `transfer.harmony.json.parse.arg0_to_result`, `transfer.harmony.json.parse.arg0_to_result.sig`, `transfer.harmony.string.concat.arg0_to_result` |

## Rule Count Snapshot (2026-02-25)

- Sources: 20
- Sinks: 31
- Transfers: 17
- Total effective rules: 68

## Real-project evidence snapshot (default+framework)

- `wanharmony`:
  - stable hit `V2` (`want -> GlobalContext.setObject`)
  - output: `tmp/phase772/framework_step_after_loadcontent_arg0_20260225_wanharmony/summary.json`
- `Homogram (products/phone)`:
  - stable `with_flows=1` under `default+framework` run set
  - output: `tmp/phase772/framework_step_after_loadcontent_arg0_20260225_homogram_phone/summary.json`

## Notes

- Framework rules remain reusable assets; project-private wrappers stay in `project.rules.json`.
- Prefer `method_name_equals`/`callee_signature_equals` + scope constraints before any wider signature fallback.
- For unresolved `@%unk/%unk` ArkIR callsites, signature fallback rules are allowed only when paired with tight endpoint constraints.

## Storage/Event Boundary Clarification (2026-03-01)

- `PersistentStorage`:
  - Semantic position: **same key-space persistence facade** over AppStorage-like state.
  - Engine handling: unified in `AppStorageModeling` as the same storage family (`set/get/setOrCreate/prop/link + persistProp write`).
  - Implication: no independent second model is introduced, avoiding duplicate bridging and rule conflicts.

- `CommonEvent`:
  - Current boundary: treated as **cross-process channel**, not modeled as default end-to-end flow in Phase 7.
  - Rule-side observation retained: `source.harmony.commonevent.subscribe.callback.arg0` and `sink.harmony.commonevent.publish.arg1` are present but `enabled=false`.
  - Activation policy: only consider enabling/expanding after stable real-project evidence confirms benefit and acceptable precision.
