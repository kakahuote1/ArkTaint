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
exports.Context = exports.UpperRoot = void 0;
/**
 * Represents the root implementation of the Upper interface.
 * Provides a singleton instance to ensure a single point of access.
 * The class is designed to maintain immutability for its properties.
 * The `getInstance` method allows retrieval of the singleton instance.
 */
class UpperRoot {
    constructor() {
        this.unreachable = true;
    }
    static getInstance() {
        return UpperRoot.INSTANCE;
    }
}
exports.UpperRoot = UpperRoot;
UpperRoot.INSTANCE = new UpperRoot();
/**
 * Represents a context that manages a map of arguments and provides methods to manipulate them.
 * Implements the Upper interface, allowing for hierarchical structures.
 * The context maintains a reference to its upper context and provides utilities to traverse the hierarchy.
 *
 * The `unreachable` property indicates whether this context is considered unreachable in the hierarchy.
 * The `upper` property refers to the parent or enclosing context.
 * The `args` property is a map that stores key-value pairs specific to this context.
 *
 * Provides methods to retrieve, add, and remove entries from the argument map.
 * Allows traversal to the root context in the hierarchy by following the chain of upper contexts.
 */
class Context {
    constructor(upper) {
        this.unreachable = false;
        this.upper = upper;
        this.args = new Map();
    }
    get(k) {
        return this.args.get(k);
    }
    set(k, v) {
        this.args.set(k, v);
    }
    remove(k) {
        const v = this.get(k);
        this.args.delete(k);
        return v;
    }
    root() {
        let up = this;
        // upper is root,
        while (!up.upper.unreachable) {
            up = up.upper;
        }
        return up;
    }
}
exports.Context = Context;
