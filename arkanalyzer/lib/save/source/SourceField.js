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
exports.SourceField = void 0;
const ArkField_1 = require("../../core/model/ArkField");
const SourceBase_1 = require("./SourceBase");
const SourceTransformer_1 = require("./SourceTransformer");
const Type_1 = require("../../core/base/Type");
const ArkMetadata_1 = require("../../core/model/ArkMetadata");
/**
 * @category save
 */
class SourceField extends SourceBase_1.SourceBase {
    constructor(field, indent = '', initializer) {
        super(field.getDeclaringArkClass().getDeclaringArkFile(), indent);
        this.field = field;
        this.transformer = new SourceTransformer_1.SourceTransformer(this);
        this.initializer = initializer;
    }
    getLine() {
        return this.field.getOriginPosition().getLineNo();
    }
    dump() {
        this.printer.clear();
        const commentsMetadata = this.field.getMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS);
        if (commentsMetadata instanceof ArkMetadata_1.CommentsMetadata) {
            const comments = commentsMetadata.getComments();
            comments.forEach(comment => {
                this.printer.writeIndent().writeLine(comment.content);
            });
        }
        this.printDecorator(this.field.getDecorators());
        this.printer.writeIndent();
        if (this.field.getCategory() !== ArkField_1.FieldCategory.ENUM_MEMBER) {
            this.printer.writeSpace(this.modifiersToString(this.field.getModifiers()));
        }
        this.printer.write(this.field.getName());
        if (this.field.getQuestionToken()) {
            this.printer.write('?');
        }
        if (this.field.getExclamationToken()) {
            this.printer.write('!');
        }
        // property.getInitializer() PropertyAccessExpression ArrowFunction ClassExpression FirstLiteralToken StringLiteral
        if (!(this.field.getType() instanceof Type_1.UnknownType) && this.field.getCategory() !== ArkField_1.FieldCategory.ENUM_MEMBER) {
            this.printer.write(`: ${this.transformer.typeToString(this.field.getType())}`);
        }
        if (this.initializer.has(this.field.getName())) {
            this.printer.write(` = ${this.initializer.get(this.field.getName())}`);
        }
        if (this.field.getCategory() === ArkField_1.FieldCategory.ENUM_MEMBER) {
            this.printer.writeLine(',');
        }
        else {
            this.printer.writeLine(';');
        }
        return this.printer.toString();
    }
}
exports.SourceField = SourceField;
