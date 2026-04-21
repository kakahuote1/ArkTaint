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
exports.BaseExplicitGraph = exports.BaseNode = exports.BaseEdge = void 0;
class BaseEdge {
    constructor(s, d, k) {
        this.src = s;
        this.dst = d;
        this.kind = k;
    }
    getSrcID() {
        return this.src.getID();
    }
    getDstID() {
        return this.dst.getID();
    }
    getSrcNode() {
        return this.src;
    }
    getDstNode() {
        return this.dst;
    }
    getKind() {
        return this.kind;
    }
    setKind(kind) {
        this.kind = kind;
    }
    getEndPoints() {
        return {
            src: this.src.getID(),
            dst: this.dst.getID(),
        };
    }
    getDotAttr() {
        return 'color=black';
    }
}
exports.BaseEdge = BaseEdge;
class BaseNode {
    constructor(id, k) {
        this.inEdges = new Set();
        this.outEdges = new Set();
        this.id = id;
        this.kind = k;
    }
    getID() {
        return this.id;
    }
    getKind() {
        return this.kind;
    }
    setKind(kind) {
        this.kind = kind;
    }
    hasIncomingEdges() {
        return this.inEdges.size !== 0;
    }
    hasOutgoingEdges() {
        return this.outEdges.size === 0;
    }
    hasIncomingEdge(e) {
        return this.inEdges.has(e);
    }
    hasOutgoingEdge(e) {
        return this.outEdges.has(e);
    }
    addIncomingEdge(e) {
        this.inEdges.add(e);
    }
    addOutgoingEdge(e) {
        this.outEdges.add(e);
    }
    removeIncomingEdge(e) {
        return this.inEdges.delete(e);
    }
    removeOutgoingEdge(e) {
        return this.outEdges.delete(e);
    }
    getIncomingEdge() {
        return this.inEdges;
    }
    getOutgoingEdges() {
        return this.outEdges;
    }
    getDotAttr() {
        return 'shape=box';
    }
}
exports.BaseNode = BaseNode;
class BaseExplicitGraph {
    constructor() {
        this.edgeNum = 0;
        this.nodeNum = 0;
        this.idToNodeMap = new Map();
        this.edgeMarkSet = new Set();
    }
    getNodeNum() {
        return this.nodeNum;
    }
    getEdgeNum() {
        return this.edgeNum;
    }
    nodesItor() {
        return this.idToNodeMap.values();
    }
    addNode(n) {
        this.idToNodeMap.set(n.getID(), n);
        this.nodeNum++;
    }
    getNode(id) {
        if (!this.idToNodeMap.has(id)) {
            throw new Error(`Can find Node # ${id}`);
        }
        return this.idToNodeMap.get(id);
    }
    hasNode(id) {
        return this.idToNodeMap.has(id);
    }
    removeNode(id) {
        if (this.idToNodeMap.delete(id)) {
            this.nodeNum--;
            return true;
        }
        return false;
    }
    hasEdge(src, dst) {
        for (let e of src.getOutgoingEdges()) {
            if (e.getDstNode() === dst) {
                return true;
            }
        }
        return false;
    }
    ifEdgeExisting(edge) {
        let edgeMark = `${edge.getSrcID()}-${edge.getDstID()}:${edge.getKind()}`;
        if (this.edgeMarkSet.has(edgeMark)) {
            return true;
        }
        this.edgeMarkSet.add(edgeMark);
        return false;
    }
    getNodesIter() {
        return this.idToNodeMap.values();
    }
}
exports.BaseExplicitGraph = BaseExplicitGraph;
