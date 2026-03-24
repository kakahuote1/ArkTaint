import { ClassCtx, ClassPass, FallAction, FileCtx, FilePass, MethodCtx, MethodPass } from '../Pass';
import type { ArkFile } from '../../core/model/ArkFile';
import type { ArkClass } from '../../core/model/ArkClass';
import type { ArkMethod } from '../../core/model/ArkMethod';
import type { Value } from '../../core/base/Value';
import type { Stmt } from '../../core/base/Stmt';
import type { StmtInit, StmtTy, ValueInit, ValueTy } from '../Dispatcher';
import { Dispatch, Dispatcher } from '../Dispatcher';
export declare const enum SummaryLevel {
    info = 0,
    warn = 1,
    error = 2
}
/**
 * Represents a summary message with an associated level and content.
 * The SummaryMsg class is used to encapsulate messages that have a specific severity or importance level.
 * It provides a way to associate a textual message with a defined level, making it suitable for logging, notifications, or summaries.
 * The constructor initializes the message and its level, ensuring both are explicitly defined at creation.
 */
export declare class SummaryMsg {
    level: SummaryLevel;
    msg: string;
    constructor(level: SummaryLevel, msg: string);
}
/**
 * Interface representing a summary reporter for logging messages with different severity levels.
 * Provides methods to log informational, warning, and error messages.
 * The `info` method is used to log general informational messages.
 * The `warn` method is used to log warning messages that indicate potential issues.
 * The `error` method is used to log error messages that represent critical problems.
 */
export interface SummaryReporter {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}
/**
 * Abstract class representing a statement validator.
 * Provides a mechanism to validate statements of a specific type within a given context.
 * Implementations must define the `validate` method to perform custom validation logic.
 */
export declare abstract class StmtValidator<S extends StmtTy> {
    /**
     * Validates the given input using the provided context and reports the results.
     *
     * @param s The input value to be validated.
     * @param ctx The context used for validation, which includes reporting mechanisms.
     * @return The result of the validation process.
     */
    abstract validate(s: S, ctx: SummaryReporter): void;
    run(s: S, ctx: MethodCtx, mtd: ArkMethod): void;
    static register(init: StmtInit): void;
}
/**
 * Abstract class representing a validator for values of a specific type.
 * Provides a mechanism to validate values and report the results through a summary reporter.
 * The validation logic is defined by implementing the `validate` method in derived classes.
 */
export declare abstract class ValueValidator<S extends ValueTy> {
    /**
     * Validates the given input against specific criteria and reports the validation status.
     *
     * @param s The input value to be validated. This can be of any type depending on the implementation.
     * @param ctx The context object used for reporting validation results or summaries.
     * @return The result of the validation process.
     */
    abstract validate(s: S, ctx: SummaryReporter): void;
    run(s: S, ctx: MethodCtx, mtd: ArkMethod): void;
    static register(init: ValueInit): void;
}
/**
 * The ArkValidatorRegistry class is responsible for managing and registering statement and value initializers
 * used in validation processes. It extends the Dispatcher class and provides mechanisms to dynamically
 * register and invalidate dispatch configurations.
 */
export declare class ArkValidatorRegistry extends Dispatcher {
    private static readonly stmtsHolder;
    private static readonly valuesHolder;
    private static dispatchHolder?;
    constructor(ctx: MethodCtx);
    static getDispatch(): Dispatch;
    static stmt(init: StmtInit): void;
    static value(init: ValueInit): void;
}
/**
 * Represents a summary of a method, capturing various messages and associations with values and statements.
 * This class provides methods to submit messages and associate them with specific values or statements.
 * It also supports retrieving or creating a method summary within a given context.
 */
