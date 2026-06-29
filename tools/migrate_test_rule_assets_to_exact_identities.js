const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const { Scene } = require("../arkanalyzer/out/src/Scene");
const { SceneConfig } = require("../arkanalyzer/out/src/Config");
const { fromProjectDeclaration } = require("../out/core/api/identity");

const TSJS_CONTAINER_ASSET = require("../out/models/kernel/modules/tsjs/container.js").default;

const SOURCE_DIR_OVERRIDES = new Map([
  ["source_sink_only", "tests/demo/context_sensitive"],
  ["source_precision", "tests/demo/rule_precision_source"],
  ["sink_precision", "tests/demo/rule_precision_sink"],
  ["sanitizer_guard", "tests/demo/rule_precision_sanitizer"],
  ["transfer_only", "tests/demo/rule_transfer"],
  ["transfer_variants", "tests/demo/rule_transfer_variants"],
  ["transfer_precision", "tests/demo/rule_precision_transfer"],
  ["transfer_priority", "tests/demo/transfer_priority"],
  ["transfer_overload_conflicts", "tests/demo/transfer_overload_conflicts"],
  ["harmony_lifecycle_sink_only", "tests/demo/harmony_lifecycle"],
  ["layer_priority/kernel", "tests/fixtures/layer_priority_identity"],
  ["layer_priority/project", "tests/fixtures/layer_priority_identity"],
  ["layer_priority/llm_candidate", "tests/fixtures/layer_priority_identity"],
]);

const LAYER_SOURCE_METHODS = new Map([
  ["source.layer.same", "source_layer_same"],
  ["source.layer.default_only", "source_layer_default_only"],
  ["source.layer.project_only", "source_layer_project_only"],
  ["source.layer.llm_only", "source_layer_llm_only"],
]);

const LEGACY_METHOD_ALIASES = new Map([
  ["source.framework_probe.navpathstack.getparams", {
    methodName: "getParams",
    ownerName: "NavPathStack",
  }],
]);

function abs(file) {
  return path.resolve(ROOT, file);
}

