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
exports.DependsGraph = exports.DependsEdge = exports.DependsNode = void 0;
const BaseExplicitGraph_1 = require("./BaseExplicitGraph");
class DependsNode extends BaseExplicitGraph_1.BaseNode {
    constructor(id, attr) {
        super(id, attr.kind);
        this.attr = attr;
    }
    getNodeAttr() {
        return this.attr;
    }
    setNodeAttr(attr) {
        this.attr = attr;
    }
    getDotLabel() {
        return this.attr.name;
    }
}
exports.DependsNode = DependsNode;
class DependsEdge extends BaseExplicitGraph_1.BaseEdge {
    constructor(s, d, attr) {
        super(s, d, attr.kind);
        this.attr = attr;
    }
    getEdgeAttr() {
        return this.attr;
    }
    setEdgeAttr(attr) {
        this.attr = attr;
    }
    getKey() {
        return `${this.getSrcID()}-${this.getDstID()}-${this.getKind()}`;
    }
}
exports.DependsEdge = DependsEdge;
class DependsGraph extends BaseExplicitGraph_1.BaseExplicitGraph {
    constructor() {
        super();
        this.depsMap = new Map();
        this.edgesMap = new Map();
    }
    hasDepsNode(key) {
        return this.depsMap.has(key);
    }
    addDepsNode(key, attr) {
        if (this.depsMap.has(key)) {
            // update attr
            let node = this.getNode(this.depsMap.get(key));
            node.setNodeAttr(attr);
            return node;
        }
        let node = new DependsNode(this.getNodeNum(), attr);
        this.depsMap.set(key, node.getID());
        this.addNode(node);
        return node;
    }
    addEdge(src, dst, attr) {
        let edge = new DependsEdge(src, dst, attr);
        let key = edge.getKey();
        if (this.edgesMap.has(key)) {
            return this.edgesMap.get(key);
        }
        this.edgesMap.set(key, edge);
        src.addOutgoingEdge(edge);
        dst.addIncomingEdge(edge);
        return edge;
    }
    getGraphName() {
        return 'DependsGraph';
    }
}
exports.DependsGraph = DependsGraph;
