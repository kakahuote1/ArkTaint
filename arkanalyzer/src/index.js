"use strict";
/*
 * Copyright (c) 2024-2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArkNamespace = exports.ArkFile = exports.SCCDetection = exports.BaseExplicitGraph = exports.BaseNode = exports.BaseEdge = exports.DominanceTree = exports.DominanceFinder = exports.Cfg = exports.BasicBlock = exports.UndefinedVariableSolver = exports.UndefinedVariableChecker = exports.Fact = exports.PathEdge = exports.PathEdgePoint = exports.DataflowSolver = exports.DataflowResult = exports.DataflowProblem = exports.Scope = exports.VisibleValue = exports.ValueUtil = exports.TypeInference = exports.StmtUseReplacer = exports.RefUseReplacer = exports.IRUtils = exports.ExprUseReplacer = exports.DummyMainCreater = exports.ModelUtils = exports.FullPosition = exports.LineColPosition = exports.Local = exports.DefUseChain = exports.Decorator = exports.Constant = exports.DVFGBuilder = exports.DVFG = exports.DiffPTData = exports.PtsSet = exports.PointerAnalysisConfig = exports.PointerAnalysis = exports.PagBuilder = exports.CSFuncID = exports.DummyCallCreator = exports.CallGraphBuilder = exports.CGStat = exports.PAGStat = exports.PTAStat = exports.RapidTypeAnalysis = exports.ClassHierarchyAnalysis = exports.AbstractAnalysis = void 0;
exports.ts = exports.PackedSparseMap = exports.IntWorkList = exports.IntMap = exports.Logger = exports.LOG_MODULE_TYPE = exports.LOG_LEVEL = exports.ViewTreePrinter = exports.GraphPrinter = exports.JsonPrinter = exports.SourceFilePrinter = exports.SourceNamespacePrinter = exports.SourceClassPrinter = exports.SourceMethodPrinter = exports.DotFilePrinter = exports.DotNamespacePrinter = exports.DotClassPrinter = exports.DotMethodPrinter = exports.PrinterBuilder = exports.Printer = exports.Scene = exports.SceneConfig = exports.ArkBody = exports.ImportInfo = exports.ExportInfo = exports.ArkField = exports.ArkMethod = exports.ArkClass = void 0;
// callgraph/algorithm
var AbstractAnalysis_1 = require("./callgraph/algorithm/AbstractAnalysis");
Object.defineProperty(exports, "AbstractAnalysis", { enumerable: true, get: function () { return AbstractAnalysis_1.AbstractAnalysis; } });
var ClassHierarchyAnalysis_1 = require("./callgraph/algorithm/ClassHierarchyAnalysis");
Object.defineProperty(exports, "ClassHierarchyAnalysis", { enumerable: true, get: function () { return ClassHierarchyAnalysis_1.ClassHierarchyAnalysis; } });
var RapidTypeAnalysis_1 = require("./callgraph/algorithm/RapidTypeAnalysis");
Object.defineProperty(exports, "RapidTypeAnalysis", { enumerable: true, get: function () { return RapidTypeAnalysis_1.RapidTypeAnalysis; } });
// callgraph/common
var Statistics_1 = require("./callgraph/common/Statistics");
Object.defineProperty(exports, "PTAStat", { enumerable: true, get: function () { return Statistics_1.PTAStat; } });
Object.defineProperty(exports, "PAGStat", { enumerable: true, get: function () { return Statistics_1.PAGStat; } });
Object.defineProperty(exports, "CGStat", { enumerable: true, get: function () { return Statistics_1.CGStat; } });
// callgraph/model
__exportStar(require("./callgraph/model/CallGraph"), exports);
var CallGraphBuilder_1 = require("./callgraph/model/builder/CallGraphBuilder");
Object.defineProperty(exports, "CallGraphBuilder", { enumerable: true, get: function () { return CallGraphBuilder_1.CallGraphBuilder; } });
// callgraph/pointerAnalysis
var DummyCallCreator_1 = require("./callgraph/pointerAnalysis/DummyCallCreator");
Object.defineProperty(exports, "DummyCallCreator", { enumerable: true, get: function () { return DummyCallCreator_1.DummyCallCreator; } });
__exportStar(require("./callgraph/pointerAnalysis/Pag"), exports);
var PagBuilder_1 = require("./callgraph/pointerAnalysis/PagBuilder");
Object.defineProperty(exports, "CSFuncID", { enumerable: true, get: function () { return PagBuilder_1.CSFuncID; } });
Object.defineProperty(exports, "PagBuilder", { enumerable: true, get: function () { return PagBuilder_1.PagBuilder; } });
var PointerAnalysis_1 = require("./callgraph/pointerAnalysis/PointerAnalysis");
Object.defineProperty(exports, "PointerAnalysis", { enumerable: true, get: function () { return PointerAnalysis_1.PointerAnalysis; } });
var PointerAnalysisConfig_1 = require("./callgraph/pointerAnalysis/PointerAnalysisConfig");
Object.defineProperty(exports, "PointerAnalysisConfig", { enumerable: true, get: function () { return PointerAnalysisConfig_1.PointerAnalysisConfig; } });
var PtsDS_1 = require("./callgraph/pointerAnalysis/PtsDS");
Object.defineProperty(exports, "PtsSet", { enumerable: true, get: function () { return PtsDS_1.PtsSet; } });
Object.defineProperty(exports, "DiffPTData", { enumerable: true, get: function () { return PtsDS_1.DiffPTData; } });
var DVFG_1 = require("./VFG/DVFG");
Object.defineProperty(exports, "DVFG", { enumerable: true, get: function () { return DVFG_1.DVFG; } });
var DVFGBuilder_1 = require("./VFG/builder/DVFGBuilder");
Object.defineProperty(exports, "DVFGBuilder", { enumerable: true, get: function () { return DVFGBuilder_1.DVFGBuilder; } });
// core/base
var Constant_1 = require("./core/base/Constant");
Object.defineProperty(exports, "Constant", { enumerable: true, get: function () { return Constant_1.Constant; } });
var Decorator_1 = require("./core/base/Decorator");
Object.defineProperty(exports, "Decorator", { enumerable: true, get: function () { return Decorator_1.Decorator; } });
var DefUseChain_1 = require("./core/base/DefUseChain");
Object.defineProperty(exports, "DefUseChain", { enumerable: true, get: function () { return DefUseChain_1.DefUseChain; } });
__exportStar(require("./core/base/Expr"), exports);
var Local_1 = require("./core/base/Local");
Object.defineProperty(exports, "Local", { enumerable: true, get: function () { return Local_1.Local; } });
var Position_1 = require("./core/base/Position");
Object.defineProperty(exports, "LineColPosition", { enumerable: true, get: function () { return Position_1.LineColPosition; } });
Object.defineProperty(exports, "FullPosition", { enumerable: true, get: function () { return Position_1.FullPosition; } });
__exportStar(require("./core/base/Ref"), exports);
__exportStar(require("./core/base/Stmt"), exports);
__exportStar(require("./core/base/Type"), exports);
// core/common
var ModelUtils_1 = require("./core/common/ModelUtils");
Object.defineProperty(exports, "ModelUtils", { enumerable: true, get: function () { return ModelUtils_1.ModelUtils; } });
__exportStar(require("./core/common/Const"), exports);
var DummyMainCreater_1 = require("./core/common/DummyMainCreater");
Object.defineProperty(exports, "DummyMainCreater", { enumerable: true, get: function () { return DummyMainCreater_1.DummyMainCreater; } });
__exportStar(require("./core/common/EtsConst"), exports);
var ExprUseReplacer_1 = require("./core/common/ExprUseReplacer");
Object.defineProperty(exports, "ExprUseReplacer", { enumerable: true, get: function () { return ExprUseReplacer_1.ExprUseReplacer; } });
var IRUtils_1 = require("./core/common/IRUtils");
Object.defineProperty(exports, "IRUtils", { enumerable: true, get: function () { return IRUtils_1.IRUtils; } });
var RefUseReplacer_1 = require("./core/common/RefUseReplacer");
Object.defineProperty(exports, "RefUseReplacer", { enumerable: true, get: function () { return RefUseReplacer_1.RefUseReplacer; } });
var StmtUseReplacer_1 = require("./core/common/StmtUseReplacer");
Object.defineProperty(exports, "StmtUseReplacer", { enumerable: true, get: function () { return StmtUseReplacer_1.StmtUseReplacer; } });
__exportStar(require("./core/common/TSConst"), exports);
var TypeInference_1 = require("./core/common/TypeInference");
Object.defineProperty(exports, "TypeInference", { enumerable: true, get: function () { return TypeInference_1.TypeInference; } });
var ValueUtil_1 = require("./core/common/ValueUtil");
Object.defineProperty(exports, "ValueUtil", { enumerable: true, get: function () { return ValueUtil_1.ValueUtil; } });
var VisibleValue_1 = require("./core/common/VisibleValue");
Object.defineProperty(exports, "VisibleValue", { enumerable: true, get: function () { return VisibleValue_1.VisibleValue; } });
Object.defineProperty(exports, "Scope", { enumerable: true, get: function () { return VisibleValue_1.Scope; } });
// core/dataflow
var DataflowProblem_1 = require("./core/dataflow/DataflowProblem");
Object.defineProperty(exports, "DataflowProblem", { enumerable: true, get: function () { return DataflowProblem_1.DataflowProblem; } });
var DataflowResult_1 = require("./core/dataflow/DataflowResult");
Object.defineProperty(exports, "DataflowResult", { enumerable: true, get: function () { return DataflowResult_1.DataflowResult; } });
var DataflowSolver_1 = require("./core/dataflow/DataflowSolver");
Object.defineProperty(exports, "DataflowSolver", { enumerable: true, get: function () { return DataflowSolver_1.DataflowSolver; } });
var Edge_1 = require("./core/dataflow/Edge");
Object.defineProperty(exports, "PathEdgePoint", { enumerable: true, get: function () { return Edge_1.PathEdgePoint; } });
Object.defineProperty(exports, "PathEdge", { enumerable: true, get: function () { return Edge_1.PathEdge; } });
var Fact_1 = require("./core/dataflow/Fact");
Object.defineProperty(exports, "Fact", { enumerable: true, get: function () { return Fact_1.Fact; } });
var UndefinedVariable_1 = require("./core/dataflow/UndefinedVariable");
Object.defineProperty(exports, "UndefinedVariableChecker", { enumerable: true, get: function () { return UndefinedVariable_1.UndefinedVariableChecker; } });
Object.defineProperty(exports, "UndefinedVariableSolver", { enumerable: true, get: function () { return UndefinedVariable_1.UndefinedVariableSolver; } });
// core/graph
var BasicBlock_1 = require("./core/graph/BasicBlock");
Object.defineProperty(exports, "BasicBlock", { enumerable: true, get: function () { return BasicBlock_1.BasicBlock; } });
var Cfg_1 = require("./core/graph/Cfg");
Object.defineProperty(exports, "Cfg", { enumerable: true, get: function () { return Cfg_1.Cfg; } });
var DominanceFinder_1 = require("./core/graph/DominanceFinder");
Object.defineProperty(exports, "DominanceFinder", { enumerable: true, get: function () { return DominanceFinder_1.DominanceFinder; } });
var DominanceTree_1 = require("./core/graph/DominanceTree");
Object.defineProperty(exports, "DominanceTree", { enumerable: true, get: function () { return DominanceTree_1.DominanceTree; } });
var BaseExplicitGraph_1 = require("./core/graph/BaseExplicitGraph");
Object.defineProperty(exports, "BaseEdge", { enumerable: true, get: function () { return BaseExplicitGraph_1.BaseEdge; } });
Object.defineProperty(exports, "BaseNode", { enumerable: true, get: function () { return BaseExplicitGraph_1.BaseNode; } });
Object.defineProperty(exports, "BaseExplicitGraph", { enumerable: true, get: function () { return BaseExplicitGraph_1.BaseExplicitGraph; } });
var Scc_1 = require("./core/graph/Scc");
Object.defineProperty(exports, "SCCDetection", { enumerable: true, get: function () { return Scc_1.SCCDetection; } });
// core/model
var ArkFile_1 = require("./core/model/ArkFile");
Object.defineProperty(exports, "ArkFile", { enumerable: true, get: function () { return ArkFile_1.ArkFile; } });
var ArkNamespace_1 = require("./core/model/ArkNamespace");
Object.defineProperty(exports, "ArkNamespace", { enumerable: true, get: function () { return ArkNamespace_1.ArkNamespace; } });
var ArkClass_1 = require("./core/model/ArkClass");
Object.defineProperty(exports, "ArkClass", { enumerable: true, get: function () { return ArkClass_1.ArkClass; } });
var ArkMethod_1 = require("./core/model/ArkMethod");
Object.defineProperty(exports, "ArkMethod", { enumerable: true, get: function () { return ArkMethod_1.ArkMethod; } });
var ArkField_1 = require("./core/model/ArkField");
Object.defineProperty(exports, "ArkField", { enumerable: true, get: function () { return ArkField_1.ArkField; } });
var ArkExport_1 = require("./core/model/ArkExport");
Object.defineProperty(exports, "ExportInfo", { enumerable: true, get: function () { return ArkExport_1.ExportInfo; } });
var ArkImport_1 = require("./core/model/ArkImport");
Object.defineProperty(exports, "ImportInfo", { enumerable: true, get: function () { return ArkImport_1.ImportInfo; } });
var ArkBody_1 = require("./core/model/ArkBody");
Object.defineProperty(exports, "ArkBody", { enumerable: true, get: function () { return ArkBody_1.ArkBody; } });
__exportStar(require("./core/model/ArkSignature"), exports);
__exportStar(require("./core/model/builder/ArkSignatureBuilder"), exports);
var Config_1 = require("./Config");
Object.defineProperty(exports, "SceneConfig", { enumerable: true, get: function () { return Config_1.SceneConfig; } });
var Scene_1 = require("./Scene");
Object.defineProperty(exports, "Scene", { enumerable: true, get: function () { return Scene_1.Scene; } });
// save
var Printer_1 = require("./save/Printer");
Object.defineProperty(exports, "Printer", { enumerable: true, get: function () { return Printer_1.Printer; } });
var PrinterBuilder_1 = require("./save/PrinterBuilder");
Object.defineProperty(exports, "PrinterBuilder", { enumerable: true, get: function () { return PrinterBuilder_1.PrinterBuilder; } });
var DotPrinter_1 = require("./save/DotPrinter");
Object.defineProperty(exports, "DotMethodPrinter", { enumerable: true, get: function () { return DotPrinter_1.DotMethodPrinter; } });
Object.defineProperty(exports, "DotClassPrinter", { enumerable: true, get: function () { return DotPrinter_1.DotClassPrinter; } });
Object.defineProperty(exports, "DotNamespacePrinter", { enumerable: true, get: function () { return DotPrinter_1.DotNamespacePrinter; } });
Object.defineProperty(exports, "DotFilePrinter", { enumerable: true, get: function () { return DotPrinter_1.DotFilePrinter; } });
var SourceMethod_1 = require("./save/source/SourceMethod");
Object.defineProperty(exports, "SourceMethodPrinter", { enumerable: true, get: function () { return SourceMethod_1.SourceMethod; } });
var SourceClass_1 = require("./save/source/SourceClass");
Object.defineProperty(exports, "SourceClassPrinter", { enumerable: true, get: function () { return SourceClass_1.SourceClass; } });
var SourceNamespace_1 = require("./save/source/SourceNamespace");
Object.defineProperty(exports, "SourceNamespacePrinter", { enumerable: true, get: function () { return SourceNamespace_1.SourceNamespace; } });
var SourceFilePrinter_1 = require("./save/source/SourceFilePrinter");
Object.defineProperty(exports, "SourceFilePrinter", { enumerable: true, get: function () { return SourceFilePrinter_1.SourceFilePrinter; } });
var JsonPrinter_1 = require("./save/json/JsonPrinter");
Object.defineProperty(exports, "JsonPrinter", { enumerable: true, get: function () { return JsonPrinter_1.JsonPrinter; } });
var GraphPrinter_1 = require("./save/GraphPrinter");
Object.defineProperty(exports, "GraphPrinter", { enumerable: true, get: function () { return GraphPrinter_1.GraphPrinter; } });
var ViewTreePrinter_1 = require("./save/ViewTreePrinter");
Object.defineProperty(exports, "ViewTreePrinter", { enumerable: true, get: function () { return ViewTreePrinter_1.ViewTreePrinter; } });
// transformer
__exportStar(require("./transformer/StaticSingleAssignmentFormer"), exports);
// utils
__exportStar(require("./utils/callGraphUtils"), exports);
__exportStar(require("./utils/entryMethodUtils"), exports);
__exportStar(require("./utils/FileUtils"), exports);
__exportStar(require("./utils/getAllFiles"), exports);
__exportStar(require("./utils/json5parser"), exports);
__exportStar(require("./utils/pathTransfer"), exports);
__exportStar(require("./utils/AstTreeUtils"), exports);
var logger_1 = require("./utils/logger");
Object.defineProperty(exports, "LOG_LEVEL", { enumerable: true, get: function () { return logger_1.LOG_LEVEL; } });
Object.defineProperty(exports, "LOG_MODULE_TYPE", { enumerable: true, get: function () { return logger_1.LOG_MODULE_TYPE; } });
var logger_2 = require("./utils/logger");
Object.defineProperty(exports, "Logger", { enumerable: true, get: function () { return __importDefault(logger_2).default; } });
var IntMap_1 = require("./utils/IntMap");
Object.defineProperty(exports, "IntMap", { enumerable: true, get: function () { return IntMap_1.IntMap; } });
var IntWorkList_1 = require("./utils/IntWorkList");
Object.defineProperty(exports, "IntWorkList", { enumerable: true, get: function () { return IntWorkList_1.IntWorkList; } });
var PackedSparseMap_1 = require("./utils/PackedSparseMap");
Object.defineProperty(exports, "PackedSparseMap", { enumerable: true, get: function () { return PackedSparseMap_1.PackedSparseMap; } });
//ohos-typescript
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
exports.ts = ohos_typescript_1.default;
//# sourceMappingURL=index.js.map