function repoRel(file) {
  return path.relative(ROOT, path.resolve(file)).replace(/\\/g, "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(abs(file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function walkRuleFiles(dir, out = []) {
  const root = abs(dir);
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkRuleFiles(repoRel(full), out);
    } else if (entry.isFile() && entry.name.endsWith(".rules.json")) {
      out.push(repoRel(full));
    }
  }
  return out;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function ruleKeyFromFile(file) {
  return file
    .replace(/\\/g, "/")
    .replace(/^tests\/rules\//, "")
    .replace(/\.rules\.json$/, "");
}

function sourceDirForRuleFile(file) {
  const key = ruleKeyFromFile(file);
  if (SOURCE_DIR_OVERRIDES.has(key)) return SOURCE_DIR_OVERRIDES.get(key);
  const base = key.split("/").pop();
  const demo = `tests/demo/${base}`;
  if (fs.existsSync(abs(demo))) return demo;
  return undefined;
}

const sceneCache = new Map();

function sceneBundle(sourceDir) {
  const resolved = abs(sourceDir);
  if (sceneCache.has(resolved)) return sceneCache.get(resolved);
  if (!fs.existsSync(resolved)) {
    throw new Error(`sourceDir not found: ${sourceDir}`);
  }
  const sceneConfig = new SceneConfig();
  sceneConfig.buildFromProjectDir(resolved);
  const scene = new Scene();
  scene.buildSceneFromProjectDir(sceneConfig);
  scene.inferTypes();
  const byName = new Map();
  for (const method of scene.getMethods()) {
    const name = String(method.getName?.() || "");
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(method);
  }
  const bundle = { scene, byName, methods: scene.getMethods() };
  sceneCache.set(resolved, bundle);
  return bundle;
}

function methodSignature(method) {
  return String(method.getSignature?.()?.toString?.() || "");
}

function methodName(method) {
  return String(method.getName?.() || method.getSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "");
}

function parseRuntimeSignature(signature) {
  const text = String(signature || "");
  const match = /^@([^:]+):\s*(.+)$/.exec(text);
  if (!match) {
    throw new Error(`unexpected Arkanalyzer method signature: ${text}`);
  }
  const file = match[1].replace(/\\/g, "/");
  const tail = match[2];
  const open = tail.indexOf("(");
  const beforeParams = open >= 0 ? tail.slice(0, open) : tail;
  const dot = beforeParams.lastIndexOf(".");
  const ownerName = dot >= 0 ? beforeParams.slice(0, dot) : "file";
  const memberName = dot >= 0 ? beforeParams.slice(dot + 1) : beforeParams;
  return { file, ownerName, memberName };
}

function typeTextOf(value, fallback = "unknown") {
  return String(value?.getType?.()?.toString?.() || value?.toString?.() || fallback).trim() || fallback;
}

function methodParameterTypes(method) {
  const sub = method.getSignature?.()?.getMethodSubSignature?.();
  return (sub?.getParameters?.() || []).map(param => typeTextOf(param));
}

function methodReturnType(method) {
  const sub = method.getSignature?.()?.getMethodSubSignature?.();
  return typeTextOf(sub?.getReturnType?.(), "void");
}

function methodOwnerKind(ownerName) {
  return ownerName.includes("%dflt") || ownerName === "file" ? "namespace" : "class";
}

function methodInvokeKind(method, ownerName) {
  if (methodOwnerKind(ownerName) === "namespace") return "namespace";
  return method.isStatic?.() ? "static" : "instance";
}

function indexedParameters(types) {
  return types.map((type, index) => ({ index, type: { text: type } }));
}

function acceptProjectDeclaration(evidence, label) {
  const result = fromProjectDeclaration(evidence);
  if (result.status !== "accepted") {
    throw new Error(`${label} canonical declaration rejected: ${result.reason}`);
  }
  return result.descriptor.canonicalApiId;
}

function canonicalApiIdForMethod(method) {
  const signature = methodSignature(method);
  const parsed = parseRuntimeSignature(signature);
  const parameterTypes = methodParameterTypes(method);
  const returnType = methodReturnType(method);
  const ownerKind = methodOwnerKind(parsed.ownerName);
  const memberKind = ownerKind === "class" ? "method" : "function";
  return acceptProjectDeclaration({
    domain: "local",
    moduleSpecifier: parsed.file,
    logicalDeclarationFile: parsed.file,
    exportPath: [{ kind: "namespace", name: parsed.ownerName }],
    declarationOwner: {
      kind: ownerKind,
      path: parsed.ownerName.split(".").filter(Boolean),
      normalizedName: parsed.ownerName,
      arkanalyzerName: parsed.ownerName,
    },
    member: {
      kind: memberKind,
      name: parsed.memberName,
      static: ownerKind === "class" ? method.isStatic?.() === true : undefined,
    },
    invoke: { kind: "call" },
    signature: {
      parameters: indexedParameters(parameterTypes),
      returnType: { text: returnType },
    },
    arkanalyzer: {
      declaringFileName: parsed.file,
      declaringNamespacePath: [],
      declaringClassName: parsed.ownerName,
      methodName: parsed.memberName,
      parameterTypes,
      returnType,
      staticFlag: ownerKind === "class" ? method.isStatic?.() === true : false,
    },
    declarationLocations: [{ file: parsed.file }],
  }, signature);
}

function canonicalApiIdForEntryMethod(method) {
  const signature = methodSignature(method);
  const parsed = parseRuntimeSignature(signature);
  const parameterTypes = methodParameterTypes(method);
  const name = methodName(method);
  return acceptProjectDeclaration({
    domain: "local",
    moduleSpecifier: parsed.file,
    logicalDeclarationFile: parsed.file,
    exportPath: [{ kind: "entry", name: `component.${name}` }],
    declarationOwner: {
      kind: "entry",
      path: [`component.${name}`],
      normalizedName: `component.${name}`,
      arkanalyzerName: `component.${name}`,
    },
    member: { kind: "lifecycle", name: `test.case.${name}` },
    invoke: { kind: "entry" },
    signature: {
      parameters: indexedParameters(parameterTypes),
      returnType: { text: "void" },
    },
    arkanalyzer: {
      declaringFileName: parsed.file,
      declaringNamespacePath: [],
      declaringClassName: parsed.ownerName,
      methodName: parsed.memberName,
      parameterTypes,
      returnType: methodReturnType(method),
      staticFlag: false,
    },
    declarationLocations: [{ file: parsed.file }],
  }, signature);
}

function stableSuffix(text) {
  return String(text || "")
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "method";
}

function invokeSurfaceFromMethod(oldSurface, method, surfaceId) {
  const signature = methodSignature(method);
  const parsed = parseRuntimeSignature(signature);
  const parameterTypes = methodParameterTypes(method);
  const returnType = methodReturnType(method);
  const invokeKind = methodInvokeKind(method, parsed.ownerName);
  const canonicalApiId = canonicalApiIdForMethod(method);
  return {
    ...oldSurface,
    surfaceId,
    kind: "invoke",
    canonicalApiId,
    modulePath: parsed.file,
    ownerName: parsed.ownerName,
    functionName: invokeKind === "namespace" ? parsed.memberName : undefined,
    methodName: parsed.memberName,
    invokeKind,
    argCount: parameterTypes.length,
    parameterTypes,
    returnType,
    signatureId: signature,
    runtimeShape: {
      modulePath: parsed.file,
      ownerName: parsed.ownerName,
      functionName: invokeKind === "namespace" ? parsed.memberName : undefined,
      methodName: parsed.memberName,
      invokeKind,
      argCount: parameterTypes.length,
      parameterTypes,
      returnType,
      signatureId: signature,
      arkanalyzerSignature: signature,
    },
    confidence: "certain",
    provenance: {
      ...(oldSurface.provenance || {}),
      source: "manual",
      location: {
        ...(oldSurface.provenance?.location || {}),
        file: parsed.file,
      },
    },
  };
}

function entrySurfaceFromMethod(oldSurface, method, surfaceId) {
  const signature = methodSignature(method);
  const parsed = parseRuntimeSignature(signature);
  const parameterTypes = methodParameterTypes(method);
  const name = methodName(method);
  const canonicalApiId = canonicalApiIdForEntryMethod(method);
  return {
    surfaceId,
    kind: "entry",
    canonicalApiId,
    ownerKind: "component",
    ownerName: name,
    methodName: name,
    phase: "test",
    entryKind: "case",
    signatureId: signature,
    runtimeShape: {
      ownerKind: "component",
      ownerName: name,
      methodName: name,
      phase: "test",
      entryKind: "case",
      parameterTypes,
      returnType: methodReturnType(method),
      signatureId: signature,
      arkanalyzerSignature: signature,
    },
    confidence: "certain",
    provenance: {
      ...(oldSurface.provenance || {}),
      source: "manual",
      location: {
        ...(oldSurface.provenance?.location || {}),
        file: parsed.file,
      },
    },
  };
}

function fieldNameForBinding(surface, binding, templates) {
  for (const ref of binding.effectTemplateRefs || []) {
    const template = templates.get(ref);
    const path = template?.value?.accessPath;
    if (Array.isArray(path) && path.length > 0) return String(path[0]);
  }
  if (surface.propertyName) return String(surface.propertyName).split(".").pop();
  const match = /\.field_read\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(String(surface.surfaceId || ""));
  return match?.[1] || "field";
}

function fieldReadSurfaceFromMethod(oldSurface, method, surfaceId, fieldName) {
  const signature = methodSignature(method);
  const parsed = parseRuntimeSignature(signature);
  const canonicalApiId = acceptProjectDeclaration({
    domain: "local",
    moduleSpecifier: parsed.file,
    logicalDeclarationFile: parsed.file,
    exportPath: [{ kind: "namespace", name: parsed.ownerName }],
    declarationOwner: {
      kind: methodOwnerKind(parsed.ownerName),
      path: parsed.ownerName.split(".").filter(Boolean),
      normalizedName: parsed.ownerName,
      arkanalyzerName: parsed.ownerName,
    },
    member: { kind: "property", name: fieldName },
    invoke: { kind: "property-read" },
    signature: {
      parameters: [],
      returnType: { text: "SyntheticTaintValue" },
    },
    arkanalyzer: {
      declaringFileName: parsed.file,
      declaringNamespacePath: [],
      declaringClassName: parsed.ownerName,
      methodName: parsed.memberName,
      parameterTypes: methodParameterTypes(method),
      returnType: methodReturnType(method),
      staticFlag: false,
    },
    declarationLocations: [{ file: parsed.file }],
  }, `${signature}#field:${fieldName}`);
  return {
    ...oldSurface,
    surfaceId,
    kind: "access",
    canonicalApiId,
    modulePath: parsed.file,
    ownerName: parsed.ownerName,
    propertyName: fieldName,
    accessKind: "read",
    receiverKind: "instance",
    signatureId: signature,
    runtimeShape: {
      modulePath: parsed.file,
      ownerName: parsed.ownerName,
      propertyName: fieldName,
      accessKind: "read",
      returnType: "SyntheticTaintValue",
      signatureId: signature,
      arkanalyzerSignature: signature,
    },
    returnType: "SyntheticTaintValue",
    confidence: "certain",
    provenance: {
      ...(oldSurface.provenance || {}),
      source: "manual",
      location: {
        ...(oldSurface.provenance?.location || {}),
        file: parsed.file,
      },
    },
  };
}

function templateById(asset) {
  return new Map((asset.effectTemplates || []).map(template => [template.id, template]));
}

function builtinSurfaceKey(surface) {
  return [
    surface.modulePath || surface.runtimeShape?.modulePath || "",
    surface.ownerName || surface.runtimeShape?.ownerName || "",
    surface.methodName || surface.functionName || surface.runtimeShape?.methodName || surface.runtimeShape?.functionName || "",
    surface.invokeKind || surface.runtimeShape?.invokeKind || "",
    String(surface.argCount ?? surface.runtimeShape?.argCount ?? ""),
  ].join("\u0000");
}

const BUILTIN_SURFACES_BY_KEY = new Map();
for (const surface of TSJS_CONTAINER_ASSET.surfaces || []) {
  const key = builtinSurfaceKey(surface);
  if (BUILTIN_SURFACES_BY_KEY.has(key)) {
    throw new Error(`duplicate builtin surface identity: ${key}`);
  }
  BUILTIN_SURFACES_BY_KEY.set(key, surface);
}

function templateUsesMapSlot(template) {
  return template?.to?.slotKind === "map"
    || template?.to?.slotKind === "mapkey"
    || template?.from?.endpoint?.slotKind === "map"
    || template?.from?.endpoint?.slotKind === "mapkey";
}

function exactBuiltinSurfaceForLegacySurface(surface, templates, label) {
  const method = surface.methodName || surface.functionName || surface.runtimeShape?.methodName || surface.runtimeShape?.functionName;
  if (!method) return undefined;
  const isMapSemantics = String(surface.surfaceId || "").includes(".map.")
    || templates.some(templateUsesMapSlot);
  if (!isMapSemantics) return undefined;
  const argCount = method === "set" ? 2 : method === "get" ? 1 : surface.argCount;
  const wanted = {
    modulePath: "tsjs.builtin",
    ownerName: "Map",
    methodName: method,
    invokeKind: "instance",
    argCount,
  };
  const builtin = BUILTIN_SURFACES_BY_KEY.get(builtinSurfaceKey(wanted));
  if (!builtin) {
    throw new Error(`${label}: missing exact TSJS builtin surface for Map.${method}/${argCount}`);
  }
  return {
    ...surface,
    surfaceId: surface.surfaceId,
    kind: "invoke",
    canonicalApiId: builtin.canonicalApiId,
    modulePath: builtin.modulePath,
    ownerName: builtin.ownerName,
    methodName: builtin.methodName,
    invokeKind: builtin.invokeKind,
    argCount: builtin.argCount,
    parameterTypes: [...(builtin.parameterTypes || [])],
    returnType: builtin.returnType,
    runtimeShape: {
      ...(builtin.runtimeShape || {}),
      parameterTypes: [...(builtin.runtimeShape?.parameterTypes || builtin.parameterTypes || [])],
    },
    confidence: "certain",
    provenance: {
      ...(surface.provenance || {}),
      source: "manual",
    },
  };
}

function surfaceById(asset) {
  return new Map((asset.surfaces || []).map(surface => [surface.surfaceId, surface]));
}

function sourceKindForBinding(binding, templates) {
  for (const ref of binding.effectTemplateRefs || []) {
    const template = templates.get(ref);
    if (template?.kind === "rule.source") return template.sourceKind;
  }
  return undefined;
}

function extractCaseMethodName(binding, templates) {
  return extractMethodScope(binding, templates).caseName;
}

function extractMethodScope(binding, templates) {
  const texts = [
    binding.bindingId,
    ...(binding.effectTemplateRefs || []),
    ...(binding.effectTemplateRefs || []).map(ref => templates.get(ref)?.id || ""),
  ];
  for (const text of texts) {
    const match = /\.method\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\.([A-Za-z_$%][A-Za-z0-9_$%]*))?/.exec(String(text || ""));
    if (match) {
      return {
        caseName: match[1],
        scopedMethodName: match[2],
      };
    }
  }
  return {};
}

