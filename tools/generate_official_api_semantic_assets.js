const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ts = require("typescript");

const ROOT = process.cwd();
const OUTPUT_ROOT = process.env.ARKTAINT_OFFICIAL_ASSET_OUTPUT_ROOT
  ? path.resolve(ROOT, process.env.ARKTAINT_OFFICIAL_ASSET_OUTPUT_ROOT)
  : ROOT;
const SDK_ROOT = process.env.ARKTAINT_INTERFACE_SDK_JS || path.resolve(ROOT, "..", "interface_sdk-js");
const INVENTORY = "internal_docs/security_asset_iteration/official_api_semantic_inventory.json";
const LEDGER = "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json";

const {
  fromOfficialDeclaration,
  mirrorReplacementMapForDescriptors,
} = require(path.resolve(ROOT, "out/core/api/identity"));

let canonicalApiIdReplacementMap = new Map();
let optionCallbackRegistrationByPropertyKey = new Map();
const generationManualReview = [];
const generationManualReviewKeys = new Set();

function abs(file) {
  return path.resolve(ROOT, file);
}

function outAbs(file) {
  return path.resolve(OUTPUT_ROOT, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(abs(file), "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(outAbs(file)), { recursive: true });
  fs.writeFileSync(outAbs(file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(outAbs(file)), { recursive: true });
  fs.writeFileSync(outAbs(file), value, "utf8");
}

function toJsonl(rows) {
  if (rows.length === 0) return "";
  return `${rows.map(row => JSON.stringify(row)).join("\n")}\n`;
}

function removeIfExists(file) {
  const filePath = outAbs(file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function hash(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 12);
}

function apiKey(api) {
  return [
    api.file || "",
    (api.context || []).join("."),
    api.kind || "",
    api.name || "",
    String(api.line || ""),
    String((api.parameters || []).length),
  ].join("#");
}

function safePart(value) {
  return String(value || "api")
    .replace(/[^A-Za-z0-9_.-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "api";
}

function cleanFamily(value) {
  return safePart(value).toLowerCase();
}

function isCallbackParam(param) {
  const text = `${param?.name || ""} ${param?.type || ""}`.toLowerCase();
  return text.includes("callback") || text.includes("listener") || text.includes("=>");
}

function isCallbackTypeText(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("callback") || text.includes("voidcallback") || text.includes("=>");
}

function returnsPromise(api) {
  return String(api.returnType || "").toLowerCase().includes("promise<");
}

function returnsVoid(api) {
  return returnTypeForApi(api).toLowerCase() === "void";
}

function promiseInnerType(api) {
  const text = normalizeText(returnTypeForApi(api));
  const match = /^Promise\s*<([\s\S]+)>$/.exec(text);
  return match ? normalizeText(match[1]) : undefined;
}

function isVoidTypeText(value) {
  return normalizeText(value).toLowerCase() === "void";
}

function splitTopLevel(value, separator) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of String(value || "")) {
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function callbackResultArgIndexForType(typeText) {
  const text = normalizeText(typeText);
  const optionalMatch = /^Optional\s*<([\s\S]+)>$/.exec(text);
  if (optionalMatch) return callbackResultArgIndexForType(optionalMatch[1]);
  const asyncMatch = /^AsyncCallback\s*<([\s\S]+)>$/.exec(text);
  if (asyncMatch) return isVoidTypeText(asyncMatch[1]) ? undefined : 1;
  const callbackMatch = /^Callback\s*<([\s\S]+)>$/.exec(text);
  if (callbackMatch) return isVoidTypeText(callbackMatch[1]) ? undefined : 0;
  const functionMatch = /^(?:\(([\s\S]*)\)|([^=()]+))\s*=>\s*([\s\S]+)$/.exec(text);
  if (!functionMatch) return undefined;
  if (!isVoidTypeText(functionMatch[3])) return undefined;
  const paramsText = normalizeText(functionMatch[1] || functionMatch[2] || "");
  if (!paramsText || paramsText === "void") return undefined;
  const params = splitTopLevel(paramsText, ",")
    .map((entry, index) => {
      const colon = entry.indexOf(":");
      const name = colon >= 0 ? entry.slice(0, colon).replace(/[?]/g, "").trim() : "";
      const type = colon >= 0 ? entry.slice(colon + 1).trim() : entry.trim();
      return { index, name, type };
    })
    .filter(param => !isVoidTypeText(param.type));
  if (params.length === 1) return params[0].index;
  const nonError = params.filter(param => !/^(err|error|exception|businessError)$/i.test(param.name));
  return nonError.length === 1 ? nonError[0].index : undefined;
}

function callbackResultEndpointForApi(api) {
  const callbackParams = (api.parameters || [])
    .map((param, index) => ({ index, resultArgIndex: callbackResultArgIndexForType(param?.type) }))
    .filter(item => item.resultArgIndex !== undefined);
  if (callbackParams.length !== 1) return undefined;
  const item = callbackParams[0];
  return callbackArg(item.index, item.resultArgIndex);
}

function resultEndpointForApi(api) {
  if (returnsPromise(api)) {
    const inner = promiseInnerType(api);
    return inner && !isVoidTypeText(inner) ? promiseResult() : undefined;
  }
  if (returnsVoid(api)) return undefined;
  return ret();
}

function arg(index, accessPath) {
  const out = { base: { kind: "arg", index } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function receiver(accessPath) {
  const out = { base: { kind: "receiver" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function ret(accessPath) {
  const out = { base: { kind: "return" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function promiseResult(accessPath) {
  const out = { base: { kind: "promiseResult" } };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function callbackArg(callbackIndex, argIndex, accessPath) {
  const out = {
    base: {
      kind: "callbackArg",
      callback: { kind: "arg", index: callbackIndex },
      argIndex,
    },
  };
  if (accessPath && accessPath.length > 0) out.accessPath = accessPath;
  return out;
}

function optionCallbackArg(optionArgIndex, accessPath, callbackParamIndex) {
  return {
    base: {
      kind: "callbackArg",
      callback: {
        kind: "option",
        base: arg(optionArgIndex),
        accessPath,
      },
      argIndex: callbackParamIndex,
    },
  };
}

function nonCallbackArgIndexes(api) {
  return (api.parameters || [])
    .map((param, index) => ({ param, index }))
    .filter(({ param }) => !isCallbackParam(param))
    .map(({ index }) => index);
}

function selectedPayloadArgIndexes(api, family, role) {
  void api;
  void family;
  void role;
  return [];
}

function callbackParamIndex(api) {
  return (api.parameters || []).findIndex(isCallbackParam);
}

function sourceEndpointAndKind(api) {
  const optionCallback = optionCallbackSourceForProperty(api);
  if (optionCallback) return optionCallback;
  if (api.kind === "property" && isCallbackTypeText(api.returnType)) {
    return undefined;
  }
  const cbIndex = callbackParamIndex(api);
  if (cbIndex >= 0) {
    const callbackEndpoint = callbackResultEndpointForApi(api);
    if (!callbackEndpoint) return undefined;
    return {
      sourceKind: "callback_param",
      surfaceApi: api,
      value: callbackEndpoint,
    };
  }
  if (api.kind === "property") {
    if (!canBuildDirectCanonicalDescriptor(api, "source")) return undefined;
    return {
      sourceKind: "field_read",
      surfaceApi: api,
      value: ret([api.name]),
    };
  }
  const resultEndpoint = resultEndpointForApi(api);
  if (!resultEndpoint) return undefined;
  return {
    sourceKind: "call_return",
    surfaceApi: api,
    value: resultEndpoint,
  };
}

function optionCallbackSourceForProperty(api) {
  if (api.kind !== "property" || !isCallbackTypeText(api.returnType)) return undefined;
  const registration = optionCallbackRegistrationByPropertyKey.get(apiKey(api));
  if (!registration) return undefined;
  const callbackResultArgIndex = callbackResultArgIndexForType(api.returnType);
  if (callbackResultArgIndex === undefined) return undefined;
  return {
    sourceKind: "callback_param",
    surfaceApi: registration.api,
    value: optionCallbackArg(registration.argIndex, [api.name], callbackResultArgIndex),
  };
}

function sinkEndpoints(api, family) {
  void family;
  if (api.kind === "property") {
    return [receiver([api.name])];
  }
  return [];
}

function transferPairs(api, family) {
  const fromIndexes = selectedPayloadArgIndexes(api, family, "transfer");
  const out = [];
  const callbackTarget = callbackResultEndpointForApi(api);
  const resultEndpoint = resultEndpointForApi(api);
  if (fromIndexes.length === 0) {
    if (nonCallbackArgIndexes(api).length > 0) return out;
    if (returnsVoid(api) && callbackTarget && api.kind === "method") {
      out.push({ from: receiver(), to: callbackTarget });
      return out;
    }
    if (resultEndpoint) out.push({ from: receiver(), to: resultEndpoint });
    return out;
  }
  if (resultEndpoint) {
    for (const index of fromIndexes) out.push({ from: arg(index), to: resultEndpoint });
    return out;
  }
  if (callbackTarget) {
    for (const index of fromIndexes) out.push({ from: arg(index), to: callbackTarget });
    return out;
  }
  if (api.kind === "method") {
    for (const index of fromIndexes) out.push({ from: arg(index), to: receiver() });
  }
  return out;
}

function sanitizerPairs(api) {
  const idx = selectedPayloadArgIndexes(api, "", "sanitizer")[0];
  if (idx === undefined && nonCallbackArgIndexes(api).length > 0) return [];
  const from = idx === undefined ? receiver() : arg(idx);
  const to = callbackResultEndpointForApi(api) || resultEndpointForApi(api);
  if (!to) return [];
  return [{ from, to }];
}

function surfaceForApi(api, role, id) {
  void id;
  const canonicalApiId = canonicalApiIdForApi(api, role);
  const base = {
    surfaceId: `surface:${canonicalApiId}`,
    canonicalApiId,
    evidence: api.kind === "property" ? undefined : {
      arkanalyzer: {
        methodKey: arkanalyzerMethodKeyForApi(api),
      },
    },
    confidence: "certain",
    provenance: { source: "sdk", location: { file: api.file, line: api.line } },
  };
  if (api.kind === "constructor") {
    return { ...base, kind: "construct" };
  }
  if (api.kind === "property") {
    return { ...base, kind: "access" };
  }
  return { ...base, kind: "invoke" };
}

function arkanalyzerMethodKeyForApi(api) {
  const ownerName = ownerPathForApi(api).join(".");
  return {
    declaringFileName: logicalDeclarationFileForApi(api.file || ""),
    declaringNamespacePath: [],
    declaringClassName: ownerName,
    methodName: api.kind === "constructor" ? "constructor" : api.name,
    parameterTypes: (api.parameters || []).map(parameterTypeForApiParam),
    returnType: returnTypeForApi(api),
    staticFlag: isStaticApi(api),
  };
}

function canonicalApiIdForApi(api, role) {
  const canonicalApiId = canonicalDescriptorForApi(api, role).canonicalApiId;
  return canonicalApiIdReplacementMap.get(canonicalApiId) || canonicalApiId;
}

function canonicalDescriptorForApi(api, role) {
  const declaration = declarationEvidenceForApi(api, role);
  const result = fromOfficialDeclaration(declaration);
  if (result.status !== "accepted") {
    throw new Error(`cannot build canonical API identity for ${api.id}: ${result.reason} ${JSON.stringify(result.evidence)}`);
  }
  return result.descriptor;
}

function declarationEvidenceForApi(api, role) {
  const ownerPath = ownerPathForApi(api);
  const ownerName = ownerPath.join(".");
  const member = memberForApi(api);
  const invoke = invokeForApi(api, role);
  const sdkDeclaration = sdkDeclarationForApi(api, member, invoke);
  return {
    domain: domainForApi(api),
    moduleSpecifier: moduleSpecifierForApi(api.file || ""),
    logicalDeclarationFile: logicalDeclarationFileForApi(api.file || ""),
    exportPath: exportPathForApi(api, ownerName, sdkDeclaration),
    declarationOwner: {
      kind: sdkDeclaration.ownerKind,
      path: ownerPath,
      normalizedName: ownerName,
      arkanalyzerName: ownerName,
    },
    member,
    invoke: { kind: invoke },
    signature: {
      parameters: (api.parameters || []).map((param, index) => ({
        index,
        name: cleanParameterName(param?.name),
        optional: isOptionalParam(api, param),
        rest: isRestParam(api, param),
        type: { text: parameterTypeForApiParam(param) },
      })),
      returnType: { text: returnTypeForApi(api) },
    },
    arkanalyzer: api.kind === "property" ? undefined : {
      declaringFileName: logicalDeclarationFileForApi(api.file || ""),
      declaringNamespacePath: [],
      declaringClassName: ownerName,
      methodName: api.kind === "constructor" ? "constructor" : api.name,
      parameterTypes: (api.parameters || []).map(parameterTypeForApiParam),
      returnType: returnTypeForApi(api),
      staticFlag: member.static === true,
    },
    declarationLocations: [{ file: logicalDeclarationFileForApi(api.file || ""), line: api.line }],
  };
}

function memberForApi(api) {
  if (api.kind === "constructor") {
    return { kind: "constructor", name: "constructor" };
  }
  if (api.kind === "property") {
    return { kind: "property", name: api.name };
  }
  if (api.kind === "function") {
    return { kind: "function", name: api.name };
  }
  if (api.kind === "call-signature") {
    return { kind: "method", name: api.name || "call", static: false };
  }
  return { kind: "method", name: api.name, static: isStaticApi(api) };
}

function invokeForApi(api, role) {
  if (api.kind === "constructor") return "new";
  if (api.kind === "property") return role === "source" || role === "load" ? "property-read" : "property-write";
  return "call";
}

function exportPathForApi(api, ownerName, sdkDeclaration) {
  if (api.file && api.file.includes("@internal/component/ets/")) {
    return [{
      kind: "component",
      name: String(ownerName || "").replace(/(Interface|Attribute)$/, ""),
    }];
  }
  if (!sdkDeclaration.exportPath) {
    throw new Error(`official SDK export path must be exact for ${api.id}`);
  }
  return sdkDeclaration.exportPath;
}

function ownerPathForApi(api) {
  const context = (api.context || []).map(value => String(value || "").trim()).filter(Boolean);
  if (context.length > 0) return context;
  if (api.kind === "function") return [api.name || "file"];
  return [api.name || "OfficialApi"];
}

function moduleSpecifierForApi(file) {
  const normalized = String(file || "").replace(/\\/g, "/").trim();
  const module = /^api\/(@.+)\.d\.(ts|ets)$/.exec(normalized);
  if (module) return module[1];
  return normalized;
}

function logicalDeclarationFileForApi(file) {
  return String(file || "").replace(/\\/g, "/").trim();
}

function domainForApi(api) {
  const file = String(api.file || "").replace(/\\/g, "/");
  if (file.includes("@internal/component/ets/") || file.startsWith("api/arkui/")) return "arkui";
  if (file.includes("tsjs")) return "tsjs";
  return "openharmony";
}

function returnTypeForApi(api) {
  const explicit = String(api.returnType || "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit;
  if (api.kind === "constructor") return ownerPathForApi(api).slice(-1)[0] || "constructor";
  return "void";
}

function parameterTypeForApiParam(param) {
  return String(param?.type || "").replace(/\s+/g, " ").trim();
}

function cleanParameterName(name) {
  return String(name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim() || undefined;
}

function isStaticApi(api) {
  return /\bstatic\b/.test(String(api.signature || "").trim());
}

function isRestParam(api, param) {
  const name = String(param?.name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim();
  if (String(param?.name || "").startsWith("...")) return true;
  return !!name && new RegExp(`\\.\\.\\.\\s*${escapeRegExp(name)}\\b`).test(String(api.signature || ""));
}

function isOptionalParam(api, param) {
  const name = String(param?.name || "").replace(/^\.\.\./, "").replace(/\?$/, "").trim();
  if (String(param?.name || "").endsWith("?")) return true;
  return !!name && new RegExp(`\\b${escapeRegExp(name)}\\?\\s*:`).test(String(api.signature || ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function declarationName(node) {
  if (!node || !node.name) return undefined;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText();
}

function hasModifier(node, kind) {
  return !!node.modifiers && node.modifiers.some(modifier => modifier.kind === kind);
}

function memberName(node) {
  if (!node.name) return undefined;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText();
}

function serializeSdkParameters(parameters, sf) {
  if (!parameters || parameters.length === 0) return "none";
  return parameters.map((parameter, index) => {
    const optional = !!parameter.questionToken || !!parameter.initializer;
    const rest = !!parameter.dotDotDotToken;
    const flags = [optional ? "?" : "", rest ? "rest" : ""].filter(Boolean).join("");
    const prefix = flags ? `${flags}:` : "";
    const typeText = parameter.type ? normalizeText(parameter.type.getText(sf)) : "any";
    return `${index}:${prefix}${typeText}`;
  }).join(",");
}

function sdkReturnType(node, sf, fallback = "void") {
  return node.type ? normalizeText(node.type.getText(sf)) : fallback;
}

function serializeExportPath(exportPath) {
  if (!exportPath) return "<unexported>";
  return exportPath.map(part => `${part.kind}:${part.name}`).join(".");
}

function collectSdkExports(sf) {
  const defaultExportNames = new Set();
  const namedExportNames = new Set();
  const namespaceReexports = new Map();

  function visit(node, namespacePath) {
    if (ts.isModuleDeclaration(node)) {
      const name = declarationName(node);
      const nextPath = name ? [...namespacePath, name] : namespacePath;
      if (node.body) visit(node.body, nextPath);
      return;
    }
    if (ts.isModuleBlock(node)) {
      for (const statement of node.statements) visit(statement, namespacePath);
      return;
    }
    if (ts.isExportAssignment(node)) {
      if (namespacePath.length > 0) return;
      const expression = node.expression;
      if (expression) {
        defaultExportNames.add(normalizeText(expression.getText(sf)));
      }
      return;
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const localName = element.propertyName ? element.propertyName.text : element.name.text;
        const exportedName = element.name.text;
        if (namespacePath.length > 0) {
          const namespaceName = namespacePath.join(".");
          namespaceReexports.set(localName, namespaceName);
          namespaceReexports.set(exportedName, namespaceName);
        } else {
          namedExportNames.add(localName);
          namedExportNames.add(exportedName);
        }
      }
      return;
    }
    ts.forEachChild(node, child => visit(child, namespacePath));
  }

  visit(sf, []);
  return { defaultExportNames, namedExportNames, namespaceReexports };
}

function sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports) {
  const ownerName = ownerPath.join(".");
  if (namespacePath.length > 0) {
    const namespaceName = namespacePath.join(".");
    if (ownerKind === "namespace" && ownerName === namespaceName && exports.defaultExportNames.has(namespaceName)) {
      return [{ kind: "default", name: namespaceName }];
    }
    return [{ kind: "namespace", name: ownerName }];
  }

  const topLevelName = ownerPath[0] || ownerName;
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword) || exports.defaultExportNames.has(topLevelName)) {
    return [{ kind: "default", name: topLevelName }];
  }
  const reexportingNamespace = exports.namespaceReexports.get(topLevelName);
  if (reexportingNamespace && exports.defaultExportNames.has(reexportingNamespace)) {
    return [{ kind: "default", name: reexportingNamespace }];
  }
  if (reexportingNamespace) {
    return [{ kind: "namespace", name: `${reexportingNamespace}.${topLevelName}` }];
  }
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || exports.namedExportNames.has(topLevelName)) {
    return [{ kind: "named", name: topLevelName }];
  }
  return undefined;
}

function addSdkSignature(index, ownerKind, ownerPath, exportPath, memberKey, invoke, params, ret, node) {
  const full = `${ownerPath.join(".")}|${memberKey}|${invoke}|${params}|${ret}`;
  const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const item = {
    ownerKind,
    ownerPath,
    exportPath,
    memberKey,
    invoke,
    params,
    ret,
    line,
  };
  if (!index.byFull.has(full)) index.byFull.set(full, []);
  index.byFull.get(full).push(item);
}

function physicalSdkPath(logicalFile) {
  const normalized = normalizePath(logicalFile);
  if (!normalized.startsWith("api/")) return undefined;
  return path.join(SDK_ROOT, normalized);
}

function buildSdkDeclarationIndex(logicalFile) {
  const normalized = normalizePath(logicalFile);
  const physical = physicalSdkPath(normalized);
  const index = {
    logicalFile: normalized,
    physical,
    missing: !physical || !fs.existsSync(physical),
    byFull: new Map(),
  };
  if (index.missing) return index;

  const text = fs.readFileSync(physical, "utf8");
  const sf = ts.createSourceFile(physical, text, ts.ScriptTarget.Latest, true);
  const exports = collectSdkExports(sf);

  function visit(node, namespacePath) {
    if (ts.isModuleDeclaration(node)) {
      const name = declarationName(node);
      const nextPath = name ? [...namespacePath, name] : namespacePath;
      if (node.body) visit(node.body, nextPath);
      return;
    }
    if (ts.isModuleBlock(node)) {
      for (const statement of node.statements) visit(statement, namespacePath);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const name = declarationName(node);
      if (!name) return;
      const ownerKind = ts.isClassDeclaration(node) ? "class" : "interface";
      const ownerPath = [...namespacePath, name];
      const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports);
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
          const nameText = memberName(member);
          if (!nameText) continue;
          const isStatic = ts.isMethodDeclaration(member) && hasModifier(member, ts.SyntaxKind.StaticKeyword);
          addSdkSignature(index, ownerKind, ownerPath, exportPath, `method:${isStatic ? "static" : "instance"}:${nameText}`, "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
        } else if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
          addSdkSignature(index, ownerKind, ownerPath, exportPath, "constructor:new:constructor", "new", serializeSdkParameters(member.parameters, sf), name, member);
        } else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
          const nameText = memberName(member);
          if (!nameText) continue;
          const typeText = sdkReturnType(member, sf, "any");
          addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-read", "none", typeText, member);
          addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-write", "none", typeText, member);
        } else if (ts.isGetAccessor(member)) {
          const nameText = memberName(member);
          if (!nameText) continue;
          addSdkSignature(index, ownerKind, ownerPath, exportPath, `getter:${nameText}`, "property-read", "none", sdkReturnType(member, sf, "any"), member);
        } else if (ts.isSetAccessor(member)) {
          const nameText = memberName(member);
          if (!nameText) continue;
          addSdkSignature(index, ownerKind, ownerPath, exportPath, `setter:${nameText}`, "property-write", serializeSdkParameters(member.parameters, sf), "void", member);
        } else if (ts.isCallSignatureDeclaration(member)) {
          addSdkSignature(index, ownerKind, ownerPath, exportPath, "method:instance:call", "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
        }
      }
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      const name = declarationName(node);
      if (!name) return;
      const ownerKind = namespacePath.length ? "namespace" : "function";
      const ownerPath = namespacePath.length ? namespacePath : [name];
      const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports);
      addSdkSignature(index, ownerKind, ownerPath, exportPath, `function:${name}`, "call", serializeSdkParameters(node.parameters, sf), sdkReturnType(node, sf), node);
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      const name = declarationName(node);
      if (name && ts.isTypeLiteralNode(node.type)) {
        const ownerKind = "type";
        const ownerPath = [...namespacePath, name];
        const exportPath = sdkExportPathForOwner(ownerKind, ownerPath, node, namespacePath, exports);
        for (const member of node.type.members) {
          if (ts.isPropertySignature(member)) {
            const nameText = memberName(member);
            if (!nameText) continue;
            const typeText = sdkReturnType(member, sf, "any");
            addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-read", "none", typeText, member);
            addSdkSignature(index, ownerKind, ownerPath, exportPath, `property:${nameText}`, "property-write", "none", typeText, member);
          } else if (ts.isMethodSignature(member)) {
            const nameText = memberName(member);
            if (!nameText) continue;
            addSdkSignature(index, ownerKind, ownerPath, exportPath, `method:instance:${nameText}`, "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
          } else if (ts.isCallSignatureDeclaration(member)) {
            addSdkSignature(index, ownerKind, ownerPath, exportPath, "method:instance:call", "call", serializeSdkParameters(member.parameters, sf), sdkReturnType(member, sf), member);
          }
        }
      }
      return;
    }
    if (ts.isVariableStatement(node) && namespacePath.length) {
      for (const declaration of node.declarationList.declarations) {
        const name = declarationName(declaration);
        if (!name) continue;
        const typeText = declaration.type ? normalizeText(declaration.type.getText(sf)) : "any";
        const exportPath = sdkExportPathForOwner("namespace", namespacePath, declaration, namespacePath, exports);
        addSdkSignature(index, "namespace", namespacePath, exportPath, `property:${name}`, "property-read", "none", typeText, declaration);
        addSdkSignature(index, "namespace", namespacePath, exportPath, `property:${name}`, "property-write", "none", typeText, declaration);
      }
      return;
    }
    ts.forEachChild(node, child => visit(child, namespacePath));
  }

  visit(sf, []);
  return index;
}

const sdkDeclarationIndexes = new Map();

function sdkDeclarationIndexFor(logicalFile) {
  const normalized = normalizePath(logicalFile);
  if (!sdkDeclarationIndexes.has(normalized)) {
    sdkDeclarationIndexes.set(normalized, buildSdkDeclarationIndex(normalized));
  }
  return sdkDeclarationIndexes.get(normalized);
}

function canonicalParamStringForApi(api) {
  const params = api.parameters || [];
  if (params.length === 0) return "none";
  return params.map((param, index) => {
    const optional = isOptionalParam(api, param);
    const rest = isRestParam(api, param);
    const flags = [optional ? "?" : "", rest ? "rest" : ""].filter(Boolean).join("");
    const prefix = flags ? `${flags}:` : "";
    return `${index}:${prefix}${parameterTypeForApiParam(param)}`;
  }).join(",");
}

function sdkDeclarationForApi(api, member, invoke) {
  const logicalFile = logicalDeclarationFileForApi(api.file || "");
  const index = sdkDeclarationIndexFor(logicalFile);
  if (index.missing) {
    throw new Error(`official SDK declaration file not found for ${api.id}: ${index.physical || logicalFile}`);
  }
  const ownerPath = ownerPathForApi(api);
  const memberKey = member.kind === "constructor"
    ? "constructor:new:constructor"
    : member.static === undefined
    ? `${member.kind}:${member.name}`
    : `${member.kind}:${member.static ? "static" : "instance"}:${member.name}`;
  const full = `${ownerPath.join(".")}|${memberKey}|${invoke}|${canonicalParamStringForApi(api)}|${returnTypeForApi(api)}`;
  const candidates = index.byFull.get(full) || [];
  const uniqueDeclarations = new Map(candidates.map(candidate => [
    `${candidate.ownerKind}|${serializeExportPath(candidate.exportPath)}`,
    {
      ownerKind: candidate.ownerKind,
      exportPath: candidate.exportPath,
    },
  ]));
  if (uniqueDeclarations.size !== 1) {
    throw new Error(`official SDK owner kind must be exact for ${api.id}: key=${full} candidates=${JSON.stringify(candidates.slice(0, 8))}`);
  }
  return [...uniqueDeclarations.values()][0];
}

function hasArtifact(row, category) {
  const artifacts = (row.implementationArtifact || [])
    .filter(item => {
      const text = String(item);
      return !text.includes("official_declarations.rules.json")
        && !text.includes("official_declaration_semantic_slots.ts")
        && !text.includes("official_declarations.catalog.json");
    });
  if (category === "source") return artifacts.some(item => String(item).includes("/sources/") || String(item).includes("FrameworkApiSource") || String(item).includes("FrameworkCallbackSource"));
  if (category === "sink") return artifacts.some(item => String(item).includes("/sinks/") || String(item).includes("FrameworkSink"));
  if (category === "transfer") return artifacts.some(item => String(item).includes("/transfers/"));
  if (category === "sanitizer") return artifacts.some(item => String(item).includes("/sanitizers/") || String(item).includes("FrameworkSanitizer"));
  if (category === "module") return artifacts.some(item => String(item).includes("src/models/kernel/modules"));
  if (category === "arkmain") return artifacts.some(item => String(item).includes("src/models/kernel/arkmain"));
  return false;
}

function categoriesForRole(role) {
  if (role === "source") return ["source"];
  if (role === "sink") return ["sink"];
  if (role === "transfer") return ["transfer"];
  if (role === "sanitizer") return ["sanitizer"];
  if (role === "arkmain-entry") return ["arkmain"];
  if (role === "load" || role === "store" || role === "kill" || role === "handoff" || role === "handle") return ["module"];
  return [];
}

function roleNeedsGeneration(row, role, category) {
  void role;
  if (row.manualReviewStatus !== "confirmed" || row.implementationStatus !== "implemented") return false;
  if (category === "module" && hasArtifact(row, "module")) return false;
  return true;
}

function surfaceRoleForCategory(category) {
  if (category === "module") return "handoff";
  if (category === "arkmain") return "arkmain-entry";
  return category;
}

function categoryHasGeneratedSurface(api, row, category) {
  if (category === "source") return !!sourceEndpointAndKind(api);
  if (!canBuildDirectCanonicalDescriptor(api, surfaceRoleForCategory(category))) return false;
  if (category === "sink") return sinkEndpoints(api, row.family).length > 0;
  if (category === "transfer") return transferPairs(api, row.family).length > 0;
  if (category === "sanitizer") return sanitizerPairs(api).length > 0;
  if (category === "module") return moduleEffectsForApi(api, row).length > 0;
  if (category === "arkmain") return true;
  return false;
}

function callableApiForOptionTypeCandidates(apis, propertyApi) {
  const ownerName = ownerPathForApi(propertyApi).join(".");
  if (!ownerName) return [];
  const sameFile = normalizePath(propertyApi.file || "");
  const candidates = [];
  for (const api of apis) {
    if (api === propertyApi) continue;
    if (normalizePath(api.file || "") !== sameFile) continue;
    if (api.kind !== "method" && api.kind !== "function" && api.kind !== "constructor") continue;
    for (const [argIndex, param] of (api.parameters || []).entries()) {
      const typeText = normalizeText(param?.type || "");
      if (typeText === ownerName || typeText === `Optional<${ownerName}>` || typeText.includes(`<${ownerName}>`)) {
        candidates.push({ api, argIndex });
      }
    }
  }
  return candidates;
}

function canBuildDirectCanonicalDescriptor(api, role) {
  try {
    canonicalDescriptorForApi(api, role);
    return true;
  } catch {
    return false;
  }
}

function buildOptionCallbackRegistrationIndex(apis) {
  const out = new Map();
  for (const api of apis) {
    if (api.kind !== "property" || !isCallbackTypeText(api.returnType)) continue;
    const candidates = callableApiForOptionTypeCandidates(apis, api)
      .filter(candidate => canBuildDirectCanonicalDescriptor(candidate.api, "source"));
    const unique = new Map(candidates.map(candidate => [`${apiKey(candidate.api)}#${candidate.argIndex}`, candidate]));
    if (unique.size === 1) {
      out.set(apiKey(api), [...unique.values()][0]);
    }
  }
  return out;
}

function generationSurfaceApi(api, role, category) {
  if (category === "source") {
    const source = sourceEndpointAndKind(api);
    return source?.surfaceApi;
  }
  void role;
  return api;
}

function buildCanonicalApiIdReplacementMap(rows, apiByKey) {
  const descriptors = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.manualReviewStatus !== "confirmed") continue;
    if (row.implementationStatus !== "implemented") continue;
    const api = apiByKey.get(row.signatureKey);
    if (!api) continue;
    for (const role of row.roles || []) {
      for (const category of categoriesForRole(role)) {
        if (!roleNeedsGeneration(row, role, category)) continue;
        if (!categoryHasGeneratedSurface(api, row, category)) continue;
        const surfaceApi = generationSurfaceApi(api, role, category);
        if (!surfaceApi) continue;
        const descriptor = canonicalDescriptorForApi(surfaceApi, surfaceRoleForCategory(category));
        if (seen.has(descriptor.canonicalApiId)) continue;
        seen.add(descriptor.canonicalApiId);
        descriptors.push(descriptor);
      }
    }
  }
  return mirrorReplacementMapForDescriptors(descriptors);
}

function addSurface(asset, surface) {
  if (!asset._surfaces.has(surface.surfaceId)) {
    asset._surfaces.set(surface.surfaceId, surface);
    asset.surfaces.push(surface);
  }
}

function newRuleAsset(role) {
  return {
    id: `asset.rule.kernel.${role}s.official_declarations`,
    plane: "rule",
    status: "official",
    surfaces: [],
    bindings: [],
    effectTemplates: [],
    provenance: {
      source: "builtin",
      evidenceLocations: [
        { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
        { file: "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json" },
      ],
    },
    _surfaces: new Map(),
    _bindingKeys: new Set(),
  };
}

function addRuleBinding(asset, api, row, role, value, options = {}) {
  const id = `${cleanFamily(row.family)}.${role}.${hash(row.signatureKey + JSON.stringify(value) + (options.ordinal || ""))}`;
  const surface = surfaceForApi(api, role, id);
  addSurface(asset, surface);
  const templateId = `template:${asset.id}:${role}:${hash(id + ":template")}`;
  const bindingId = `binding:${asset.id}:${role}:${hash(id + ":binding")}`;
  const template =
    role === "source" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.source",
      value,
      sourceKind: options.sourceKind || "call_return",
    } :
    role === "sink" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.sink",
      value,
      sinkKind: row.family,
    } :
    role === "transfer" ? {
      id: templateId,
      confidence: "certain",
      kind: "rule.transfer",
      from: value.from,
      to: value.to,
      transferKind: row.family,
    } : {
      id: templateId,
      confidence: "certain",
      kind: "rule.sanitizer",
      value: value.to,
      sanitizerKind: row.family,
      strength: "strong",
    };
  const templateSemantic = { ...template };
  delete templateSemantic.id;
  const bindingSemanticKey = `${surface.canonicalApiId}|${role}|${JSON.stringify(templateSemantic)}`;
  if (asset._bindingKeys.has(bindingSemanticKey)) return;
  asset._bindingKeys.add(bindingSemanticKey);
  asset.effectTemplates.push(template);
    asset.bindings.push({
      bindingId,
      surfaceId: surface.surfaceId,
      canonicalApiId: surface.canonicalApiId,
      assetId: asset.id,
      plane: "rule",
      role,
      endpoint: role === "transfer" || role === "sanitizer" ? value.to : value,
      effectTemplateRefs: [templateId],
    semanticsFamily: row.family,
    metadata: {
      enabled: true,
      description: `Official SDK declaration ${row.signatureKey} as ${role}.`,
      tags: ["harmony", "official-declaration"],
    },
    completeness: "complete",
    confidence: "certain",
  });
}

function handleFor(row, api) {
  void row;
  void api;
  return undefined;
}

function moduleEffectsForApi(api, row) {
  if (api.kind === "property") return [];
  const out = [];
  const handle = handleFor(row, api);
  if (!handle) return [];
  const loadTarget = callbackResultEndpointForApi(api) || resultEndpointForApi(api);
  const valueIndexes = selectedPayloadArgIndexes(api, row.family, "store");
  const firstValue = valueIndexes[0] !== undefined ? arg(valueIndexes[0]) : undefined;
  const roles = new Set(row.roles || []);
  const templateBaseId = `template:asset.module.kernel.official_declarations.${cleanFamily(row.family)}:${hash(row.signatureKey)}`;
  if ((roles.has("store") || (roles.has("handoff") && valueIndexes.length > 0)) && firstValue) {
    out.push({ id: `${templateBaseId}:put`, kind: "handoff.put", handle, value: firstValue, updateStrength: "infer", confidence: "certain" });
  }
  if ((roles.has("load") || roles.has("handle") || (roles.has("handoff") && !roles.has("store"))) && loadTarget) {
    out.push({ id: `${templateBaseId}:get`, kind: "handoff.get", handle, target: loadTarget, confidence: "certain" });
  }
  if (roles.has("kill")) {
    out.push({ id: `${templateBaseId}:kill`, kind: "handoff.kill", handle, updateStrength: "strong", confidence: "certain" });
  }
  return out;
}

function newModuleAssetGroup(row) {
  const family = cleanFamily(row.family);
  return {
    id: `asset.module.kernel.official_declarations.${family}`,
    plane: "module",
    status: "official",
    surfaces: [],
    bindings: [],
    effectTemplates: [],
    provenance: {
      source: "builtin",
      evidenceLocations: [
        { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
        { file: "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json" },
      ],
    },
    _surfaceIds: new Set(),
    _bindingIds: new Set(),
    _bindingSemanticKeys: new Set(),
    _templateIds: new Set(),
    _evidenceLocations: new Set(),
  };
}

function addModuleDeclarationAsset(moduleAssetGroups, api, row, effects) {
  const family = cleanFamily(row.family);
  let asset = moduleAssetGroups.get(family);
  if (!asset) {
    asset = newModuleAssetGroup(row);
    moduleAssetGroups.set(family, asset);
  }
  const id = `${family}.module.${hash(row.signatureKey)}`;
  const surface = surfaceForApi(api, "handoff", id);
  const bindingSemanticKey = `${surface.canonicalApiId}|${effects.map(effectSemanticKey).join("|")}`;
  if (asset._bindingSemanticKeys.has(bindingSemanticKey)) return;
  asset._bindingSemanticKeys.add(bindingSemanticKey);
  if (!asset._surfaceIds.has(surface.surfaceId)) {
    asset._surfaceIds.add(surface.surfaceId);
    asset.surfaces.push(surface);
  }
  const bindingId = `binding:${asset.id}:${hash(id + ":binding")}`;
  if (!asset._bindingIds.has(bindingId)) {
    asset._bindingIds.add(bindingId);
    asset.bindings.push({
      bindingId,
      surfaceId: surface.surfaceId,
      canonicalApiId: surface.canonicalApiId,
      assetId: asset.id,
      plane: "module",
      role: "handoff",
      endpoint: effects[0].kind === "handoff.get" ? effects[0].target : effects[0].value,
      effectTemplateRefs: effects.map(effect => effect.id),
      semanticsFamily: row.family,
      metadata: { description: `Official SDK declaration ${row.signatureKey} as module handoff.` },
      completeness: "complete",
      confidence: "certain",
    });
  }
  for (const effect of effects) {
    if (asset._templateIds.has(effect.id)) continue;
    asset._templateIds.add(effect.id);
    asset.effectTemplates.push(effect);
  }
  const evidenceKey = `${row.sdkFile || ""}:${row.line || ""}`;
  if (row.sdkFile && !asset._evidenceLocations.has(evidenceKey)) {
    asset._evidenceLocations.add(evidenceKey);
    asset.provenance.evidenceLocations.push({ file: row.sdkFile, line: row.line });
  }
}

function finalizeModuleAssetGroups(moduleAssetGroups) {
  return [...moduleAssetGroups.values()]
    .map(asset => {
      delete asset._surfaceIds;
      delete asset._bindingIds;
      delete asset._bindingSemanticKeys;
      delete asset._templateIds;
      delete asset._evidenceLocations;
      asset.surfaces.sort((a, b) => a.surfaceId.localeCompare(b.surfaceId));
      asset.bindings.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
      asset.effectTemplates.sort((a, b) => a.id.localeCompare(b.id));
      asset.provenance.evidenceLocations.sort((a, b) =>
        String(a.file || "").localeCompare(String(b.file || ""))
        || Number(a.line || 0) - Number(b.line || 0),
      );
      return asset;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function effectSemanticKey(effect) {
  const semantic = { ...effect };
  delete semantic.id;
  return JSON.stringify(semantic);
}

function manualReviewReasonForCategory(api, row, category) {
  const hasCallback = callbackParamIndex(api) >= 0;
  if (category === "source") {
    if (api.kind === "property" && isCallbackTypeText(api.returnType)) {
      return "option callback source endpoint is not exactly recoverable from the SDK declaration shape";
    }
    if (hasCallback && !callbackResultEndpointForApi(api)) {
      return "callback-style source has no exact callback result parameter in the SDK declaration shape";
    }
    if (!hasCallback && !resultEndpointForApi(api) && api.kind !== "property") {
      return "source declaration has no projectable return, promise result, or callback result endpoint";
    }
  }
  if (category === "sink") {
    if (api.kind !== "property") {
      return "sink endpoint is not exactly recoverable without a declaration-level endpoint decision";
    }
  }
  if (category === "transfer") {
    if (!resultEndpointForApi(api) && !callbackResultEndpointForApi(api)) {
      return "transfer target has no projectable return, promise result, or callback result endpoint";
    }
    if (selectedPayloadArgIndexes(api, row.family, "transfer").length === 0 && api.kind !== "method") {
      return "transfer source endpoint is not exactly recoverable from the SDK declaration parameters";
    }
  }
  if (category === "sanitizer") {
    if (!resultEndpointForApi(api) && !callbackResultEndpointForApi(api)) {
      return "sanitizer target has no projectable return, promise result, or callback result endpoint";
    }
  }
  if (category === "module") {
    if (!handleFor(row, api)) {
      return "module handle key is not exactly recoverable from the SDK declaration parameters";
    }
    if ((row.roles || []).some(role => role === "load" || role === "handle" || role === "handoff") && !resultEndpointForApi(api) && !callbackResultEndpointForApi(api)) {
      return "module load target has no projectable return, promise result, or callback result endpoint";
    }
    if ((row.roles || []).some(role => role === "store" || role === "handoff") && selectedPayloadArgIndexes(api, row.family, "store").length === 0) {
      return "module store value endpoint is not exactly recoverable from the SDK declaration parameters";
    }
  }
  return "semantic endpoint is not exactly recoverable from the SDK declaration shape";
}

function recordGenerationManualReview(row, api, category, reason) {
  const key = `${row.signatureKey}|${category}|${reason}`;
  if (generationManualReviewKeys.has(key)) return;
  generationManualReviewKeys.add(key);
  generationManualReview.push({
    signatureKey: row.signatureKey,
    sdkFile: row.sdkFile || api.file || "",
    line: row.line || api.line || "",
    namespaceOrClass: row.namespaceOrClass || (api.context || []).join("."),
    member: row.member || api.name || "",
    kind: row.kind || api.kind || "",
    category,
    roles: row.roles || [],
    family: row.family || "",
    requiredAction: "manualReview",
    reason,
    declarationShape: {
      returnType: returnTypeForApi(api),
      parameters: (api.parameters || []).map((param, index) => ({
        index,
        name: cleanParameterName(param?.name),
        type: parameterTypeForApiParam(param),
      })),
    },
  });
}

function safeJsonChunks(json, chunkSize) {
  const chunks = [];
  let index = 0;
  while (index < json.length) {
    let end = Math.min(index + chunkSize, json.length);
    while (end < json.length && /[A-Za-z0-9_]/.test(json[end - 1])) {
      end++;
    }
    chunks.push(json.slice(index, end));
    index = end;
  }
  return chunks;
}

function generatedModuleTs(moduleAssets) {
  const json = JSON.stringify(moduleAssets);
  const chunkSize = 12000;
  const chunks = safeJsonChunks(json, chunkSize);
  return [
    "import type { AssetDocumentBase } from \"../../../../core/assets/schema\";",
    "",
    "const raw = [",
    ...chunks.map(chunk => `  ${JSON.stringify(chunk)},`),
    "].join(\"\");",
    "",
    "const modules = JSON.parse(raw) as AssetDocumentBase[];",
    "",
    "export default modules;",
    "",
  ].join("\n");
}

function main() {
  const inventory = readJson(INVENTORY);
  const ledgerDoc = readJson(LEDGER);
  const apis = inventory.apis || [];
  const apiByKey = new Map(apis.map(api => [apiKey(api), api]));
  const rows = ledgerDoc.rows || [];
  optionCallbackRegistrationByPropertyKey = buildOptionCallbackRegistrationIndex(apis);
  canonicalApiIdReplacementMap = buildCanonicalApiIdReplacementMap(rows, apiByKey);
  const ruleAssets = {
    source: newRuleAsset("source"),
    sink: newRuleAsset("sink"),
    transfer: newRuleAsset("transfer"),
    sanitizer: newRuleAsset("sanitizer"),
  };
  const moduleAssetGroups = new Map();
  const arkmainMethods = [];
const stats = {
    source: 0,
    sink: 0,
    transfer: 0,
    sanitizer: 0,
    module: 0,
    arkmain: 0,
    skippedNoApi: 0,
    propertyModuleRoleCoveredByRule: 0,
    skippedUnsupportedRuleSurface: 0,
    skippedUnsupportedModuleSurface: 0,
    manualReview: 0,
  };

  for (const row of rows) {
    if (row.manualReviewStatus !== "confirmed") continue;
    if (row.implementationStatus !== "implemented") continue;
    const api = apiByKey.get(row.signatureKey);
    if (!api) {
      stats.skippedNoApi++;
      continue;
    }
    const generatedStatefulCategories = new Set();
    for (const role of row.roles || []) {
      for (const category of categoriesForRole(role)) {
        if (category === "module" || category === "arkmain") {
          if (generatedStatefulCategories.has(category)) continue;
          generatedStatefulCategories.add(category);
        }
        if (!roleNeedsGeneration(row, role, category)) continue;
        if (!categoryHasGeneratedSurface(api, row, category)) {
          recordGenerationManualReview(row, api, category, manualReviewReasonForCategory(api, row, category));
          if (category === "module") stats.skippedUnsupportedModuleSurface++;
          else stats.skippedUnsupportedRuleSurface++;
          continue;
        }
        if (category === "source") {
          const source = sourceEndpointAndKind(api);
          if (!source?.surfaceApi) {
            recordGenerationManualReview(row, api, category, manualReviewReasonForCategory(api, row, category));
            stats.skippedUnsupportedRuleSurface++;
            continue;
          }
          addRuleBinding(ruleAssets.source, source.surfaceApi, row, "source", source.value, { sourceKind: source.sourceKind });
          stats.source++;
          continue;
        }
        if (category === "sink") {
          const endpoints = sinkEndpoints(api, row.family);
          for (const [ordinal, endpoint] of endpoints.entries()) {
            addRuleBinding(ruleAssets.sink, api, row, "sink", endpoint, { ordinal });
            stats.sink++;
          }
          continue;
        }
        if (category === "transfer") {
          for (const [ordinal, pair] of transferPairs(api, row.family).entries()) {
            addRuleBinding(ruleAssets.transfer, api, row, "transfer", pair, { ordinal });
            stats.transfer++;
          }
          continue;
        }
        if (category === "sanitizer") {
          for (const [ordinal, pair] of sanitizerPairs(api).entries()) {
            addRuleBinding(ruleAssets.sanitizer, api, row, "sanitizer", pair, { ordinal });
            stats.sanitizer++;
          }
          continue;
        }
        if (category === "module") {
          const effects = moduleEffectsForApi(api, row);
          if (effects.length === 0) {
            if (api.kind === "property") {
              stats.propertyModuleRoleCoveredByRule++;
              continue;
            }
            stats.skippedUnsupportedModuleSurface++;
            continue;
          }
          addModuleDeclarationAsset(moduleAssetGroups, api, row, effects);
          stats.module++;
          continue;
        }
        if (category === "arkmain") {
          arkmainMethods.push({
            api,
            row,
          });
          stats.arkmain++;
        }
      }
    }
  }

  for (const [role, asset] of Object.entries(ruleAssets)) {
    delete asset._surfaces;
    delete asset._bindingKeys;
    const file =
      role === "source" ? "src/models/kernel/rules/sources/official_declarations.rules.json" :
      role === "sink" ? "src/models/kernel/rules/sinks/official_declarations.rules.json" :
      role === "transfer" ? "src/models/kernel/rules/transfers/official_declarations.rules.json" :
      "src/models/kernel/rules/sanitizers/official_declarations.rules.json";
    writeJson(file, asset);
  }

  writeText(
    "src/models/kernel/modules/harmony/official_declaration_semantic_slots.ts",
    generatedModuleTs(finalizeModuleAssetGroups(moduleAssetGroups)),
  );

  const arkmainOutputFile = "src/models/kernel/arkmain/harmony/official_declarations.catalog.json";
  if (arkmainMethods.length > 0) {
    const arkmainAsset = {
      id: "arkmain.harmony.official_declarations",
      plane: "arkmain",
      status: "official",
      surfaces: [],
      bindings: [],
      effectTemplates: [],
      provenance: {
        source: "builtin",
        evidenceLocations: [
          { file: "internal_docs/security_asset_iteration/official_api_declaration_manual_review.jsonl" },
          { file: "internal_docs/security_asset_iteration/official_api_declaration_coverage_ledger.json" },
        ],
      },
      _surfaceIds: new Set(),
      _bindingKeys: new Set(),
    };
    for (const { api, row } of arkmainMethods) {
      const id = `arkmain.official.${hash(row.signatureKey)}`;
      const surface = surfaceForApi(api, "arkmain-entry", id);
      const bindingKey = `${surface.canonicalApiId}|${row.family || "official-declaration"}|${row.kind || ""}`;
      if (arkmainAsset._bindingKeys.has(bindingKey)) continue;
      arkmainAsset._bindingKeys.add(bindingKey);
      if (!arkmainAsset._surfaceIds.has(surface.surfaceId)) {
        arkmainAsset._surfaceIds.add(surface.surfaceId);
        arkmainAsset.surfaces.push(surface);
      }
      const templateId = `template:${arkmainAsset.id}:${hash(row.signatureKey)}:entry`;
      arkmainAsset.effectTemplates.push({
        id: templateId,
        kind: "entry.lifecycle",
        entryKind: row.family || "official-declaration",
        phase: "bootstrap",
        ownerKind: row.namespaceOrClass || undefined,
        entryShape: row.kind || undefined,
        confidence: "certain",
      });
      arkmainAsset.bindings.push({
        bindingId: `binding:${arkmainAsset.id}:${hash(row.signatureKey)}:entry`,
        surfaceId: surface.surfaceId,
        canonicalApiId: surface.canonicalApiId,
        assetId: arkmainAsset.id,
        plane: "arkmain",
        role: "entry",
        effectTemplateRefs: [templateId],
        semanticsFamily: row.family,
        metadata: {
          description: `Official SDK declaration ${row.signatureKey} as arkmain entry.`,
        },
        completeness: "complete",
        confidence: "certain",
      });
      if (row.sdkFile) {
        arkmainAsset.provenance.evidenceLocations.push({ file: row.sdkFile, line: row.line });
      }
    }
    delete arkmainAsset._surfaceIds;
    delete arkmainAsset._bindingKeys;
    arkmainAsset.surfaces.sort((a, b) => a.surfaceId.localeCompare(b.surfaceId));
    arkmainAsset.bindings.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
    arkmainAsset.effectTemplates.sort((a, b) => a.id.localeCompare(b.id));
    writeJson(arkmainOutputFile, {
      ...arkmainAsset,
    });
  } else {
    removeIfExists(arkmainOutputFile);
  }

  stats.manualReview = generationManualReview.length;
  const manualReviewByReason = {};
  for (const item of generationManualReview) {
    manualReviewByReason[item.reason] = (manualReviewByReason[item.reason] || 0) + 1;
  }
  writeText(
    "internal_docs/security_asset_iteration/official_api_semantic_asset_generation_manual_review.jsonl",
    toJsonl(generationManualReview),
  );
  writeJson("internal_docs/security_asset_iteration/official_api_semantic_asset_generation_summary.json", {
    generatedAt: new Date().toISOString(),
    stats,
    manualReviewCount: generationManualReview.length,
    manualReviewByReason,
    manualReviewArtifact: "internal_docs/security_asset_iteration/official_api_semantic_asset_generation_manual_review.jsonl",
    moduleAssetGroups: moduleAssetGroups.size,
    outputFiles: [
      "src/models/kernel/rules/sources/official_declarations.rules.json",
      "src/models/kernel/rules/sinks/official_declarations.rules.json",
      "src/models/kernel/rules/transfers/official_declarations.rules.json",
      "src/models/kernel/rules/sanitizers/official_declarations.rules.json",
      "src/models/kernel/modules/harmony/official_declaration_semantic_slots.ts",
      ...(arkmainMethods.length > 0 ? ["src/models/kernel/arkmain/harmony/official_declarations.catalog.json"] : []),
    ],
  });

  console.log(`generated official api semantic assets ${JSON.stringify(stats)}`);
}

main();
