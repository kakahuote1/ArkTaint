"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.MFPDataFlowSolver = exports.Solution = void 0;
/**
 * Represents the result of a data flow analysis.
 * Contains the in and out sets for each node, as well as the corresponding data flow problem.
 *
 * @template Node - The type of nodes in the graph.
 * @template V - The type of data flow values.
 */
class Solution {
    constructor(i, out, problem) {
        this.in = i;
        this.out = out;
        this.problem = problem;
    }
}
exports.Solution = Solution;
/**
 * A solver for data flow analysis problems.
 * Implements forward and backward data flow analysis using a worklist algorithm.
 * The solver computes the Maximum Fixed Point (MFP) solution, which is a safe
 * over-approximation of the ideal Meet-Over-All-Paths (MOP) solution.
 */
class MFPDataFlowSolver {
    /**
     * Computes the MFP solution for a forward data flow analysis problem.
     *
     * @template Node - The type of nodes in the graph.
     * @template V - The type of data flow values.
     * @param problem - The data flow problem to solve.
     * @returns The solution containing the in and out sets for all nodes.
     */
    calculateMopSolutionForwards(problem) {
        let _out = problem.initOut;
        let _in = problem.initIn;
        let workList = problem.flowGraph.nodesInPostOrder;
        let newEntries = new Set();
        while (workList.length > 0) {
            newEntries.clear();
            workList.forEach(n => {
                let inSet;
                const predecessors = problem.flowGraph.pred(n);
                if (predecessors && predecessors.length > 0) {
                    const predecessorOuts = predecessors.map(pred => _out.get(pred));
                    inSet = predecessorOuts.reduce((acc, cur) => problem.meet(acc, cur), problem.empty);
                }
                else {
                    inSet = problem.empty;
                }
                _in.set(n, inSet);
                let old = _out.get(n);
                let newSet = problem.transferFunction.apply(n, inSet);
                if (!old || old.count() === 0 || !old.equals(newSet)) {
                    _out.set(n, newSet);
                    problem.flowGraph.succ(n).forEach(succ => newEntries.add(succ));
                }
            });
            workList = [...newEntries];
        }
        return new Solution(_in, _out, problem);
    }
    /**
     * Computes the MFP solution for a backward data flow analysis problem.
     *
     * @template Node - The type of nodes in the graph.
     * @template V - The type of data flow values.
     * @param problem - The data flow problem to solve.
     * @returns The solution containing the in and out sets for all nodes.
     */
    calculateMopSolutionBackwards(problem) {
        let _out = problem.initOut;
        let _in = problem.initIn;
        let workList = problem.flowGraph.nodesInPostOrder;
        let newEntries = new Set();
        while (workList.length > 0) {
            newEntries.clear();
            workList.forEach(n => {
                let outSet = problem.flowGraph.succ(n).reduce((acc, curr) => {
                    return problem.meet(acc, _in.get(curr));
                }, problem.empty);
                _out.set(n, outSet);
                let old = _in.get(n);
                let newSet = problem.transferFunction.apply(n, outSet);
                if (!old || !old.equals(newSet)) {
                    _in.set(n, newSet);
                    problem.flowGraph.pred(n).forEach(pred => newEntries.add(pred));
                }
            });
            workList = [...newEntries];
        }
        return new Solution(_in, _out, problem);
    }
}
exports.MFPDataFlowSolver = MFPDataFlowSolver;
