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
exports.EnumInitTypeUserMetadata = exports.CommentsMetadata = exports.ArkMetadata = exports.ArkMetadataKind = void 0;
var ArkMetadataKind;
(function (ArkMetadataKind) {
    ArkMetadataKind[ArkMetadataKind["LEADING_COMMENTS"] = 0] = "LEADING_COMMENTS";
    ArkMetadataKind[ArkMetadataKind["TRAILING_COMMENTS"] = 1] = "TRAILING_COMMENTS";
    ArkMetadataKind[ArkMetadataKind["ENUM_INIT_TYPE_USER"] = 2] = "ENUM_INIT_TYPE_USER";
})(ArkMetadataKind = exports.ArkMetadataKind || (exports.ArkMetadataKind = {}));
/**
 * ArkMetadata
 * @example
 * // get leading comments
 * let stmt: Stmt = xxx;
 * let comments = stmt.getMetadata(ArkMetadataKind.LEADING_COMMENTS) || [];
 * comments.forEach((comment) => {
 *   logger.info(comment);
 * });
 */
class ArkMetadata {
    getMetadata(kind) {
        var _a;
        return (_a = this.metadata) === null || _a === void 0 ? void 0 : _a.get(kind);
    }
    setMetadata(kind, value) {
        if (!this.metadata) {
            this.metadata = new Map();
        }
        this.metadata.set(kind, value);
    }
}
exports.ArkMetadata = ArkMetadata;
class CommentsMetadata {
    constructor(comments) {
        this.comments = [];
        this.comments = comments;
    }
    getComments() {
        return this.comments;
    }
}
exports.CommentsMetadata = CommentsMetadata;
class EnumInitTypeUserMetadata {
    constructor(originTypeUser) {
        this.originTypeUser = originTypeUser;
    }
    isUserDefined() {
        return this.originTypeUser;
    }
}
exports.EnumInitTypeUserMetadata = EnumInitTypeUserMetadata;