export declare class MethodSummary {
    name: string;
    values: Map<Value, SummaryMsg[]>;
    stmts: Map<Stmt, SummaryMsg[]>;
    msgList: SummaryMsg[];
    constructor();
    submit(msg: SummaryMsg): void;
    submitValue(value: Value, msg: SummaryMsg): void;
    submitStmt(stmt: Stmt, msg: SummaryMsg): void;
    /**
     * Retrieves an existing MethodSummary from the context or creates a new one if it does not exist.
     *
     * @param ctx The method context in which the MethodSummary is stored or will be created.
     * @param mtd The ArkMethod for which the MethodSummary is being retrieved or created.
     * @return The existing or newly created MethodSummary associated with the provided context and method.
     */
    static getOrNew(ctx: MethodCtx, mtd: ArkMethod): MethodSummary;
}
export declare abstract class MethodValidator extends MethodPass {
    /**
     * Validates the given method and reports any issues found.
     *
     * @param mtd The method to be validated. This is an instance of ArkMethod.
     * @param ctx The context for reporting validation results or issues. This is an instance of SummaryReporter.
     * @return This method does not return a value.
     */
    abstract validate(mtd: ArkMethod, ctx: SummaryReporter): void;
    run(mtd: ArkMethod, ctx: MethodCtx): FallAction | void;
}
/**
 * Represents a summary of a class, containing its name, associated methods, and messages.
 * Provides functionality to submit messages and retrieve or create a ClassSummary instance.
 * The class maintains a collection of method summaries and tracks messages related to the class.
 * It is designed to be used in the context of a larger system that processes class information.
 */
export declare class ClassSummary {
    name: string;
    methods: Map<ArkMethod, MethodSummary>;
    msgList: SummaryMsg[];
    constructor();
    submit(msg: SummaryMsg): void;
    /**
     * Retrieves an existing ClassSummary instance from the given context or creates a new one if it does not exist.
     * If the ClassSummary is not found in the context, it attempts to retrieve or create a FileSummary for the declaring file of the class.
     * Ensures that the ClassSummary is associated with the provided class and context before returning it.
     *
     * @param ctx The context in which to search for or store the ClassSummary instance.
     * @param cls The class for which the ClassSummary is being retrieved or created.
     * @return The existing or newly created ClassSummary instance associated with the provided class and context.
     */
    static getOrNew(ctx: ClassCtx, cls: ArkClass): ClassSummary;
}
export declare abstract class ClassValidator extends ClassPass {
    /**
     * Validates the given class and reports any issues found during validation.
     *
     * @param cls The class to be validated. This should be an instance of ArkClass.
     * @param ctx The context used for reporting validation results or issues. This should be an instance of SummaryReporter.
     * @return This method does not return any value.
     */
    abstract validate(cls: ArkClass, ctx: SummaryReporter): void;
    run(cls: ArkClass, ctx: ClassCtx): FallAction | void;
}
/**
 * Represents a summary of a file containing information about classes and messages.
 * Provides methods to manage and retrieve file summaries within a given context.
 * The class maintains a collection of messages and a mapping of classes to their summaries.
 * It supports operations to submit new messages and retrieve or create summaries for files.
 */
export declare class FileSummary {
    name: string;
    classes: Map<ArkClass, ClassSummary>;
    msgList: SummaryMsg[];
    constructor();
    submit(msg: SummaryMsg): void;
    /**
     * Retrieves an existing FileSummary instance from the given context or creates a new one if it does not exist.
     *
     * @param ctx The context object that holds the FileSummary instance. It is used to check if a FileSummary already exists.
     * @param file The ArkFile object for which the FileSummary is being retrieved or created.
     * @return The existing or newly created FileSummary instance associated with the provided file.
     */
    static getOrNew(ctx: FileCtx, file: ArkFile): FileSummary;
}
export declare abstract class FileValidator extends FilePass {
    /**
     * Validates the given file and reports the results through the provided context.
     *
     * @param file The file to be validated, represented as an ArkFile object.
     * @param ctx The context used for reporting validation results, implemented as a SummaryReporter.
     * @return The result of the validation process.
     */
    abstract validate(file: ArkFile, ctx: SummaryReporter): void;
    run(file: ArkFile, ctx: FileCtx): void;
}
/**
 * Represents a summary of a scene, containing metadata and associated file summaries.
 * The name property provides a default identifier for the scene summary.
 * The files property maintains a mapping of ArkFile instances to their corresponding FileSummary objects.
 * This class is used to encapsulate and manage information about a scene and its related files.
 */
export declare class SceneSummary {
    name: string;
    files: Map<ArkFile, FileSummary>;
    /**
     * Checks if the current instance is in an acceptable state.
     * @return {boolean} - Returns true if the files collection is empty, indicating an acceptable state; otherwise, false.
     */
    isOk(): boolean;
    /**
     * Dumps the scene summary and details to the log based on the specified level.
     * @param {SummaryLevel} [level=SummaryLevel.info] - The minimum level of messages to include in the log. Defaults to SummaryLevel.info.
     * @return {void}
     */
    dump2log(level?: SummaryLevel): void;
    private classDump;
}
//# sourceMappingURL=Validator.d.ts.map