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
exports.DominanceTree = void 0;
class DominanceTree {
    constructor(dominanceFinder) {
        this.blocks = [];
        this.blockToIdx = new Map();
        this.children = [];
        this.parents = [];
        this.blocks = dominanceFinder.getBlocks();
        this.blockToIdx = dominanceFinder.getBlockToIdx();
        let idoms = dominanceFinder.getImmediateDominators();
        // build the tree
        let treeSize = this.blocks.length;
        this.children = new Array(treeSize);
        this.parents = new Array(treeSize);
        for (let i = 0; i < treeSize; i++) {
            this.children[i] = [];
            this.parents[i] = -1;
        }
        for (let i = 0; i < treeSize; i++) {
            if (idoms[i] !== i) {
                this.parents[i] = idoms[i];
                this.children[idoms[i]].push(i);
            }
        }
    }
    getAllNodesDFS() {
        let dfsBlocks = new Array();
        let queue = new Array();
        queue.push(this.getRoot());
        while (queue.length !== 0) {
            let curr = queue.splice(0, 1)[0];
            dfsBlocks.push(curr);
            let childList = this.getChildren(curr);
            if (childList.length !== 0) {
                for (let i = childList.length - 1; i >= 0; i--) {
                    queue.splice(0, 0, childList[i]);
                }
            }
        }
        return dfsBlocks;
    }
    getChildren(block) {
        let childList = new Array();
        let idx = this.blockToIdx.get(block);
        for (const i of this.children[idx]) {
            childList.push(this.blocks[i]);
        }
        return childList;
    }
    getRoot() {
        return this.blocks[0];
    }
}
exports.DominanceTree = DominanceTree;
