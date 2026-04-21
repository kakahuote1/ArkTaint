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
exports.GraphPrinter = void 0;
const Printer_1 = require("./Printer");
function escapeStr(input) {
    let str = input;
    for (let i = 0; i < str.length; ++i) {
        switch (str[i]) {
            case '\n':
                str = str.substring(0, i) + '\\n' + str.substring(i + 1);
                ++i;
                break;
            case '\t':
                str = str.substring(0, i) + '  ' + str.substring(i + 1);
                ++i;
                break;
            case '\\':
                if (i + 1 < str.length) {
                    switch (str[i + 1]) {
                        case 'l':
                            continue; // don't disturb \l
                        case '|':
                        case '{':
                        case '}':
                            str = str.substring(0, i) + str.substring(i + 1);
                            continue;
                        default:
                            break;
                    }
                }
                str = str.substring(0, i) + '\\\\' + str.substring(i + 1);
                ++i;
                break;
            case '{':
            case '}':
            case '<':
            case '>':
            case '|':
            case '"':
                str = str.substring(0, i) + '\\' + str[i] + str.substring(i + 1);
                ++i;
                break;
            default:
        }
    }
    return str;
}
class GraphPrinter extends Printer_1.Printer {
    constructor(g, t) {
        super();
        this.startID = undefined;
        this.graph = g;
        if (t) {
            this.title = t;
        }
    }
    setStartID(n) {
        this.startID = n;
    }
    dump() {
        this.printer.clear();
        this.writeGraph();
        return this.printer.toString();
    }
    writeGraph() {
        this.writeHeader();
        this.writeNodes();
        this.writeFooter();
    }
    writeNodes() {
        var _a;
        let itor = this.graph.nodesItor();
        if (this.startID) {
            // from start id
            let nodes = new Set();
            let startNode = this.graph.getNode(this.startID);
            let worklist = [startNode];
            while (worklist.length > 0) {
                let n = worklist.shift();
                if (nodes.has(n)) {
                    continue;
                }
                nodes.add(n);
                (_a = n.getOutgoingEdges()) === null || _a === void 0 ? void 0 : _a.forEach(e => worklist.push(e.getDstNode()));
            }
            itor = nodes.values();
        }
        for (let node of itor) {
            let nodeAttr = node.getDotAttr();
            if (nodeAttr === '') {
                continue;
            }
            let nodeLabel = escapeStr(node.getDotLabel());
            this.printer.writeLine(`\tNode${node.getID()} [shape=recode,${nodeAttr},label="${nodeLabel}"];`);
            for (let edge of node.getOutgoingEdges()) {
                this.writeEdge(edge);
            }
        }
    }
    writeEdge(edge) {
        let edgeAttr = edge.getDotAttr();
        if (edgeAttr === '') {
            return;
        }
        this.printer.writeLine(`\tNode${edge.getSrcID()} -> Node${edge.getDstID()}[${edgeAttr}]`);
    }
    writeHeader() {
        const GraphName = this.graph.getGraphName();
        let graphNameStr = `digraph "${escapeStr(this.title || GraphName || 'unnamed')}" {\n`;
        this.printer.writeLine(graphNameStr);
        let labelStr = `\tlabel="${escapeStr(this.title || GraphName)}";\n`;
        this.printer.writeLine(labelStr);
        // TODO: need graph attr?
    }
    writeFooter() {
        this.printer.writeLine('}\n');
    }
}
exports.GraphPrinter = GraphPrinter;
