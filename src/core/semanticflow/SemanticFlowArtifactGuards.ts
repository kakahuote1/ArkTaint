import type {
    SemanticFlowAnchor,
    SemanticFlowArtifactClass,
    SemanticFlowSlicePackage,
    SemanticFlowSummary,
} from "./SemanticFlowTypes";

export interface SemanticFlowArtifactSuppression {
    resolution: "no-transfer";
    reason: string;
}

export function suppressInvalidResolvedSemanticFlowArtifact(
    anchor: SemanticFlowAnchor,
    summary: SemanticFlowSummary,
    classification: SemanticFlowArtifactClass,
    slice: SemanticFlowSlicePackage,
): SemanticFlowArtifactSuppression | undefined {
    if (classification === "rule" && summary.ruleKind === "sink" && isAbilityRestorationOrchestrationSink(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "ability_orchestration_helper_is_not_project_sink",
        };
    }
    if (classification === "rule" && summary.ruleKind === "sink" && isUiRenderingOrStyleHelper(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "ui_rendering_or_style_helper_is_not_project_sink",
        };
    }
    if (classification === "rule" && summary.ruleKind === "sink" && isPageActionDelegator(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_action_delegator_is_not_project_sink",
        };
    }
    if (classification === "rule" && summary.ruleKind === "sink" && isPageLocalStatePreparationHelper(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_local_state_helper_is_not_project_sink",
        };
    }
    if (classification === "rule" && summary.ruleKind === "sink" && isPageControllerOrchestrationSink(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_controller_orchestration_is_not_project_sink",
        };
    }
    if (classification === "rule" && summary.ruleKind === "sink" && isInternalNavigationDispatch(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "internal_navigation_dispatch_is_not_project_sink",
        };
    }
    return undefined;
}

export function suppressKnownNonArtifactSemanticFlowCandidate(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): SemanticFlowArtifactSuppression | undefined {
    if (isAbilityRestorationOrchestrationSink(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "ability_orchestration_helper_is_not_project_asset",
        };
    }
    if (isUiRenderingOrStyleHelper(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "ui_rendering_or_style_helper_is_not_project_asset",
        };
    }
    if (isPageActionDelegator(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_action_delegator_is_not_project_asset",
        };
    }
    if (isPageLocalStatePreparationHelper(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_local_state_helper_is_not_project_asset",
        };
    }
    if (isPageControllerOrchestrationSink(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "page_controller_orchestration_is_not_project_asset",
        };
    }
    if (isInternalNavigationDispatch(anchor, slice)) {
        return {
            resolution: "no-transfer",
            reason: "internal_navigation_dispatch_is_not_project_asset",
        };
    }
    return undefined;
}

function isAbilityRestorationOrchestrationSink(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const signature = `${anchor.methodSignature || ""} ${anchor.owner || ""} ${anchor.filePath || ""}`;
    const surface = String(anchor.surface || "");
    if (!/ability|entryability|stage/i.test(signature)) return false;
    if (!/(want|launchparam|windowstage|permission|grantstatus|localstorage)/i.test(signature)) return false;
    if (!/(restore|restor|recover|migrat|permission|access|window|stage|full|load|init|check)/i.test(surface)) return false;

    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;
    if (hasDisclosureOrExecutionTerminal(methodSnippet)) return false;
    return hasOfficialAbilityOrchestrationEvidence(methodSnippet);
}

function methodSnippetText(slice: SemanticFlowSlicePackage): string {
    return (slice.snippets || [])
        .filter(snippet => snippet.label === "method" || snippet.label === "method-body")
        .map(snippet => snippet.code || "")
        .join("\n");
}

function hasOfficialAbilityOrchestrationEvidence(code: string): boolean {
    return /\b(AppStorage|LocalStorage|restoreWindowStage|windowStage|abilityAccessCtrl|requestPermissionsFromUser|checkAccessToken|bundleManager)\b/i.test(code);
}