function findExactMethods(bundle, methodNameText, label) {
  const alias = LEGACY_METHOD_ALIASES.get(String(methodNameText || ""));
  const actualMethodName = alias?.methodName || methodNameText;
  let methods = (bundle.byName.get(actualMethodName) || [])
    .filter(method => methodSignature(method));
  if (alias?.ownerName) {
    methods = methods.filter(method => parseRuntimeSignature(methodSignature(method)).ownerName === alias.ownerName);
  }
  if (methods.length === 0) {
    throw new Error(`${label}: method not found: ${methodNameText}`);
  }
  return methods;
}

function findSingleMethodInLegacyOwner(bundle, surface, label) {
  const owner = String(surface.ownerName || surface.runtimeShape?.ownerName || "");
  const legacyMethod = String(surface.methodName || surface.runtimeShape?.methodName || "");
  if (!owner || owner !== legacyMethod) return undefined;
  const candidates = (bundle.methods || [])
    .filter(method => methodSignature(method))
    .filter(method => {
      const parsed = parseRuntimeSignature(methodSignature(method));
      return parsed.ownerName === owner || parsed.ownerName.endsWith(`.${owner}`);
    })
    .filter(method => {
      const name = methodName(method);
      return name && name !== "constructor" && name !== "<init>" && !name.startsWith("%");
    });
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new Error(`${label}: legacy owner ${owner} resolves to multiple methods`);
  }
  return candidates;
}

