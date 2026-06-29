const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INVENTORY = "internal_docs/security_asset_iteration/official_api_semantic_inventory.json";

const {
  fromOfficialDeclaration,
  fromProjectDeclaration,
} = require(path.resolve(ROOT, "out/core/api/identity"));
const {
  assertValidCanonicalApiId,
  parseCanonicalApiId,
  splitCanonicalParameterEntries,
} = require(path.resolve(ROOT, "out/core/api/identity/CanonicalApiId"));

function abs(file) {
  return path.resolve(ROOT, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(abs(file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function walk(dir, predicate, out = []) {
  const root = abs(dir);
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      walk(rel, predicate, out);
    } else if (predicate(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function cleanType(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isUnknown(value) {
  const text = cleanType(value).toLowerCase();
  if (!text) return true;
  if (text === "unknown" || text === "%unk" || text === "@unk" || text === "@%unk/%unk") return true;
  return text.includes("%unk") || text.includes("@unk") || /\bunknown\b/.test(text);
}

function cleanParamName(name) {
  return String(name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim() || undefined;
}

function isRestParam(api, param) {
  const name = cleanParamName(param?.name);
  if (String(param?.name || "").startsWith("...")) return true;
  return !!name && new RegExp(`\\.\\.\\.\\s*${escapeRegExp(name)}\\b`).test(String(api.signature || ""));
}

function isOptionalParam(api, param) {
  const name = cleanParamName(param?.name);
  if (String(param?.name || "").endsWith("?")) return true;
  return !!name && new RegExp(`\\b${escapeRegExp(name)}\\?\\s*:`).test(String(api.signature || ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function returnTypeForOfficialApi(api) {
  const explicit = cleanType(api.returnType);
  if (explicit) return explicit;
  if (api.kind === "constructor") return ownerPathForOfficialApi(api).slice(-1)[0] || "constructor";
  return "void";
}

function parameterTypeForOfficialParam(param) {
  const text = cleanType(param?.type);
  if (isUnknown(text)) {
    throw new Error(`official declaration parameter type is missing for ${JSON.stringify(param)}`);
  }
  return text;
}

function isStaticOfficialApi(api) {
  return /^static\b/.test(String(api.signature || "").trim());
}

function ownerPathForOfficialApi(api) {
  const context = (api.context || []).map(value => String(value || "").trim()).filter(Boolean);
  if (context.length > 0) return context;
  if (api.kind === "function") return [api.name || "file"];
  return [api.name || "OfficialApi"];
}

function ownerNameForOfficialApi(api) {
  return ownerPathForOfficialApi(api).join(".");
}

function moduleSpecifierForOfficialFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/").trim();
  const module = /^api\/(@.+)\.d\.(ts|ets)$/.exec(normalized);
  if (module) return module[1];
  return normalized;
}

function domainForOfficialApi(api) {
  const file = String(api.file || "");
  if (file.includes("@internal/component/ets/")) return "arkui";
  if (file.includes("tsjs")) return "tsjs";
  return "openharmony";
}

function exportPathForOfficialApi(api, ownerName) {
  if (api.file && api.file.includes("@internal/component/ets/") && /Interface$/.test(ownerName || "")) {
    return [{ kind: "component", name: ownerName.replace(/Interface$/, "") }];
  }
  if (api.file && api.file.includes("@internal/component/ets/") && /Attribute$/.test(ownerName || "")) {
    return [{ kind: "component", name: ownerName.replace(/Attribute$/, "") }];
  }
  if (api.kind === "function" && (api.context || []).length > 0) return [{ kind: "default", name: ownerName }];
  if (api.kind === "function") return [{ kind: "named", name: api.name }];
  return [{ kind: "namespace", name: ownerName }];
}

function declarationOwnerKindForOfficialApi(api) {
  if (api.kind === "call-signature") return "interface";
  if (api.kind === "method" || api.kind === "constructor") return "class";
  if (api.kind === "property") return "namespace";
  return "namespace";
}

function memberForOfficialApi(api) {
  if (api.kind === "constructor") return { kind: "constructor", name: "constructor" };
  if (api.kind === "property") return { kind: "property", name: api.name };
  if (api.kind === "function") return { kind: "function", name: api.name };
  if (api.kind === "call-signature") return { kind: "method", name: api.name || "call", static: false };
  return { kind: "method", name: api.name, static: isStaticOfficialApi(api) };
}

function invokeForOfficialApi(api, role) {
  if (api.kind === "constructor") return "new";
  if (api.kind === "property") return role === "source" || role === "load" ? "property-read" : "property-write";
  return "call";
}

function declarationEvidenceForOfficialApi(api, role) {
  const ownerPath = ownerPathForOfficialApi(api);
  const ownerName = ownerPath.join(".");
  const member = memberForOfficialApi(api);
  return {
    domain: domainForOfficialApi(api),
    moduleSpecifier: moduleSpecifierForOfficialFile(api.file || ""),
    logicalDeclarationFile: String(api.file || "").replace(/\\/g, "/").trim(),
    exportPath: exportPathForOfficialApi(api, ownerName),
    declarationOwner: {
      kind: declarationOwnerKindForOfficialApi(api),
      path: ownerPath,
      normalizedName: ownerName,
      arkanalyzerName: ownerName,
    },
    member,
    invoke: { kind: invokeForOfficialApi(api, role) },
    signature: {
      parameters: (api.parameters || []).map((param, index) => ({
        index,
        name: cleanParamName(param?.name),
        optional: isOptionalParam(api, param),
        rest: isRestParam(api, param),
        type: { text: parameterTypeForOfficialParam(param) },
      })),
      returnType: { text: returnTypeForOfficialApi(api) },
    },
    arkanalyzer: api.kind === "property" ? undefined : {
      declaringFileName: String(api.file || "").replace(/\\/g, "/").trim(),
      declaringNamespacePath: [],
      declaringClassName: ownerName,
      methodName: api.kind === "constructor" ? "constructor" : api.name,
      parameterTypes: (api.parameters || []).map(parameterTypeForOfficialParam),
      returnType: returnTypeForOfficialApi(api),
      staticFlag: member.static === true,
    },
    declarationLocations: [{ file: String(api.file || "").replace(/\\/g, "/").trim(), line: api.line }],
  };
}

function buildOfficialCanonicalApiId(api, role) {
  const result = fromOfficialDeclaration(declarationEvidenceForOfficialApi(api, role));
  if (result.status !== "accepted") {
    throw new Error(`cannot build official canonicalApiId for ${api.id}: ${result.reason}`);
  }
  return result.descriptor.canonicalApiId;
}

function runtimeShapeForOfficialApi(api, role) {
  const ownerName = ownerNameForOfficialApi(api);
  const base = {
    modulePath: moduleSpecifierForOfficialFile(api.file || ""),
    argCount: (api.parameters || []).length,
    parameterTypes: (api.parameters || []).map(parameterTypeForOfficialParam),
    returnType: returnTypeForOfficialApi(api),
    signatureId: api.id,
    arkanalyzerSignature: api.id,
  };
  if (api.kind === "constructor") return { ...base, className: ownerName, invokeKind: "construct" };
  if (api.kind === "property") {
    return {
      modulePath: base.modulePath,
      ownerName,
      propertyName: api.name,
      returnType: base.returnType,
      signatureId: api.id,
      arkanalyzerSignature: api.id,
      accessKind: role === "source" || role === "load" ? "read" : "write",
    };
  }
  const isFunction = api.kind === "function" || ownerName === api.name;
  return {
    ...base,
    ownerName: isFunction ? undefined : ownerName,
    functionName: isFunction ? api.name : undefined,
    methodName: isFunction ? undefined : api.name,
    invokeKind: isFunction ? "free-function" : (isStaticOfficialApi(api) ? "static" : "instance"),
  };
}

function applyOfficialApiSurface(surface, api, role) {
  const canonicalApiId = buildOfficialCanonicalApiId(api, role);
  const runtimeShape = runtimeShapeForOfficialApi(api, role);
  surface.canonicalApiId = canonicalApiId;
  surface.runtimeShape = runtimeShape;
  surface.modulePath = runtimeShape.modulePath;
  surface.signatureId = api.id;
  if (surface.kind === "construct") {
    surface.className = runtimeShape.className;
    surface.argCount = runtimeShape.argCount;
    surface.parameterTypes = runtimeShape.parameterTypes;
    surface.returnType = runtimeShape.returnType;
    return;
  }
  if (surface.kind === "access") {
    surface.ownerName = runtimeShape.ownerName;
    surface.propertyName = runtimeShape.propertyName;
    surface.accessKind = runtimeShape.accessKind;
    return;
  }
  if (surface.kind === "invoke") {
    delete surface.ownerName;
    delete surface.functionName;
    delete surface.methodName;
    if (runtimeShape.ownerName) surface.ownerName = runtimeShape.ownerName;
    if (runtimeShape.functionName) surface.functionName = runtimeShape.functionName;
    if (runtimeShape.methodName) surface.methodName = runtimeShape.methodName;
    surface.invokeKind = runtimeShape.invokeKind;
    surface.argCount = runtimeShape.argCount;
    surface.parameterTypes = runtimeShape.parameterTypes;
    surface.returnType = runtimeShape.returnType;
  }
}

const TSJS_DECLARATIONS = new Map();

function addTsjs(owner, method, invokeKind, parameterTypes, returnType, options = {}) {
  TSJS_DECLARATIONS.set(`${owner}.${method}.${invokeKind}`, {
    owner,
    method,
    invokeKind,
    parameterTypes,
    returnType,
    optional: new Set(options.optional || []),
    rest: new Set(options.rest || []),
  });
}

addTsjs("Array", "push", "instance", ["any"], "number", { rest: [0] });
addTsjs("Array", "pop", "instance", [], "any");
addTsjs("Map", "set", "instance", ["any", "any"], "Map");
addTsjs("Map", "get", "instance", ["any"], "any");
addTsjs("Set", "add", "instance", ["any"], "Set");
addTsjs("Set", "has", "instance", ["any"], "boolean");
addTsjs("Reflect", "get", "static", ["object", "PropertyKey"], "any");
addTsjs("Reflect", "ownKeys", "static", ["object"], "Array<PropertyKey>");
addTsjs("Reflect", "apply", "static", ["Function", "any", "ArrayLike<any>"], "any");
addTsjs("Reflect", "construct", "static", ["Function", "ArrayLike<any>", "Function"], "object", { optional: [2] });
addTsjs("Reflect", "getOwnPropertyDescriptor", "static", ["object", "PropertyKey"], "PropertyDescriptor | undefined");
addTsjs("Object", "assign", "static", ["object", "any[]"], "object", { rest: [1] });
addTsjs("Object", "keys", "static", ["object"], "Array<string>");
addTsjs("Object", "values", "static", ["object"], "Array<any>");
addTsjs("Object", "entries", "static", ["object"], "Array<any>");
addTsjs("Object", "getOwnPropertyDescriptors", "static", ["object"], "Array<any>");
addTsjs("Object", "freeze", "static", ["object"], "object");
addTsjs("Object", "seal", "static", ["object"], "object");
addTsjs("Object", "getOwnPropertyNames", "static", ["any"], "Array<string>");
addTsjs("Object", "preventExtensions", "static", ["object"], "object");
addTsjs("Object", "create", "static", ["object | null"], "object");
addTsjs("WeakRef", "deref", "instance", [], "any | undefined");
addTsjs("String", "concat", "instance", ["string[]"], "string", { rest: [0] });
addTsjs("String", "toString", "instance", [], "string");
addTsjs("String", "toLocaleString", "instance", [], "string");
addTsjs("String", "valueOf", "instance", [], "string");
addTsjs("String", "slice", "instance", ["number", "number"], "string", { optional: [0, 1] });
addTsjs("String", "substring", "instance", ["number", "number"], "string", { optional: [0, 1] });
addTsjs("String", "substr", "instance", ["number", "number"], "string", { optional: [0, 1] });
addTsjs("String", "trim", "instance", [], "string");
addTsjs("String", "trimStart", "instance", [], "string");
addTsjs("String", "trimEnd", "instance", [], "string");
addTsjs("String", "trimLeft", "instance", [], "string");
addTsjs("String", "trimRight", "instance", [], "string");
addTsjs("String", "toUpperCase", "instance", [], "string");
addTsjs("String", "toLowerCase", "instance", [], "string");
addTsjs("String", "repeat", "instance", ["number"], "string");
addTsjs("String", "charAt", "instance", ["number"], "string");
addTsjs("String", "normalize", "instance", ["string"], "string", { optional: [0] });
addTsjs("String", "toLocaleLowerCase", "instance", ["string | string[]"], "string", { optional: [0] });
addTsjs("String", "toLocaleUpperCase", "instance", ["string | string[]"], "string", { optional: [0] });
addTsjs("String", "replace", "instance", ["string | RegExp", "string | ((substring: string, ...args: any[]) => string)"], "string");
addTsjs("String", "replaceAll", "instance", ["string | RegExp", "string | ((substring: string, ...args: any[]) => string)"], "string");
addTsjs("String", "raw", "static", ["TemplateStringsArray", "any[]"], "string", { rest: [1] });
addTsjs("String", "padStart", "instance", ["number", "string"], "string", { optional: [1] });
addTsjs("String", "padEnd", "instance", ["number", "string"], "string", { optional: [1] });
addTsjs("String", "split", "instance", ["string | RegExp", "number"], "Array<string>", { optional: [0, 1] });
addTsjs("URLSearchParams", "set", "instance", ["string", "string"], "void");
addTsjs("URLSearchParams", "append", "instance", ["string", "string"], "void");
addTsjs("URLSearchParams", "get", "instance", ["string"], "string | null");
addTsjs("URLSearchParams", "getAll", "instance", ["string"], "Array<string>");
addTsjs("URLSearchParams", "toString", "instance", [], "string");
addTsjs("FormData", "set", "instance", ["string", "FormDataEntryValue"], "void");
addTsjs("FormData", "append", "instance", ["string", "FormDataEntryValue"], "void");
addTsjs("FormData", "get", "instance", ["string"], "FormDataEntryValue | null");
addTsjs("FormData", "getAll", "instance", ["string"], "Array<FormDataEntryValue>");
addTsjs("FormData", "entries", "instance", [], "IterableIterator<[string, FormDataEntryValue]>");
addTsjs("FormData", "values", "instance", [], "IterableIterator<FormDataEntryValue>");
addTsjs("Headers", "set", "instance", ["string", "string"], "void");
addTsjs("Headers", "append", "instance", ["string", "string"], "void");
addTsjs("Headers", "get", "instance", ["string"], "string | null");
addTsjs("Headers", "entries", "instance", [], "IterableIterator<[string, string]>");
addTsjs("Headers", "values", "instance", [], "IterableIterator<string>");
addTsjs("TextDecoder", "decodeToString", "instance", ["ArrayBufferView", "TextDecodeOptions"], "string");
addTsjs("TextEncoder", "encodeInto", "instance", ["string"], "Uint8Array");
addTsjs("JSON", "stringify", "instance", ["any"], "string");
addTsjs("JSON", "parse", "instance", ["string"], "any");
addTsjs("Reflect", "set", "static", ["object", "PropertyKey", "any"], "boolean");
addTsjs("Object", "defineProperty", "static", ["object", "PropertyKey", "PropertyDescriptor"], "object");
addTsjs("Object", "defineProperties", "static", ["object", "PropertyDescriptorMap"], "object");
addTsjs("RegExp", "exec", "instance", ["string"], "RegExpExecArray | null");
addTsjs("Promise", "resolve", "static", ["any"], "Promise<any>");
addTsjs("Promise", "reject", "static", ["any"], "Promise<any>");
addTsjs("String", "at", "instance", ["number"], "string");
addTsjs("String", "match", "instance", ["RegExp"], "RegExpMatchArray | null");
addTsjs("String", "matchAll", "instance", ["RegExp"], "IterableIterator<RegExpMatchArray>");

function buildTsjsCanonicalApiId(spec) {
  const result = fromOfficialDeclaration({
    domain: "tsjs",
    moduleSpecifier: "tsjs.builtin",
    logicalDeclarationFile: "api/tsjs.builtin.d.ts",
    exportPath: [{ kind: "namespace", name: spec.owner }],
    declarationOwner: {
      kind: "class",
      path: [spec.owner],
      normalizedName: spec.owner,
      arkanalyzerName: spec.owner,
    },
    member: {
      kind: "method",
      name: spec.method,
      static: spec.invokeKind === "static",
    },
    invoke: { kind: "call" },
    signature: {
      parameters: spec.parameterTypes.map((type, index) => ({
        index,
        optional: spec.optional.has(index),
        rest: spec.rest.has(index),
        type: { text: type },
      })),
      returnType: { text: spec.returnType },
    },
    arkanalyzer: {
      declaringFileName: "api/tsjs.builtin.d.ts",
      declaringNamespacePath: [],
      declaringClassName: spec.owner,
      methodName: spec.method,
      parameterTypes: spec.parameterTypes,
      returnType: spec.returnType,
      staticFlag: spec.invokeKind === "static",
    },
    declarationLocations: [{ file: "api/tsjs.builtin.d.ts" }],
  });
  if (result.status !== "accepted") throw new Error(`cannot build TSJS id for ${spec.owner}.${spec.method}: ${result.reason}`);
  return result.descriptor.canonicalApiId;
}

function applyTsjsSurface(surface, spec) {
  surface.modulePath = "tsjs.builtin";
  surface.ownerName = spec.owner;
  surface.methodName = spec.method;
  surface.invokeKind = spec.invokeKind;
  surface.argCount = spec.parameterTypes.length;
  surface.parameterTypes = [...spec.parameterTypes];
  surface.returnType = spec.returnType;
  surface.canonicalApiId = buildTsjsCanonicalApiId(spec);
  surface.runtimeShape = {
    modulePath: "tsjs.builtin",
    ownerName: spec.owner,
    methodName: spec.method,
    invokeKind: spec.invokeKind,
    argCount: spec.parameterTypes.length,
    parameterTypes: [...spec.parameterTypes],
    returnType: spec.returnType,
  };
}

function syntheticDeclarationEvidence(surface, asset, bindingsBySurface) {
  const moduleSpecifier = String(surface.modulePath || surface.runtimeShape?.modulePath || "@arktaint/test-fixture").replace(/\\/g, "/");
  const ownerName = String(surface.ownerName || surface.className || surface.runtimeShape?.ownerName || "RuleAssetFixture");
  const file = syntheticDeclarationFile(moduleSpecifier);
  if (surface.kind === "access") {
    const returnType = surface.accessKind === "write" ? "void" : "SyntheticTaintValue";
    return {
      domain: "local",
      moduleSpecifier,
      logicalDeclarationFile: file,
      exportPath: [{ kind: "namespace", name: ownerName }],
      declarationOwner: { kind: "namespace", path: [ownerName], normalizedName: ownerName, arkanalyzerName: ownerName },
      member: { kind: "property", name: String(surface.propertyName || "property") },
      invoke: { kind: surface.accessKind === "write" ? "property-write" : "property-read" },
      signature: { parameters: [], returnType: { text: returnType } },
      declarationLocations: [{ file }],
    };
  }
  if (surface.kind === "entry") {
    const entryOwner = `${surface.ownerKind}.${ownerName}`;
    return {
      domain: "local",
      moduleSpecifier: `entry/${asset.id}`,
      logicalDeclarationFile: `tests/api/${asset.id}.entry.d.ts`,
      exportPath: [{ kind: "entry", name: entryOwner }],
      declarationOwner: { kind: "entry", path: [entryOwner], normalizedName: entryOwner, arkanalyzerName: entryOwner },
      member: { kind: "lifecycle", name: [surface.phase, surface.entryKind, surface.methodName].filter(Boolean).join(".") },
      invoke: { kind: "entry" },
      signature: { parameters: [], returnType: { text: "void" } },
      declarationLocations: [{ file: `tests/api/${asset.id}.entry.d.ts` }],
    };
  }
  const methodName = String(surface.methodName || surface.functionName || surface.runtimeShape?.methodName || "apply");
  const invokeKind = ["instance", "static", "namespace", "free-function"].includes(surface.invokeKind) ? surface.invokeKind : "static";
  const argCount = Number.isInteger(surface.argCount) ? surface.argCount : 0;
  const parameterTypes = exactSurfaceParameterTypes(surface, argCount);
  const returnType = exactSurfaceReturnType(surface, bindingsBySurface.get(surface.surfaceId) || [], asset);
  const member = invokeKind === "free-function" || invokeKind === "namespace"
    ? { kind: "function", name: methodName }
    : { kind: "method", name: methodName, static: invokeKind === "static" };
  const ownerKind = member.kind === "method" ? "class" : "namespace";
  return {
    domain: "local",
    moduleSpecifier,
    logicalDeclarationFile: file,
    exportPath: [{ kind: "namespace", name: ownerName }],
    declarationOwner: { kind: ownerKind, path: [ownerName], normalizedName: ownerName, arkanalyzerName: ownerName },
    member,
    invoke: { kind: "call" },
    signature: {
      parameters: parameterTypes.map((type, index) => ({ index, type: { text: type } })),
      returnType: { text: returnType },
    },
    arkanalyzer: {
      declaringFileName: file,
      declaringNamespacePath: [],
      declaringClassName: ownerName,
      methodName,
      parameterTypes,
      returnType,
      staticFlag: invokeKind === "static",
    },
    declarationLocations: [{ file }],
  };
}

function syntheticDeclarationFile(moduleSpecifier) {
  const safe = String(moduleSpecifier || "test-fixture")
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "test_fixture";
  return `tests/api/${safe}.d.ts`;
}

function exactSurfaceParameterTypes(surface, argCount) {
  const direct = Array.isArray(surface.parameterTypes) ? surface.parameterTypes : undefined;
  const shape = Array.isArray(surface.runtimeShape?.parameterTypes) ? surface.runtimeShape.parameterTypes : undefined;
  const parsed = parseParameterTypes(surface.canonicalApiId);
  for (const candidate of [direct, shape, parsed]) {
    if (Array.isArray(candidate) && candidate.length === argCount && candidate.every(type => !isUnknown(type))) {
      return candidate.map(cleanType);
    }
  }
  return Array.from({ length: argCount }, (_unused, index) => `SyntheticArg${index}`);
}

function parseParameterTypes(canonicalApiId) {
  const parsed = parseCanonicalApiId(String(canonicalApiId || ""));
  if (!parsed || parsed.params === "none") return [];
  return splitCanonicalParameterEntries(parsed.params).map(entry => {
    const colon = entry.indexOf(":");
    return entry.slice(colon + 1).replace(/^\?:/, "").replace(/^rest:/, "").replace(/^\?rest:/, "");
  });
}

function signatureFromCanonicalApiId(canonicalApiId) {
  const parsed = parseCanonicalApiId(String(canonicalApiId || ""));
  if (!parsed) return undefined;
  return {
    parameterTypes: parsed.params === "none"
      ? []
      : splitCanonicalParameterEntries(parsed.params).map(entry => {
        const colon = entry.indexOf(":");
        return entry.slice(colon + 1).replace(/^\?:/, "").replace(/^rest:/, "").replace(/^\?rest:/, "");
      }),
    returnType: parsed.ret,
  };
}

function stampSurfaceSignatureEvidence(surface) {
  const signature = signatureFromCanonicalApiId(surface.canonicalApiId);
  if (!signature) return;
  if (surface.kind === "invoke" || surface.kind === "construct") {
    surface.argCount = signature.parameterTypes.length;
    surface.parameterTypes = signature.parameterTypes;
    surface.returnType = signature.returnType;
    surface.runtimeShape = {
      ...(surface.runtimeShape || {}),
      argCount: surface.argCount,
      parameterTypes: surface.parameterTypes,
      returnType: surface.returnType,
    };
  } else if (surface.kind === "access" || surface.kind === "entry" || surface.kind === "decorator") {
    surface.runtimeShape = {
      ...(surface.runtimeShape || {}),
      returnType: signature.returnType,
    };
  }
}

function exactSurfaceReturnType(surface, bindings, asset) {
  if (surface.returnType && !isUnknown(surface.returnType)) return cleanType(surface.returnType);
  if (surface.runtimeShape?.returnType && !isUnknown(surface.runtimeShape.returnType)) return cleanType(surface.runtimeShape.returnType);
  if (surface.kind === "construct") return String(surface.className || "SyntheticConstructedValue");
  if (bindings.some(binding => bindingOrTemplatesUseReturn(binding, asset))) return "SyntheticTaintValue";
  if (bindings.some(binding => binding.role === "source")) return "SyntheticTaintValue";
  return "void";
}

function bindingOrTemplatesUseReturn(binding, asset) {
  if (usesReturnEndpoint(binding.endpoint)) return true;
  for (const ref of binding.effectTemplateRefs || []) {
    const template = (asset.effectTemplates || []).find(item => item.id === ref);
    if (usesReturnEndpoint(template)) return true;
  }
  return false;
}

function usesReturnEndpoint(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(usesReturnEndpoint);
  const base = value.base;
  if (base && typeof base === "object") {
    const kind = base.kind;
    if (kind === "return" || kind === "promiseResult" || kind === "constructorResult" || kind === "callbackReturn") return true;
  }
  return Object.values(value).some(usesReturnEndpoint);
}

function applyProjectSyntheticSurface(surface, asset, bindingsBySurface) {
  const evidence = syntheticDeclarationEvidence(surface, asset, bindingsBySurface);
  const result = fromProjectDeclaration(evidence);
  if (result.status !== "accepted") {
    throw new Error(`cannot build project canonicalApiId for ${asset.id}/${surface.surfaceId}: ${result.reason}`);
  }
  surface.canonicalApiId = result.descriptor.canonicalApiId;
  if (surface.kind === "invoke") {
    const parameters = evidence.signature.parameters.map(param => param.type.text);
    const memberName = evidence.member.name;
    surface.modulePath = evidence.moduleSpecifier;
    if (evidence.member.kind === "function") {
      surface.ownerName = evidence.declarationOwner.normalizedName;
      surface.methodName = memberName;
      surface.invokeKind = "namespace";
    } else {
      surface.ownerName = evidence.declarationOwner.normalizedName;
      surface.methodName = memberName;
      surface.invokeKind = evidence.member.static ? "static" : "instance";
    }
    surface.argCount = parameters.length;
    surface.parameterTypes = parameters;
    surface.returnType = evidence.signature.returnType.text;
    surface.runtimeShape = {
      modulePath: surface.modulePath,
      ownerName: surface.ownerName,
      methodName: surface.methodName,
      invokeKind: surface.invokeKind,
      argCount: surface.argCount,
      parameterTypes: surface.parameterTypes,
      returnType: surface.returnType,
      signatureId: surface.signatureId,
    };
  } else if (surface.kind === "access") {
    surface.returnType = evidence.signature.returnType.text;
    surface.runtimeShape = {
      modulePath: surface.modulePath,
      ownerName: surface.ownerName,
      propertyName: surface.propertyName,
      accessKind: surface.accessKind,
      returnType: evidence.signature.returnType.text,
    };
  } else if (surface.kind === "entry") {
    surface.runtimeShape = {
      ownerName: surface.ownerName,
      methodName: surface.methodName,
      ownerKind: surface.ownerKind,
      phase: surface.phase,
      entryKind: surface.entryKind,
      returnType: "void",
    };
  }
}

function maybeApplyEntrySurface(surface) {
  if (surface.kind !== "entry") return false;
  const parsed = parseCanonicalApiId(String(surface.canonicalApiId || ""));
  const moduleSpecifier = parsed?.module || `entry/${surface.ownerKind}/${surface.ownerName}`;
  const file = parsed?.file || `entry/${surface.ownerKind}/${surface.ownerName}.d.ts`;
  const owner = `${surface.ownerKind}.${surface.ownerName}`;
  const result = fromOfficialDeclaration({
    domain: parsed?.domain || "openharmony",
    moduleSpecifier,
    logicalDeclarationFile: file,
    exportPath: [{ kind: "entry", name: owner }],
    declarationOwner: {
      kind: "entry",
      path: [owner],
      normalizedName: owner,
      arkanalyzerName: owner,
    },
    member: { kind: "lifecycle", name: [surface.phase, surface.entryKind, surface.methodName].filter(Boolean).join(".") },
    invoke: { kind: "entry" },
    signature: { parameters: [], returnType: { text: "void" } },
    declarationLocations: [{ file }],
  });
  if (result.status !== "accepted") {
    throw new Error(`entry canonical identity rejected for ${surface.surfaceId}: ${result.reason}`);
  }
  surface.canonicalApiId = result.descriptor.canonicalApiId;
  surface.runtimeShape = {
    ownerName: surface.ownerName,
    methodName: surface.methodName,
    ownerKind: surface.ownerKind,
    phase: surface.phase,
    entryKind: surface.entryKind,
    returnType: "void",
  };
  return true;
}

function shouldMigrateAsSynthetic(assetFile, asset, surface) {
  const text = JSON.stringify(surface);
  if (assetFile.startsWith("tests/")) return true;
  if (text.includes("@arktaint/runtime-selector") || text.includes("@arktaint/local")) return true;
  const parsed = parseCanonicalApiId(String(surface.canonicalApiId || ""));
  return !!parsed && parsed.authority === "official" && parsed.module.includes("@arktaint");
}

function roleForSurface(asset, surface) {
  const binding = (asset.bindings || []).find(item => item.surfaceId === surface.surfaceId);
  return binding?.role || "source";
}

function hasRetUnknown(surface) {
  return String(surface.canonicalApiId || "").includes("ret=unknown");
}

function officialSurfaceNeedsMigration(surface) {
  if (surface.signatureId || surface.runtimeShape?.signatureId) return true;
  if (hasRetUnknown(surface)) return true;
  if (surface.modulePath === "@ohos.file.picker" || surface.modulePath === "ohos/preferences") return true;
  return false;
}

function findOfficialApiForSurface(surface, role, apiById, inventory) {
  const signatureId = surface.signatureId || surface.runtimeShape?.signatureId || surface.runtimeShape?.arkanalyzerSignature;
  if (signatureId && apiById.has(signatureId)) return apiById.get(signatureId);
  const candidates = inventory.apis.filter(api => officialSurfaceCandidateMatches(api, surface));
  const byArity = candidates.filter(api => (api.parameters || []).length === Number(surface.argCount || 0));
  if (byArity.length === 1) return byArity[0];
  if (byArity.length > 1) return chooseBestOfficialCandidate(surface, byArity);
  const optionalCandidates = candidates.filter(api => canCallWithArity(api, Number(surface.argCount || 0)));
  if (optionalCandidates.length === 1) return optionalCandidates[0];
  if (optionalCandidates.length > 1) return chooseBestOfficialCandidate(surface, optionalCandidates);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return chooseBestOfficialCandidate(surface, candidates);
  return undefined;
}

function officialSurfaceCandidateMatches(api, surface) {
  const method = surface.methodName || surface.functionName;
  if (api.name !== method) return false;
  if (!officialFileMatchesSurface(api.file, surface.modulePath)) return false;
  const apiOwner = ownerNameForOfficialApi(api);
  const surfaceOwner = String(surface.ownerName || surface.className || "");
  return apiOwner === surfaceOwner || apiOwner.endsWith(`.${surfaceOwner}`);
}

function officialFileMatchesSurface(apiFile, modulePath) {
  const file = String(apiFile || "");
  const module = String(modulePath || "");
  if (module === "@ohos.file.picker") return file === "api/@ohos.file.picker.d.ts";
  if (module === "ohos/preferences" || module === "@ohos.preferences") return file === "api/@ohos.data.preferences.d.ts";
  if (module.startsWith("api/")) return file === module;
  if (module.startsWith("@")) return moduleSpecifierForOfficialFile(file) === module;
  return file === module || moduleSpecifierForOfficialFile(file) === module;
}

function canCallWithArity(api, arity) {
  const params = api.parameters || [];
  if (arity > params.length) return false;
  for (let index = arity; index < params.length; index++) {
    if (!isOptionalParam(api, params[index])) return false;
  }
  return true;
}

function chooseBestOfficialCandidate(surface, candidates) {
  const wantedReturn = surface.returnType || surface.runtimeShape?.returnType;
  if (wantedReturn && !isUnknown(wantedReturn)) {
    const sameReturn = candidates.filter(api => cleanType(api.returnType) === cleanType(wantedReturn));
    if (sameReturn.length === 1) return sameReturn[0];
  }
  const promise = candidates.filter(api => String(api.returnType || "").startsWith("Promise<"));
  if (promise.length === 1 && String(surface.surfaceId || "").includes("argCount0")) return promise[0];
  if (surfaceUsesReturn(surface)) {
    const nonVoid = candidates.filter(api => cleanType(api.returnType).toLowerCase() !== "void");
    if (nonVoid.length === 1) return nonVoid[0];
    if (promise.length === 1) return promise[0];
  }
  const nonCallback = candidates.filter(api => !(api.parameters || []).some(param => /callback/i.test(String(param.name || param.type || ""))));
  if (nonCallback.length === 1) return nonCallback[0];
  return undefined;
}

function surfaceUsesReturn(surface) {
  const shape = JSON.stringify(surface || {});
  return shape.includes("result") || shape.includes("return") || shape.includes("Promise");
}

function maybeApplyOfficialSurface(file, asset, surface, apiById, inventory, errors) {
  const parsed = parseCanonicalApiId(String(surface.canonicalApiId || ""));
  if (!parsed || parsed.authority !== "official" || parsed.domain !== "openharmony") return false;
  if (!officialSurfaceNeedsMigration(surface)) return false;
  const api = findOfficialApiForSurface(surface, roleForSurface(asset, surface), apiById, inventory);
  if (!api) {
    errors.push(`official declaration not found for ${file}:${asset.id}:${surface.surfaceId}`);
    return false;
  }
  applyOfficialApiSurface(surface, api, roleForSurface(asset, surface));
  return true;
}

function maybeApplyTsjsSurface(file, surface, errors) {
  if (surface.kind !== "invoke") return false;
  const modulePath = String(surface.modulePath || surface.runtimeShape?.modulePath || "");
  const parsed = parseCanonicalApiId(String(surface.canonicalApiId || ""));
  const isTsjs = modulePath === "tsjs.builtin" || parsed?.domain === "tsjs";
  if (!isTsjs) return false;
  const owner = String(surface.ownerName || surface.runtimeShape?.ownerName || "");
  const method = String(surface.methodName || surface.runtimeShape?.methodName || "");
  const invokeKind = String(surface.invokeKind || surface.runtimeShape?.invokeKind || "instance");
  const spec = TSJS_DECLARATIONS.get(`${owner}.${method}.${invokeKind}`);
  if (!spec) {
    errors.push(`TSJS declaration missing for ${file}:${surface.surfaceId}:${owner}.${method}.${invokeKind}`);
    return false;
  }
  applyTsjsSurface(surface, spec);
  return true;
}

function syncBindingIdentities(asset) {
  const surfaces = new Map((asset.surfaces || []).map(surface => [surface.surfaceId, surface]));
  for (const binding of asset.bindings || []) {
    const surface = surfaces.get(binding.surfaceId);
    if (surface?.canonicalApiId) binding.canonicalApiId = surface.canonicalApiId;
    delete binding.selector;
  }
}

function validateNoUnknownIdentity(file, asset, errors) {
  for (const surface of asset.surfaces || []) {
    if (!surface.canonicalApiId) {
      errors.push(`${file}:${surface.surfaceId} missing canonicalApiId`);
      continue;
    }
    try {
      assertValidCanonicalApiId(surface.canonicalApiId);
    } catch (error) {
      errors.push(`${file}:${surface.surfaceId} invalid canonicalApiId: ${error.message}`);
    }
    if (JSON.stringify(surface).includes("ret=unknown") || JSON.stringify(surface).includes("%unk")) {
      errors.push(`${file}:${surface.surfaceId} still contains unknown identity evidence`);
    }
  }
  for (const binding of asset.bindings || []) {
    if (!binding.canonicalApiId) {
      errors.push(`${file}:${binding.bindingId} missing canonicalApiId`);
      continue;
    }
    try {
      assertValidCanonicalApiId(binding.canonicalApiId);
    } catch (error) {
      errors.push(`${file}:${binding.bindingId} invalid canonicalApiId: ${error.message}`);
    }
    if (JSON.stringify(binding).includes("ret=unknown") || JSON.stringify(binding).includes("%unk")) {
      errors.push(`${file}:${binding.bindingId} still contains unknown identity evidence`);
    }
  }
}

function bindingsBySurface(asset) {
  const out = new Map();
  for (const binding of asset.bindings || []) {
    if (!out.has(binding.surfaceId)) out.set(binding.surfaceId, []);
    out.get(binding.surfaceId).push(binding);
  }
  return out;
}

function migrateAssetFile(file, inventory, apiById, errors) {
  const asset = readJson(file);
  if (!asset || typeof asset !== "object" || !Array.isArray(asset.surfaces)) return false;
  const before = canonicalJson(asset);
  const bySurface = bindingsBySurface(asset);
  for (const surface of asset.surfaces || []) {
    if (maybeApplyEntrySurface(surface)) continue;
    if (shouldMigrateAsSynthetic(file, asset, surface)) {
      applyProjectSyntheticSurface(surface, asset, bySurface);
      continue;
    }
    if (maybeApplyTsjsSurface(file, surface, errors)) continue;
    maybeApplyOfficialSurface(file, asset, surface, apiById, inventory, errors);
  }
  for (const surface of asset.surfaces || []) {
    stampSurfaceSignatureEvidence(surface);
  }
  syncBindingIdentities(asset);
  validateNoUnknownIdentity(file, asset, errors);
  const after = canonicalJson(asset);
  if (before !== after && errors.length === 0) {
    writeJson(file, asset);
    return true;
  }
  return before !== after;
}

function main() {
  const inventory = readJson(INVENTORY);
  const apiById = new Map((inventory.apis || []).map(api => [api.id, api]));
  const files = [
    ...walk("src/models/kernel", file => file.endsWith(".json")),
    ...walk("tests", file => file.endsWith(".rules.json")),
  ];
  const errors = [];
  const changed = [];
  for (const file of files) {
    const localErrors = [];
    const didChange = migrateAssetFile(file, inventory, apiById, localErrors);
    if (localErrors.length > 0) errors.push(...localErrors);
    if (didChange) changed.push(file);
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify({ changed: changed.length, files: changed }, null, 2));
}

main();