function hasDisclosureOrExecutionTerminal(code: string): boolean {
    return hasDirectDisclosureOrExecutionTerminal(code)
        || /\b[A-Za-z_$][A-Za-z0-9_$]*(?:Api|Request|Client)\s*\(/.test(code);
}

function hasDirectDisclosureOrExecutionTerminal(code: string): boolean {
    return /\b(?:hilog|console)\s*\.\s*(?:debug|info|warn|error|fatal|log)\s*\(/i.test(code)
        || /\b(?:http|request|fetch|axios|XMLHttpRequest)\b/i.test(code)
        || /\b(?:executeSql|rawQuery|querySql|send|emit|publish|postMessage)\s*\(/i.test(code);
}

function isUiRenderingOrStyleHelper(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const signature = `${anchor.methodSignature || ""} ${anchor.owner || ""} ${anchor.filePath || ""}`;
    if (!/(^|\/)(pages?|views?|components?)\//i.test(signature.replace(/\\/g, "/"))) {
        return false;
    }
    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;
    if (hasDisclosureOrExecutionTerminal(methodSnippet)) return false;
    if (/\bsetSystemBar\s*\(/.test(methodSnippet)) return true;
    const uiEvidenceCount = [
        /\b(?:Column|Row|Stack|Tabs|TabContent|Text|Image|Button|List|Swiper|Scroll|Blank)\s*\(/,
        /\.(?:width|height|fontSize|fontColor|backgroundColor|margin|padding|align|layoutWeight|visibility)\s*\(/,
        /\b(?:statusBarContentColor|navigationBarContentColor)\b/,
        /\b(?:Resource|Color|FontWeight|Alignment|ButtonType)\b/,
    ].filter(re => re.test(methodSnippet)).length;
    if (uiEvidenceCount < 2) {
        return false;
    }
    return !/\breturn\s+[^;\n]+/.test(methodSnippet);
}

function isPageActionDelegator(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const signature = `${anchor.methodSignature || ""} ${anchor.owner || ""} ${anchor.filePath || ""}`;
    if (!/(^|\/)(pages?|views?|components?)\//i.test(signature.replace(/\\/g, "/"))) {
        return false;
    }
    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;
    if (hasDirectDisclosureOrExecutionTerminal(methodSnippet)) return false;
    if (!/\b[A-Za-z_$][A-Za-z0-9_$]*(?:Api|Request|Client)\s*\(/.test(methodSnippet)) {
        return false;
    }
    return !/\breturn\s+[^;\n]+/.test(methodSnippet);
}

function isPageControllerOrchestrationSink(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const signature = `${anchor.methodSignature || ""} ${anchor.owner || ""} ${anchor.filePath || ""}`;
    const normalizedSignature = signature.replace(/\\/g, "/");
    const inPageOrView = /(^|\/)(pages?|views?)\//i.test(normalizedSignature);
    const inComponent = /(^|\/)components?\//i.test(normalizedSignature);
    if (!inPageOrView && !inComponent) {
        return false;
    }
    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;
    if (/\breturn\s+[^;\n]+/.test(methodSnippet)) return false;
    if (inComponent && !isComponentActionOrchestrationSurface(anchor)) {
        return false;
    }
    if (!hasOfficialSinkEvidence(methodSnippet) && !hasDeeperProjectSinkWrapperCall(methodSnippet)) {
        return false;
    }
    return true;
}

function isComponentActionOrchestrationSurface(anchor: SemanticFlowAnchor): boolean {
    const identity = `${anchor.surface || ""} ${anchor.methodSignature || ""}`;
    return /\b(?:on[A-Z][A-Za-z0-9]*|confirm|submit|save|create|edit|delete|remove|add|select|finish|cancel)\b/i.test(identity);
}

function isPageLocalStatePreparationHelper(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const signature = `${anchor.methodSignature || ""} ${anchor.owner || ""} ${anchor.filePath || ""}`;
    if (!/(^|\/)(pages?|views?)\//i.test(signature.replace(/\\/g, "/"))) {
        return false;
    }
    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;
    if (/\breturn\s+[^;\n]+/.test(methodSnippet)) return false;
    if (hasOfficialSinkEvidence(methodSnippet) || hasDeeperProjectSinkWrapperCall(methodSnippet)) return false;
    const ownerFieldWrites = (methodSnippet.match(/\bthis\.[A-Za-z_$][A-Za-z0-9_$]*\s*=/g) || []).length
        + (methodSnippet.match(/this\.<[^>]+>\s*=/g) || []).length;
    if (ownerFieldWrites === 0) return false;
    return !/\b(?:http|request|fetch|axios|XMLHttpRequest|relationalStore|hilog|console|AppStorage|LocalStorage|PersistentStorage|preferences|distributedKVStore)\b/i.test(methodSnippet);
}

function hasOfficialSinkEvidence(code: string): boolean {
    return hasDirectDisclosureOrExecutionTerminal(code)
        || /\b(?:AppStorage|LocalStorage|PersistentStorage|preferences|distributedKVStore|relationalStore|hilog|console)\b/i.test(code)
        || /\.(?:put|putSync|insert|update|delete|executeSql|querySql|write|writeText|send|emit|publish|postMessage)\s*\(/i.test(code);
}

function hasDeeperProjectSinkWrapperCall(code: string): boolean {
    const wrapperReceiver = "[A-Za-z_$][A-Za-z0-9_$]*(?:Util|Utils|Store|StoreUtil|Db|DB|Database|Manager|Repository|Client|Service|DataSource|Dao|Mapper)";
    const wrapperSinkMethod = "(?:insert|update|delete|execute|executeSql|querySql|insertData|updateData|deleteData|put|putSync|set|post|request|send|log|info|warn|error|write|writeText)";
    const wrapperCall = new RegExp(`\\b${wrapperReceiver}\\s*\\.\\s*${wrapperSinkMethod}\\s*\\(`, "i");
    return /\b[A-Za-z_$][A-Za-z0-9_$]*(?:Api|Request|Client)\s*\(/.test(code)
        || /\bthis\.[A-Za-z_$][A-Za-z0-9_$]*\.(?:insertData|updateData|deleteData|put|putSync|set|post|request|send|log|info|warn|error)\s*\(/i.test(code)
        || /\b[A-Za-z_$][A-Za-z0-9_$]*\.(?:insertData|updateData|deleteData|put|putSync|set|post|request|send|log|info|warn|error)\s*\(/i.test(code)
        || wrapperCall.test(code);
}

function isInternalNavigationDispatch(
    anchor: SemanticFlowAnchor,
    slice: SemanticFlowSlicePackage,
): boolean {
    const identity = `${anchor.surface || ""} ${anchor.owner || ""} ${anchor.methodSignature || ""} ${anchor.filePath || ""}`;
    const methodSnippet = methodSnippetText(slice);
    if (!methodSnippet) return false;

    const combined = `${identity}\n${methodSnippet}`;
    if (!/(router|route|navigation|navpath|hmrouter|approuter|pathstack)/i.test(combined)) {
        return false;
    }
    if (!/\b(?:push|pushAsync|pushUrl|replace|replaceUrl|back|pop|redirect|navigate|openPage|goBack)\b/i.test(combined)) {
        return false;
    }
    if (!hasInternalNavigationEvidence(methodSnippet)) {
        return false;
    }
    return !hasDirectNonNavigationBoundary(methodSnippet);
}

function hasInternalNavigationEvidence(code: string): boolean {
    return /\b(?:HMRouterMgr|router|NavPathStack|AppRouter|Navigation|NavigationPath|pathStack)\b/i.test(code)
        || /\.(?:pushAsync|pushUrl|replaceUrl|back|pop|replace|push)\s*\(/i.test(code)
        || /\b(?:pageUrl|navigationId|routeName|routePath|pathInfo)\b/i.test(code);
}

function hasDirectNonNavigationBoundary(code: string): boolean {
    return /\b(?:hilog|console)\s*\.\s*(?:debug|info|warn|error|fatal|log)\s*\(/i.test(code)
        || /\b(?:http|request|fetch|axios|XMLHttpRequest|WebSocket|socket)\b/i.test(code)
        || /\b(?:relationalStore|preferences|distributedKVStore|fileIo|fs)\b/i.test(code)
        || /\bWeb\s*\(/.test(code)
        || /\.(?:loadUrl|executeJavaScript|put|putSync|insert|update|executeSql|querySql|write|writeText|sendMessage|send|emit|publish|postMessage)\s*\(/i.test(code);
}
