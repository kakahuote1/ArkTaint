"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DVFGEdge = exports.DVFGNode = exports.DVFGNodeKind = exports.DVFG = void 0;
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License"); * you may not use this file except in compliance with the License.
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
const BaseExplicitGraph_1 = require("../core/graph/BaseExplicitGraph");
const Stmt_1 = require("../core/base/Stmt");
const GraphPrinter_1 = require("../save/GraphPrinter");
const PrinterBuilder_1 = require("../save/PrinterBuilder");
/**
 * Direct value flow graph
 * Consist of stmt(node) and direct Def-Use edge
 * Is basic of VFG. And VFG is building on DVFG
 */
class DVFG extends BaseExplicitGraph_1.BaseExplicitGraph {
    constructor(cg) {
        super();
        this.cg = cg;
        this.stmtToVFGMap = new Map();
    }
    getCG() {
        return this.cg;
    }
    getGraphName() {
        return 'Direct-VFG';
    }
    getOrNewDVFGNode(stmt) {
        let node = this.stmtToVFGMap.get(stmt);
        if (node) {
            return this.getNode(node);
        }
        let kind = DVFGNodeKind.normal;
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            //TODO: split assign to copy, write, load
            kind = DVFGNodeKind.assign;
        }
        else {
            // TODO: handle other type of stmt
        }
        return this.addDVFGNode(stmt, kind);
    }
    addDVFGNode(stmt, kind) {
        let id = this.nodeNum;
        let dvfgNode = new DVFGNode(id, kind, stmt);
        this.addNode(dvfgNode);
        this.stmtToVFGMap.set(stmt, dvfgNode.getID());
        return dvfgNode;
    }
    addDVFGEdge(src, dst) {
        let kind = 0; //common kind
        let edge = new DVFGEdge(src, dst, kind);
        if (this.ifEdgeExisting(edge)) {
            return false;
        }
        src.addOutgoingEdge(edge);
        dst.addIncomingEdge(edge);
        return true;
    }
    dump(name) {
        let printer = new GraphPrinter_1.GraphPrinter(this);
        PrinterBuilder_1.PrinterBuilder.dump(printer, name);
    }
}
exports.DVFG = DVFG;
var DVFGNodeKind;
(function (DVFGNodeKind) {
    DVFGNodeKind[DVFGNodeKind["assign"] = 0] = "assign";
    DVFGNodeKind[DVFGNodeKind["copy"] = 1] = "copy";
    DVFGNodeKind[DVFGNodeKind["write"] = 2] = "write";
    DVFGNodeKind[DVFGNodeKind["load"] = 3] = "load";
    DVFGNodeKind[DVFGNodeKind["addr"] = 4] = "addr";
    DVFGNodeKind[DVFGNodeKind["if"] = 5] = "if";
    DVFGNodeKind[DVFGNodeKind["actualParm"] = 6] = "actualParm";
    DVFGNodeKind[DVFGNodeKind["formalParm"] = 7] = "formalParm";
    DVFGNodeKind[DVFGNodeKind["actualRet"] = 8] = "actualRet";
    DVFGNodeKind[DVFGNodeKind["formalRet"] = 9] = "formalRet";
    DVFGNodeKind[DVFGNodeKind["unary"] = 10] = "unary";
    DVFGNodeKind[DVFGNodeKind["binary"] = 11] = "binary";
    DVFGNodeKind[DVFGNodeKind["normal"] = 12] = "normal";
})(DVFGNodeKind = exports.DVFGNodeKind || (exports.DVFGNodeKind = {}));
class DVFGNode extends BaseExplicitGraph_1.BaseNode {
    constructor(i, k, s) {
        super(i, k);
        this.stmt = s;
    }
    getDotLabel() {
        let label = 'ID: ' + this.getID() + '\n';
        label = label + this.stmt.toString();
        return label;
    }
    getStmt() {
        return this.stmt;
    }
}
exports.DVFGNode = DVFGNode;
class DVFGEdge extends BaseExplicitGraph_1.BaseEdge {
}
exports.DVFGEdge = DVFGEdge;
