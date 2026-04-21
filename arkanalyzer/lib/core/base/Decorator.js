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
exports.Decorator = void 0;
/**
 * @category core/base
 */
class Decorator {
    constructor(name) {
        this.content = '';
        this.param = '';
        this.kind = name;
    }
    getKind() {
        return this.kind;
    }
    setContent(content) {
        this.content = content;
    }
    getContent() {
        return this.content;
    }
    setParam(param) {
        this.param = param;
    }
    getParam() {
        return this.param;
    }
    toString() {
        return `@${this.content}`;
    }
}
exports.Decorator = Decorator;
