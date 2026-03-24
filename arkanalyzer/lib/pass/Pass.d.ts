import { Context, CtxArg } from './Context';
import { SceneCtx } from './ScenePassMgr';
import type { ArkFile } from '../core/model/ArkFile';
import type { ArkClass } from '../core/model/ArkClass';
import type { ArkMethod } from '../core/model/ArkMethod';
/**
    fallthrough actions
    Continue: will run next pass
    Break: will break the pass list
*/
export declare const enum FallAction {
    Continue = 0,
    Break = 1
}
/**
 * Represents an abstract file responsible for handling file-related operations.
 * The ClassPass class is designed to define a contract for executing specific logic
 * when processing a given class within a particular context. Implementations of this
 * class are expected to provide concrete behavior for the `run` method.
 *
 * @param cls:ArkFile - The class to be executed
 * @param ctx:FileCtx - The context used in executed
 * @returns The result of the method execution, which can be of FallAction or void.
 */
export declare abstract class FilePass {
    abstract run(file: ArkFile, ctx: FileCtx): FallAction | void;
}
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The FileCtx is bound to a SceneCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
export declare class FileCtx extends Context<SceneCtx, CtxArg> {
    root(): SceneCtx;
}
/**
 * Represents an abstract class responsible for handling class-related operations.
 * The ClassPass class is designed to define a contract for executing specific logic
 * when processing a given class within a particular context. Implementations of this
 * class are expected to provide concrete behavior for the `run` method.
 *
 * @param cls:ArkClass - The class to be executed
 * @param ctx:ClassCtx - The context used in executed
 * @returns The result of the method execution, which can be of FallAction or void.
 */
export declare abstract class ClassPass {
    abstract run(cls: ArkClass, ctx: ClassCtx): FallAction | void;
}
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The ClassCtx is bound to a FileCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
export declare class ClassCtx extends Context<FileCtx, CtxArg> {
    root(): SceneCtx;
}
/**
 * Represents an abstract class for executing a method within a specific context.
 * The MethodPass class is designed to be extended by concrete implementations
 * that define how a given method should be processed or executed.
 *
 * The `run` method must be implemented by subclasses to provide the logic
 * for handling the execution of the provided method using the given context.
 *
 * @param method: ArkMethod - The method to be executed
 * @param ctx: MethodCtx - The context used in executed
 * @returns The result of the method execution, which can be of FallAction or void.
 */
export declare abstract class MethodPass {
    abstract run(method: ArkMethod, ctx: MethodCtx): FallAction | void;
}
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The MethodCtx is bound to a ClassCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
export declare class MethodCtx extends Context<ClassCtx, CtxArg> {
    root(): SceneCtx;
}
//# sourceMappingURL=Pass.d.ts.map