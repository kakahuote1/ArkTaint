import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkClass } from "../../../arkanalyzer/out/src/core/model/ArkClass";
import {
    CALLBACK_METHOD_NAME,
    LIFECYCLE_METHOD_NAME,
} from "../../../arkanalyzer/out/src/utils/entryMethodUtils";
import { collectLifecycleParamSeeds, LifecycleParamSeedSpec } from "./LifecycleParamSeeder";
import {
    HarmonySeedCollectionArgs,
    HarmonySeedCollectionResult,
    mergeHarmonySeedCollectionResults,
} from "./HarmonySeedTypes";

/**
 * 对应 TaintPropagationEngine 所需的参数类型
 */
export interface HarmonyLifecycleSeedCollectionArgs extends HarmonySeedCollectionArgs {
    scene: Scene;
    pag: Pag;
}

/**
 * 对应 TaintPropagationEngine 所需的返回类型
 * 导出此类型以解决 TaintPropagationEngine 里的“没有导出的成员”报错
 */
export type HarmonyLifecycleSeedCollectionResult = HarmonySeedCollectionResult;

const UI_ABILITY_WANT_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.lifecycle.want_param",
    methodNames: ["onCreate", "onNewWant"],
    paramNameIncludes: ["want"],
    paramTypeIncludes: ["want"],
    matchMode: "name_and_type",
    targetFieldPaths: [["parameters"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: false,
};

const extensionMethodNames = new Set<string>([
    "onAddForm",
    "onUpdateForm",
    "onFormEvent",
    "onCastToNormalForm",
    "onRemoveForm",
    "onAcquireFormState",
]);

for (const name of LIFECYCLE_METHOD_NAME) {
    if (name.toLowerCase().includes("form")) {
        extensionMethodNames.add(name);
    }
}
for (const name of CALLBACK_METHOD_NAME) {
    if (name.toLowerCase().includes("form")) {
        extensionMethodNames.add(name);
    }
}

const EXTENSION_WANT_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.extension.want_param",
    methodNames: [...extensionMethodNames],
    paramNameIncludes: ["want"],
    paramTypeIncludes: ["want"],
    matchMode: "name_and_type",
    targetFieldPaths: [["parameters"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: false,
};

const EXTENSION_FORM_BINDING_DATA_SPEC: LifecycleParamSeedSpec = {
    sourceRuleId: "harmony.extension.form_binding_data",
    methodNames: [...extensionMethodNames],
    paramNameIncludes: ["formbindingdata", "form_binding_data", "formdata"],
    matchMode: "name_only",
    targetFieldPaths: [["data"], ["value"], ["payload"], ["content"]],
    fallbackSeedRootWhenNoPointsTo: true,
    seedRootAlso: true,
};

/**
 * 现有的种子收集逻辑：识别生命周期中的敏感参数（如 want）
 */
export function collectHarmonyLifecycleSeeds(
    args: HarmonyLifecycleSeedCollectionArgs
): HarmonyLifecycleSeedCollectionResult {
    const uiAbilitySeeds = collectLifecycleParamSeeds({
        scene: args.scene,
        pag: args.pag,
        emptyContextId: args.emptyContextId,
        allowedMethodSignatures: args.allowedMethodSignatures,
        specs: [UI_ABILITY_WANT_SPEC],
    });

    const extensionSeeds = collectLifecycleParamSeeds({
        scene: args.scene,
        pag: args.pag,
        emptyContextId: args.emptyContextId,
        allowedMethodSignatures: args.allowedMethodSignatures,
        specs: [EXTENSION_WANT_SPEC, EXTENSION_FORM_BINDING_DATA_SPEC],
    });

    return mergeHarmonySeedCollectionResults([uiAbilitySeeds, extensionSeeds]);
}

/**
 * HapFlow 论文 3.2 节复现：构建虚拟入口 HarmonyMain
 * 通过扫描生命周期函数和 UI 回调，建立统一的分析入口
 */
export function buildVirtualHarmonyMain(scene: Scene): ArkMethod {
    const mainMethod = new ArkMethod();
    // 修正：使用 (obj as any) 绕过 arkanalyzer 内部 API 限制
    (mainMethod as any).name = "HarmonyMain"; 

    // 1. 提取所有静态初始化方法（论文 Figure 4 第一阶段）
    const staticInits = scene.getMethods().filter(m => m.getName() === "%static_init");

    // 2. 提取 Ability 组件和 Struct 的生命周期函数（论文 Table 1）
    const lifecycles: ArkMethod[] = [];
    for (const cls of scene.getClasses()) {
        for (const m of cls.getMethods()) {
            if (LIFECYCLE_METHOD_NAME.includes(m.getName())) {
                lifecycles.push(m);
            }
        }
    }

    // 3. 提取声明式 UI 中的隐式回调（论文 3.2：onClick, onClick 等）
    const callbacks = collectUICallbacks(scene);

    // 4. 将所有识别到的方法暂存，供分析流程（analyzeRunner）激活可达性分析
    // 模拟论文图 4 中的循环分支
    (mainMethod as any).hapFlowCollectedEntries = [...staticInits, ...lifecycles, ...callbacks];

    return mainMethod;
}

/**
 * HapFlow 算法：扫描 build() 方法，自动提取隐式绑定的匿名回调函数
 */
function collectUICallbacks(scene: Scene): ArkMethod[] {
    const callbacks: ArkMethod[] = [];
    for (const cls of scene.getClasses()) {
        // 查找 ArkUI 的核心渲染方法 build()
        const buildM = cls.getMethods().find(m => m.getName() === "build");
        if (!buildM || !buildM.getCfg()) continue;

        for (const stmt of buildM.getCfg()!.getStmts()) {
            if (stmt.containsInvokeExpr?.()) {
                const expr = stmt.getInvokeExpr();
                if (!expr) continue;
                
                // 识别作为参数传递给 UI 组件的匿名函数（通常以 %AM 开头）
                for (const arg of expr.getArgs()) {
                    const argStr = arg.toString();
                    if (argStr.startsWith("%AM")) {
                        // 在场景中根据名称查找该方法体
                        const cb = scene.getMethods().find(m => m.getName() === argStr);
                        if (cb) callbacks.push(cb);
                    }
                }
            }
        }
    }
    return callbacks;
}