function legacySurfaceNeedsMigration(surface) {
  const text = JSON.stringify(surface || {});
  if (text.includes("@arktaint/runtime-selector")) return true;
  if (text.includes("@arktaint/local")) return true;
  if (text.includes("@arktaint/test-")) return true;
  return false;
}

function methodNameForLegacySurface(surface, binding, templates) {
  if (surface.kind === "access") {
    const mapped = LAYER_SOURCE_METHODS.get(String(surface.propertyName || ""));
    if (mapped) return mapped;
    const scope = extractMethodScope(binding, templates);
    if (scope.scopedMethodName) return scope.scopedMethodName;
    if (scope.caseName) return scope.caseName;
    return undefined;
  }
  return surface.methodName || surface.functionName || surface.runtimeShape?.methodName || surface.runtimeShape?.functionName;
}

function exactMethodsForLegacySurface(bundle, surface, binding, templates, sourceKind, label) {
  const scope = extractMethodScope(binding, templates);
  const legacyMethodName = sourceKind === "field_read" && scope.caseName
    ? scope.caseName
    : methodNameForLegacySurface(surface, binding, templates);
  if (!legacyMethodName) {
    throw new Error(`${label}: cannot derive method name for legacy surface ${surface.surfaceId}`);
  }
  let methods;
  try {
    methods = findExactMethods(bundle, legacyMethodName, label);
  } catch (error) {
    const ownerScoped = findSingleMethodInLegacyOwner(bundle, surface, label);
    if (!ownerScoped) throw error;
    methods = ownerScoped;
  }
  if (sourceKind === "seed_local_name" && scope.caseName && scope.scopedMethodName) {
    methods = methods.filter(method => methodSignature(method).replace(/\\/g, "/").includes(`/${scope.caseName}.ets`));
    if (methods.length === 0) {
      throw new Error(`${label}: method ${scope.scopedMethodName} not found under ${scope.caseName}.ets`);
    }
  }
  return methods;
}

