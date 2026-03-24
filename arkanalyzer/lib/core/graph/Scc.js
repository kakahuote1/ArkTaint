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
exports.SCCDetection = void 0;
/**
 * Basic SCC info for a single node
 */
class NodeSCCInfo {
    constructor() {
        this._rep = Number.MAX_SAFE_INTEGER;
        this._subNodes = new Set();
    }
    get rep() {
        return this._rep;
    }
    set rep(n) {
        this._rep = n;
    }
    addSubNodes(n) {
        this._subNodes.add(n);
    }
    get subNodes() {
        return this._subNodes;
    }
}
/**
 * Detect strongly connected components in a directed graph
 * A topological graph is an extra product from this algorithm
 * Advanced Nuutila’s algorithm which come from the following paper:
 *   Wave Propagation and Deep Propagation for pointer Analysis
 *   CGO 2009
 */
class SCCDetection {
    constructor(GT) {
        this._G = GT;
        this._I = 0;
        this._D = new Map();
        this._S = new Array();
        this._T = new Array();
        this.repNodes = new Set();
        this._R = new Map();
        this.visitedNodes = new Set();
        this.inSCCNodes = new Set();
    }
    isVisited(n) {
        return this.visitedNodes.has(n);
    }
    inSCC(n) {
        return this.inSCCNodes.has(n);
    }
    setVisited(n) {
        this.visitedNodes.add(n);
    }
    setInSCC(n) {
        this.inSCCNodes.add(n);
    }
    setRep(n, r) {
        let sccIn = this._R.get(n);
        if (!sccIn) {
            sccIn = new NodeSCCInfo();
            this._R.set(n, sccIn);
        }
        sccIn.rep = r;
        let rInfo = this._R.get(r);
        if (!rInfo) {
            rInfo = new NodeSCCInfo();
            this._R.set(r, rInfo);
        }
        rInfo.addSubNodes(n);
        if (n !== r) {
            sccIn.subNodes.clear();
            this.repNodes.add(r);
        }
    }
    getRep(n) {
        let info = this._R.get(n);
        if (!info) {
            info = new NodeSCCInfo();
            this._R.set(n, info);
        }
        return info.rep;
    }
    getNode(id) {
        let n = this._G.getNode(id);
        if (!n) {
            throw new Error('Node is not found');
        }
        return n;
    }
    visit(v) {
        this._I += 1;
        this._D.set(v, this._I);
        this.setRep(v, v);
        this.setVisited(v);
        let node = this.getNode(v);
        node.getOutgoingEdges().forEach(e => {
            let w = e.getDstID();
            if (!this.isVisited(w)) {
                this.visit(w);
            }
            if (!this.inSCC(w)) {
                let repV = this.getRep(v);
                let repW = this.getRep(w);
                if (!this._D.has(repV) || !this._D.has(repW)) {
                    throw new Error('Error happening in SCC detection');
                }
                let rep = this._D.get(repV) < this._D.get(repW) ? repV : repW;
                this.setRep(v, rep);
            }
        });
        if (this.getRep(v) === v) {
            this.setInSCC(v);
            while (this._S.length > 0) {
                let w = this._S[this._S.length - 1];
                if (this._D.get(w) <= this._D.get(v)) {
                    break;
                }
                else {
                    this._S.pop();
                    this.setInSCC(w);
                    this.setRep(w, v);
                }
            }
            this._T.push(v);
        }
        else {
            this._S.push(v);
        }
    }
    clear() {
        this._R.clear();
        this._I = 0;
        this._D.clear();
        this.repNodes.clear();
        this._S.length = 0;
        this._T.length = 0;
        this.inSCCNodes.clear();
        this.visitedNodes.clear();
    }
    /**
     * Get the rep node
     * If not found return itself
     */
    getRepNode(n) {
        const it = this._R.get(n);
        if (!it) {
            throw new Error('scc rep not found');
        }
        const rep = it.rep;
        return rep !== Number.MAX_SAFE_INTEGER ? rep : n;
    }
    /**
     * Start to detect and collapse SCC
     */
    find() {
        this.clear();
        let nodeIt = this._G.nodesItor();
        for (let node of nodeIt) {
            const nodeId = node.getID();
            if (!this.isVisited(nodeId) && !this._D.has(nodeId)) {
                this.visit(nodeId);
            }
        }
    }
    getTopoAndCollapsedNodeStack() {
        return this._T;
    }
    getNode2SCCInfoMap() {
        return this._R;
    }
    // whether the node is in a cycle
    nodeIsInCycle(n) {
        const rep = this.getRepNode(n);
        const subNodesCount = this.getSubNodes(rep).size;
        // multi-node cycle
        if (subNodesCount > 1) {
            return true;
        }
        // self-cycle: a call a
        let repNode = this._G.getNode(rep);
        for (const e of repNode === null || repNode === void 0 ? void 0 : repNode.getOutgoingEdges()) {
            if (e.getDstID() === rep) {
                return true;
            }
        }
        return false;
    }
    getMySCCNodes(n) {
        const rep = this.getRepNode(n);
        return this.getSubNodes(rep);
    }
    // get all subnodes in one scc
    getSubNodes(n) {
        const it = this._R.get(n);
        if (!it) {
            throw new Error('sccInfo not found for a node');
        }
        let sub = it.subNodes;
        if (sub.size === 0) {
            sub.add(n);
        }
        return sub;
    }
    // get all representative nodes
    getRepNodes() {
        return this.repNodes;
    }
}
exports.SCCDetection = SCCDetection;
