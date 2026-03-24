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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallGraphBuilder = void 0;
const CallGraph_1 = require("../CallGraph");
const Expr_1 = require("../../../core/base/Expr");
const ClassHierarchyAnalysis_1 = require("../../algorithm/ClassHierarchyAnalysis");
const RapidTypeAnalysis_1 = require("../../algorithm/RapidTypeAnalysis");
class CallGraphBuilder {
    constructor(c, s) {
        this.cg = c;
        this.scene = s;
    }
    buildDirectCallGraphForScene() {
        const methods = this.scene.getMethods();
        this.buildDirectCallGraph(methods);
        // set entries at end
        this.setEntries();
    }
    /*
     * Create CG Node for ArkMethods
     */
    buildCGNodes(methods) {
        for (const method of methods) {
            let m = method.getSignature();
            let kind = CallGraph_1.CallGraphNodeKind.real;
            if (method.isGenerated()) {
                kind = CallGraph_1.CallGraphNodeKind.intrinsic;
            }
            else if (method.getBody() === undefined || method.getCfg() === undefined) {
                kind = CallGraph_1.CallGraphNodeKind.blank;
            }
            else if (method.getName() === 'constructor') {
                kind = CallGraph_1.CallGraphNodeKind.constructor;
            }
            this.cg.addCallGraphNode(m, kind);
        }
    }
    buildDirectCallGraph(methods) {
        this.buildCGNodes(methods);
        for (const method of methods) {
            let cfg = method.getCfg();
            if (cfg === undefined) {
                // abstract method cfg is undefined
                continue;
            }
            let stmts = cfg.getStmts();
            for (const stmt of stmts) {
                let invokeExpr = stmt.getInvokeExpr();
                if (invokeExpr === undefined) {
                    continue;
                }
                let callee = this.getDCCallee(invokeExpr);
                // abstract method will also be added into direct cg
                if (callee && invokeExpr instanceof Expr_1.ArkStaticInvokeExpr) {
                    this.cg.addDirectOrSpecialCallEdge(method.getSignature(), callee, stmt);
                }
                else {
                    this.cg.addDynamicCallInfo(stmt, method.getSignature(), callee);
                }
            }
        }
    }
    buildClassHierarchyCallGraph(entries, displayGeneratedMethod = false) {
        let cgEntries = [];
        entries.forEach((entry) => {
            cgEntries.push(this.cg.getCallGraphNodeByMethod(entry).getID());
        });
        this.cg.setEntries(cgEntries);
        let classHierarchyAnalysis = new ClassHierarchyAnalysis_1.ClassHierarchyAnalysis(this.scene, this.cg, this);
        classHierarchyAnalysis.start(displayGeneratedMethod);
    }
    buildCHA4WholeProject(displayGeneratedMethod = false) {
        let classHierarchyAnalysis = new ClassHierarchyAnalysis_1.ClassHierarchyAnalysis(this.scene, this.cg, this);
        classHierarchyAnalysis.projectStart(displayGeneratedMethod);
    }
    buildRapidTypeCallGraph(entries, displayGeneratedMethod = false) {
        let cgEntries = [];
        entries.forEach((entry) => {
            cgEntries.push(this.cg.getCallGraphNodeByMethod(entry).getID());
        });
        this.cg.setEntries(cgEntries);
        let rapidTypeAnalysis = new RapidTypeAnalysis_1.RapidTypeAnalysis(this.scene, this.cg);
        rapidTypeAnalysis.start(displayGeneratedMethod);
    }
    /// Get direct call callee
    getDCCallee(invokeExpr) {
        return invokeExpr.getMethodSignature();
    }
    setEntries() {
        let nodesIter = this.cg.getNodesIter();
        let entries = Array.from(nodesIter)
            .filter(node => !node.hasIncomingEdges() && node.getKind() === CallGraph_1.CallGraphNodeKind.real && !node.isBlankMethod)
            .map(node => node.getID());
        this.cg.setEntries(entries);
    }
}
exports.CallGraphBuilder = CallGraphBuilder;