function addUniqueById(map, item, keyName) {
  const id = item[keyName];
  const existing = map.get(id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
    throw new Error(`conflicting generated ${keyName}: ${id}`);
  }
  map.set(id, item);
}

function cloneTemplateWithSuffix(template, suffix) {
  return {
    ...template,
    id: `${template.id}.for.${suffix}`,
  };
}

function cloneBindingWithTarget(binding, surface, refs, suffix) {
  return {
    ...binding,
    bindingId: suffix ? `${binding.bindingId}.for.${suffix}` : binding.bindingId,
    surfaceId: surface.surfaceId,
    canonicalApiId: surface.canonicalApiId,
    effectTemplateRefs: refs,
    completeness: "complete",
    confidence: "certain",
  };
}

function migrateAssetFile(file, options) {
  const asset = readJson(file);
  if (!asset || asset.plane !== "rule" || !Array.isArray(asset.surfaces)) {
    return { changed: false };
  }
  const needsMigration = (asset.surfaces || []).some(legacySurfaceNeedsMigration);
  if (!needsMigration) {
    return { changed: false };
  }
  const sourceDir = sourceDirForRuleFile(file);
  if (!sourceDir) {
    if (options.allowMissingSourceDir) return { changed: false, skipped: file };
    throw new Error(`${file}: cannot resolve sourceDir`);
  }
  const before = canonicalJson(asset);
  const bundle = sceneBundle(sourceDir);
  const oldSurfaces = surfaceById(asset);
  const oldTemplates = templateById(asset);
  const generatedSurfaces = new Map();
  const generatedTemplates = new Map();
  const generatedBindings = [];

  for (const binding of asset.bindings || []) {
    const surface = oldSurfaces.get(binding.surfaceId);
    if (!surface) {
      throw new Error(`${file}:${binding.bindingId}: missing surface ${binding.surfaceId}`);
    }
    const refs = binding.effectTemplateRefs || [];
    const templates = refs.map(ref => {
      const template = oldTemplates.get(ref);
      if (!template) throw new Error(`${file}:${binding.bindingId}: missing template ${ref}`);
      return template;
    });
    const sourceKind = sourceKindForBinding(binding, oldTemplates);

    if (binding.role === "source" && sourceKind === "entry_param") {
      const caseMethodName = extractCaseMethodName(binding, oldTemplates);
      const entryMethodName = caseMethodName || methodNameForLegacySurface(surface, binding, oldTemplates);
      if (!entryMethodName) {
        throw new Error(`${file}:${binding.bindingId}: entry_param source lacks exact entry method identity`);
      }
      const methods = findExactMethods(bundle, entryMethodName, `${file}:${binding.bindingId}`);
      const multi = methods.length > 1;
      for (const method of methods) {
        const suffix = stableSuffix(methodSignature(method));
        const entrySurfaceId = multi
          ? `${surface.surfaceId}.for.${suffix}`
          : `${surface.surfaceId}.method.${entryMethodName}`;
        const entrySurface = entrySurfaceFromMethod(surface, method, entrySurfaceId);
        addUniqueById(generatedSurfaces, entrySurface, "surfaceId");
        const newRefs = [];
        for (const template of templates) {
          const nextTemplate = multi ? cloneTemplateWithSuffix(template, suffix) : template;
          addUniqueById(generatedTemplates, nextTemplate, "id");
          newRefs.push(nextTemplate.id);
        }
        generatedBindings.push(cloneBindingWithTarget(binding, entrySurface, newRefs, multi ? suffix : undefined));
      }
      continue;
    }

    if (!legacySurfaceNeedsMigration(surface)) {
      addUniqueById(generatedSurfaces, surface, "surfaceId");
      for (const template of templates) addUniqueById(generatedTemplates, template, "id");
      generatedBindings.push(binding);
      continue;
    }

    const builtinSurface = exactBuiltinSurfaceForLegacySurface(
      surface,
      templates,
      `${file}:${binding.bindingId}`,
    );
    if (builtinSurface) {
      addUniqueById(generatedSurfaces, builtinSurface, "surfaceId");
      for (const template of templates) addUniqueById(generatedTemplates, template, "id");
      generatedBindings.push(cloneBindingWithTarget(binding, builtinSurface, refs, undefined));
      continue;
    }

    const methods = exactMethodsForLegacySurface(
      bundle,
      surface,
      binding,
      oldTemplates,
      sourceKind,
      `${file}:${binding.bindingId}`,
    );
    const multi = methods.length > 1;
    for (const method of methods) {
      const suffix = stableSuffix(methodSignature(method));
      const generatedSurfaceId = (multi || surface.kind === "access" || sourceKind === "field_read")
        ? `${surface.surfaceId}.for.${suffix}`
        : surface.surfaceId;
      const invokeSurface = sourceKind === "field_read"
        ? fieldReadSurfaceFromMethod(surface, method, generatedSurfaceId, fieldNameForBinding(surface, binding, oldTemplates))
        : invokeSurfaceFromMethod(surface, method, generatedSurfaceId);
      addUniqueById(generatedSurfaces, invokeSurface, "surfaceId");
      const newRefs = [];
      for (const template of templates) {
        const nextTemplate = multi ? cloneTemplateWithSuffix(template, suffix) : template;
        addUniqueById(generatedTemplates, nextTemplate, "id");
        newRefs.push(nextTemplate.id);
      }
      generatedBindings.push(cloneBindingWithTarget(binding, invokeSurface, newRefs, multi ? suffix : undefined));
    }
  }

  asset.surfaces = [...generatedSurfaces.values()];
  asset.bindings = generatedBindings;
  asset.effectTemplates = [...generatedTemplates.values()];
  const after = canonicalJson(asset);
  if (before !== after) {
    writeJson(file, asset);
    return { changed: true };
  }
  return { changed: false };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const options = {
    allowMissingSourceDir: args.has("--allow-missing-source-dir"),
  };
  const files = walkRuleFiles("tests/rules");
  const changed = [];
  const skipped = [];
  for (const file of files) {
    const result = migrateAssetFile(file, options);
    if (result.changed) changed.push(file);
    if (result.skipped) skipped.push(file);
  }
  console.log(JSON.stringify({ changed: changed.length, files: changed, skipped }, null, 2));
}

main();
