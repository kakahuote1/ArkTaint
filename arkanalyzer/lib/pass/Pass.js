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
exports.MethodCtx = exports.MethodPass = exports.ClassCtx = exports.ClassPass = exports.FileCtx = exports.FilePass = void 0;
const Context_1 = require("./Context");
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
class FilePass {
}
exports.FilePass = FilePass;
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The FileCtx is bound to a SceneCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
class FileCtx extends Context_1.Context {
    root() {
        return this.upper.root();
    }
}
exports.FileCtx = FileCtx;
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
class ClassPass {
}
exports.ClassPass = ClassPass;
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The ClassCtx is bound to a FileCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
class ClassCtx extends Context_1.Context {
    root() {
        return this.upper.root();
    }
}
exports.ClassCtx = ClassCtx;
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
class MethodPass {
}
exports.MethodPass = MethodPass;
/**
 * Represents a specialized context class that extends the base Context class with specific types.
 * Provides functionality to access the root context within a hierarchical structure.
 * The MethodCtx is bound to a ClassCtx and CtxArg, defining its operational scope.
 * The root method retrieves the top-level SceneCtx by traversing the context hierarchy.
 */
class MethodCtx extends Context_1.Context {
    root() {
        return this.upper.root();
    }
}
exports.MethodCtx = MethodCtx;
