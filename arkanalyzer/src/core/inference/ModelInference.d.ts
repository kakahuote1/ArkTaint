import { ArkFile } from '../model/ArkFile';
import { Stmt } from '../base/Stmt';
import { Value } from '../base/Value';
import { ArkModel, Inference, InferenceFlow } from './Inference';
import { ExportInfo } from '../model/ArkExport';
import { ImportInfo } from '../model/ArkImport';
import { ArkMethod } from '../model/ArkMethod';
import { Type } from '../base/Type';
import { ArkClass } from '../model/ArkClass';
import { ValueInference } from './ValueInference';
/**
 * Abstract base class for performing inference on ArkModel instances
 * Implements both Inference and InferenceFlow interfaces to provide
 * a complete inference workflow with pre/post processing capabilities
 */
declare abstract class ArkModelInference implements Inference, InferenceFlow {
    /**
     * Performs the core inference operation on the provided model
     * @abstract
     * @param model - The ArkModel instance to perform inference on
     * @returns Inference result
     */
    abstract infer(model: ArkModel): any;
    /**
     * Executes the complete inference workflow with error handling
     * @param model - The ArkModel instance to process
     * @returns Inference result or undefined if an error occurs
     */
    doInfer(model: ArkModel): any;
    /**
     * Pre-inference hook method for setup and preparation
     * Can be overridden by subclasses to add custom pre-processing logic
     * @param model - The ArkModel instance being processed
     */
    preInfer(model: ArkModel): void;
    /**
     * Post-inference hook method for cleanup and finalization
     * Can be overridden by subclasses to add custom post-processing logic
     * @param model - The ArkModel instance that was processed
     * @param result
     */
    postInfer(model: ArkModel, result?: any): any;
}
export declare abstract class ImportInfoInference extends ArkModelInference {
    protected fromFile: ArkFile | null;
    /**
     * get arkFile and assign to from file
     * @param fromInfo
     */
    abstract preInfer(fromInfo: ImportInfo): void;
    /**
     * find export from file
     * @param fromInfo
     */
    infer(fromInfo: ImportInfo): ExportInfo | null;
    /**
     * cleanup fromFile and set exportInfo
     * @param fromInfo
     * @param exportInfo
     */
    postInfer(fromInfo: ImportInfo, exportInfo: ExportInfo | null): void;
}
export declare class FileInference extends ArkModelInference {
    private importInfoInference;
    private classInference;
    constructor(importInfoInference: ImportInfoInference, classInference: ClassInference);
    getClassInference(): ClassInference;
    /**
     * Pre-inference phase - processes unresolved import information in the file
     * @param {ArkFile} file
     */
    preInfer(file: ArkFile): void;
    /**
     * Main inference phase - processes all arkClass definitions in the file
     * @param {ArkFile} file
     */
    infer(file: ArkFile): void;
    /**
     * Post-inference phase - processes export information for the file
     * @param {ArkFile} file
     */
    postInfer(file: ArkFile): void;
}
export declare class ClassInference extends ArkModelInference {
    private methodInference;
    constructor(methodInference: MethodInference);
    getMethodInference(): MethodInference;
    /**
     * Pre-inference phase - processes heritage class information for the class
     * @param {ArkClass} arkClass
     */
    preInfer(arkClass: ArkClass): void;
    /**
     * Main inference phase - processes all methods in the class
     * @param {ArkClass} arkClass
     */
    infer(arkClass: ArkClass): void;
}
interface InferStmtResult {
    oldStmt: Stmt;
    replacedStmts?: Stmt[];
    impactedStmts?: Stmt[];
}
export declare class MethodInference extends ArkModelInference {
    private stmtInference;
    /** Set to track visited methods for cycle prevention when infer a callback function */
    private callBackVisited;
    private static TIMEOUT_MS;
    constructor(stmtInference: StmtInference);
    /**
     * Marks a method as visited to prevent infinite recursion
     * @param {ArkMethod} method - The method to mark as visited
     */
    markVisited(method: ArkMethod): void;
    /**
     * Clears the visited methods set
     */
    cleanVisited(): void;
    /**
     * Main inference phase - processes all statements in the method body
     * @param {ArkMethod} method - The method to analyze
     * @returns {InferStmtResult[]} Array of modified or impacted statements during inference
     */
    infer(method: ArkMethod): InferStmtResult[];
    /**
     * Post-inference phase - updates CFG and infers return type
     * @param {ArkMethod} method - The method that was analyzed
     * @param {InferStmtResult[]} modifiedStmts - Modified statements from inference phase
     */
    postInfer(method: ArkMethod, modifiedStmts: InferStmtResult[]): void;
}
export declare class StmtInference extends ArkModelInference {
    private valueInferences;
    constructor(valueInferences: ValueInference<Value>[]);
    /**
     * Main inference phase - processes a statement and its associated values
     * @param {Stmt} stmt - The statement to analyze
     * @returns {Type | undefined} The original definition type before inference
     */
    infer(stmt: Stmt): Type | undefined;
    /**
     * Post-inference phase - handles type propagation and impact analysis
     * @param {Stmt} stmt - The statement that was analyzed
     * @param {Type | undefined} defType - The original definition type before inference
     * @returns {InferStmtResult | undefined} Inference result with impacted statements
     */
    postInfer(stmt: Stmt, defType: Type | undefined): InferStmtResult | undefined;
    /**
     * Recursively infers types for values and their dependencies
     * @param {Value} value - The value to infer
     * @param {Stmt} stmt - The containing statement
     * @param {Set<Value>} visited - Set of already visited values for cycle prevention
     */
    private inferValue;
    /**
     * Propagates types through statements and handles special cases
     * @param {Stmt} stmt - The statement to process
     * @param {ArkMethod} method - The containing method
     * @returns {Set<Stmt>} Set of statements impacted by type propagation
     */
    typeSpread(stmt: Stmt, method: ArkMethod): Set<Stmt>;
    /**
     * Transfers types bidirectionally in assignment statements
     * @param {ArkAssignStmt} stmt - The assignment statement
     * @param {ArkMethod} method - The containing method
     * @param {Set<Stmt>} impactedStmts - Set to collect impacted statements
     */
    private transferTypeBidirectional;
    transferLeft2Right(rightOp: Value, leftType: Type, method: ArkMethod): Stmt[] | undefined;
    transferRight2Left(leftOp: Value, rightType: Type, method: ArkMethod): Stmt[] | undefined;
    /**
     * Updates the type of a target value and returns impacted statements
     * @param {Value} target - The target value to update
     * @param {Type} srcType - The source type to apply
     * @param {ArkMethod} method - The containing method
     * @returns {Stmt[] | undefined} Array of statements impacted by the type update
     */
    updateValueType(target: Value, srcType: Type, method: ArkMethod): Stmt[] | undefined;
    /**
     * Handles parameter type propagation for method invocations
     * @param {AbstractInvokeExpr} invokeExpr - The invocation expression
     * @param {ArkMethod} method - The containing method
     * @returns {Set<Stmt>} Set of statements impacted by parameter type propagation
     */
    private paramSpread;
    /**
     * Maps argument types to parameter types and handles callback inference
     */
    private mapArgWithParam;
}
export {};
