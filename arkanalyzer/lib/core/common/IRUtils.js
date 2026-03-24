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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IRUtils = void 0;
const Expr_1 = require("../base/Expr");
const Ref_1 = require("../base/Ref");
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const ArkMetadata_1 = require("../model/ArkMetadata");
const Position_1 = require("../base/Position");
const Local_1 = require("../base/Local");
const Const_1 = require("./Const");
class IRUtils {
    static moreThanOneAddress(value) {
        if (value instanceof Expr_1.AbstractBinopExpr ||
            value instanceof Expr_1.AbstractInvokeExpr ||
            value instanceof Ref_1.AbstractFieldRef ||
            value instanceof Ref_1.ArkArrayRef ||
            value instanceof Expr_1.ArkCastExpr ||
            value instanceof Expr_1.ArkUnopExpr) {
            return true;
        }
        return false;
    }
    static generateTextForStmt(scene) {
        for (const method of scene.getMethods()) {
            const cfg = method.getCfg();
            if (cfg) {
                for (const stmt of cfg.getStmts()) {
                    stmt.setText(stmt.toString());
                }
            }
        }
    }
    static setComments(metadata, node, sourceFile, options) {
        const leadingCommentsMetadata = this.getCommentsMetadata(node, sourceFile, options, true);
        if (leadingCommentsMetadata.getComments().length > 0) {
            metadata.setMetadata(ArkMetadata_1.ArkMetadataKind.LEADING_COMMENTS, leadingCommentsMetadata);
        }
        const trailingCommentsMetadata = this.getCommentsMetadata(node, sourceFile, options, false);
        if (trailingCommentsMetadata.getComments().length > 0) {
            metadata.setMetadata(ArkMetadata_1.ArkMetadataKind.TRAILING_COMMENTS, trailingCommentsMetadata);
        }
    }
    static getCommentsMetadata(node, sourceFile, options, isLeading) {
        const comments = [];
        if ((isLeading && !options.enableLeadingComments) || (!isLeading && !options.enableTrailingComments)) {
            return new ArkMetadata_1.CommentsMetadata(comments);
        }
        // node.pos is the start position of
        const commentRanges = (isLeading ? ohos_typescript_1.default.getLeadingCommentRanges(sourceFile.text, node.pos) : ohos_typescript_1.default.getTrailingCommentRanges(sourceFile.text, node.end)) || [];
        // leading comment, while node.end is the
        // end position of the statement
        const getPosition = (pos, end) => {
            const start = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, pos);
            const endPos = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, end);
            return new Position_1.FullPosition(start.line + 1, start.character + 1, endPos.line + 1, endPos.character + 1);
        };
        for (const range of commentRanges) {
            comments.push({
                content: sourceFile.text.substring(range.pos, range.end).replace(/\r\n/g, '\n'),
                position: getPosition(range.pos, range.end),
            });
        }
        return new ArkMetadata_1.CommentsMetadata(comments);
    }
    static isTempLocal(value) {
        return value instanceof Local_1.Local && value.getName().startsWith(Const_1.NAME_PREFIX);
    }
    static findOperandIdx(stmt, operand) {
        let index = -1;
        const operands = stmt.getDefAndUses();
        for (let i = 0; i < operands.length; i++) {
            if (operands[i] === operand) {
                index = i;
                break;
            }
        }
        return index;
    }
    static adjustOperandOriginalPositions(stmt, oldValue, newValue) {
        const operandOriginalPositions = stmt.getOperandOriginalPositions();
        if (!operandOriginalPositions) {
            return;
        }
        const operandOriginalPositionSize = operandOriginalPositions.length;
        const defUseSize = stmt.getDefAndUses().length;
        const oldValueUseSize = oldValue.getUses().length;
        const newValueUseSize = newValue.getUses().length;
        const oldValueIdx = IRUtils.findOperandIdx(stmt, oldValue);
        const baseValueOffset = 1;
        const fieldValueOffset = 2;
        if (oldValue instanceof Ref_1.AbstractRef && newValue instanceof Ref_1.AbstractRef) {
            if (newValue instanceof Ref_1.ArkStaticFieldRef) {
                operandOriginalPositions.splice(oldValueIdx + baseValueOffset, oldValueUseSize - newValueUseSize);
            }
            else if (oldValue instanceof Ref_1.ArkStaticFieldRef) {
                operandOriginalPositions.splice(oldValueIdx + baseValueOffset, 0, ...IRUtils.generateDefaultPositions(newValueUseSize - oldValueUseSize));
            }
            if (oldValue instanceof Ref_1.ArkInstanceFieldRef && newValue instanceof Ref_1.ArkArrayRef) {
                if (operandOriginalPositionSize === defUseSize) {
                    // may not reserve positions for field name
                    operandOriginalPositions.splice(oldValueIdx + fieldValueOffset, 0, ...IRUtils.generateDefaultPositions(newValueUseSize - oldValueUseSize));
                }
            }
            else if (oldValue instanceof Ref_1.ArkArrayRef && newValue instanceof Ref_1.ArkInstanceFieldRef) {
                operandOriginalPositions.splice(oldValueIdx + fieldValueOffset, oldValueUseSize - newValueUseSize);
            }
        }
        else if (oldValue instanceof Expr_1.AbstractInvokeExpr && newValue instanceof Expr_1.AbstractInvokeExpr) {
            if (oldValueUseSize === newValueUseSize + 1) {
                operandOriginalPositions.splice(oldValueIdx + baseValueOffset, 1);
            }
            else if (oldValueUseSize === newValueUseSize - 1) {
                operandOriginalPositions.splice(oldValueIdx + baseValueOffset, 0, Position_1.FullPosition.DEFAULT);
            }
        }
    }
    static generateDefaultPositions(count) {
        const defaultPositions = [];
        for (let i = 0; i < count; i++) {
            defaultPositions.push(Position_1.FullPosition.DEFAULT);
        }
        return defaultPositions;
    }
}
exports.IRUtils = IRUtils;
