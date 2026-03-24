import { AnyKey, Context, CtxArg, UpperRoot } from './Context';
import { Dispatcher } from './Dispatcher';
import { ClassPass, FilePass, MethodPass } from './Pass';
import type { Scene } from '../Scene';
import type { ArkFile } from '../core/model/ArkFile';
import type { ArkClass } from '../core/model/ArkClass';
import type { ArkMethod } from '../core/model/ArkMethod';
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The SceneCtx is bound to a UpperRoot and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx itself.
 */
export declare class SceneCtx extends Context<UpperRoot, CtxArg> {
    constructor();
    root(): SceneCtx;
}
/**
 * Represents the properties required for configuring various passes in a system.
 * The PassProps interface is designed to hold arrays of different types of passes,
 * specifically file-level, class-level, and method-level passes. Each pass type
 * is identified by a unique key and associated with specific configurations or rules.
 * These passes are used to define how certain operations or validations should be
 * applied at different levels of granularity within the system.
 */
export interface PassProps {
    file: AnyKey<FilePass>[];
    klass: AnyKey<ClassPass>[];
    method: AnyKey<MethodPass>[];
}
/**
 * Represents the properties for a selector configuration.
 * Provides options to define callback functions for selecting files, classes, and methods.
 * The file property allows specifying a function to select files from a given scene.
 * The klass property allows specifying a function to select classes from a given file.
 * The method property allows specifying a function to select methods from a given class.
 */
export interface SelectorProps {
    file?: (s: Scene) => ArkFile[];
    klass?: (s: ArkFile) => ArkClass[];
    method?: (s: ArkClass) => ArkMethod[];
}
/**
 * Represents the properties for configuring a scene pass manager.
 *
 * The SceneProps interface allows defining optional configurations for a scene,
 * including rendering passes, selector properties, and a dispatcher implementation.
 *
 * The passes property defines the configuration for rendering stages or phases within the scene.
 *
 * The selectors property provides options for selecting elements or components within the scene.
 *
 * The dispatcher property specifies the dispatcher class responsible for handling events or actions
 * within the scene, defaulting to the base Dispatcher type if not provided.
 */
export interface SceneProps {
    passes?: PassProps;
    selectors?: SelectorProps;
    dispatcher?: typeof Dispatcher;
}
export declare class ScenePassMgr {
    private passes;
    private selectors?;
    private dispatcher?;
    private sctx;
    constructor(props: SceneProps);
    sceneContext(): SceneCtx;
    run(scene: Scene): void;
    private iterFile;
    private iterClass;
    private iterMethod;
}
//# sourceMappingURL=ScenePassMgr.d.ts.map