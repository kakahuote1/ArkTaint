/**
 * Generic Data Flow Analysis Framework
 *
 * This module provides a generic framework for implementing data flow analyses,
 * such as Reaching Definitions, Live Variables, and Available Expressions.
 * The framework is designed to be flexible and extensible, allowing users to
 * define custom flow graphs, transfer functions, and meet operations.
 *
 * Design Notes:
 * - The framework is designed to be generic and reusable, allowing users to
 *   implement custom data flow analyses by defining appropriate transfer functions
 *   and meet operations.
 * - The solver uses a worklist algorithm to efficiently compute the MFP solution.
 * - The analysis can be configured as either forward or backward, depending on
 *   the problem requirements.
 *
 */
/**
 * Represents a flow graph for data flow analysis.
 * Provides access to nodes in post-order and reverse post-order, as well as
 * methods to retrieve successors and predecessors of a given node.
 *
 * @template T - The type of nodes in the graph (e.g., node IDs or node objects).
 */
export interface FlowGraph<T> {
    nodesInReversePostOrder?: T[];
    nodesInPostOrder: T[];
    pred(t: T): T[];
    succ(t: T): T[];
}
/**
 * DS (Data Set) is an interface that defines the basic operations for a data set.
 * It requires the data set to be iterable, comparable, and countable.
 */
interface DS {
    /**
     * Returns an iterator that allows iterating over the elements of the data set.
     * @returns An iterable iterator over the elements of the data set.
     */
    [Symbol.iterator](): IterableIterator<any>;
    /**
     * Checks whether the current data set is equal to another data set.
     */
    equals(d: DS): boolean;
    /**
     * Counts the number of elements in the data set.
     */
    count(): number;
}
/**
 * Represents the transfer function used in data flow analysis.
 * The transfer function computes the output value (out set) of a node
 * based on its input value (in set) and the node's properties.
 *
 * @template Node - The type of nodes in the graph.
 * @template V - The type of data flow values (e.g., sets, bit vectors).
 */
export interface TransferFunction<Node, V> {
    /**
     * Computes the output value for a node based on its input value.
     *
     * @param n - The node for which the output value is computed.
     * @param x - The input value (in set) for the node.
     * @returns The output value (out set) for the node.
     */
    apply(n: Node, x: V): V;
}
/**
 * Represents a data flow problem, encapsulating all the necessary components
 * for performing data flow analysis, such as the flow graph, transfer function,
 * meet operation, and initialization configuration.
 *
 * @template Node - The type of nodes in the graph.
 * @template V - The type of data flow values.
 */
export interface DataFlowProblem<Node, V> {
    /**
     * The flow graph for the data flow analysis.
     */
    flowGraph: FlowGraph<Node>;
    /**
     * The transfer function used to compute out sets from in sets.
     */
    transferFunction: TransferFunction<Node, V>;
    /**
     * The meet operation used to combine values from multiple paths (e.g., union or intersection).
     */
    meet: (a: V, b: V) => V;
    /**
     * The initialization configuration for in and out sets.
     */
    initIn: Map<Node, V>;
    initOut: Map<Node, V>;
    /**
     * Indicates whether the analysis is forward (true) or backward (false).
     */
    forward: boolean;
    /**
     * The empty value used to initialize in and out sets (e.g., an empty set).
     */
    empty: V;
}
/**
 * Represents the result of a data flow analysis.
 * Contains the in and out sets for each node, as well as the corresponding data flow problem.
 *
 * @template Node - The type of nodes in the graph.
 * @template V - The type of data flow values.
 */
export declare class Solution<Node, V> {
    in: Map<Node, V>;
    out: Map<Node, V>;
    problem: DataFlowProblem<Node, V>;
    constructor(i: Map<Node, V>, out: Map<Node, V>, problem: DataFlowProblem<Node, V>);
}
/**
 * A solver for data flow analysis problems.
 * Implements forward and backward data flow analysis using a worklist algorithm.
 * The solver computes the Maximum Fixed Point (MFP) solution, which is a safe
 * over-approximation of the ideal Meet-Over-All-Paths (MOP) solution.
 */
export declare class MFPDataFlowSolver {
    /**
     * Computes the MFP solution for a forward data flow analysis problem.
     *
     * @template Node - The type of nodes in the graph.
     * @template V - The type of data flow values.
     * @param problem - The data flow problem to solve.
     * @returns The solution containing the in and out sets for all nodes.
     */
    calculateMopSolutionForwards<Node, V extends DS>(problem: DataFlowProblem<Node, V>): Solution<Node, V>;
    /**
     * Computes the MFP solution for a backward data flow analysis problem.
     *
     * @template Node - The type of nodes in the graph.
     * @template V - The type of data flow values.
     * @param problem - The data flow problem to solve.
     * @returns The solution containing the in and out sets for all nodes.
     */
    calculateMopSolutionBackwards<Node, T extends DS>(problem: DataFlowProblem<Node, T>): Solution<Node, T>;
}
export {};
//# sourceMappingURL=GenericDataFlow.d.ts.map