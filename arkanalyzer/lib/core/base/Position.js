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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FullPosition = exports.LineColPosition = exports.getColNo = exports.getLineNo = exports.setLineCol = exports.setCol = exports.setLine = void 0;
const ohos_typescript_1 = __importDefault(require("ohos-typescript"));
const logger_1 = __importStar(require("../../utils/logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'Position');
const LOW_BITS_SIZE = 16;
const LOW_BITS_MASK = 0xffff;
const HIGH_BITS_MASK = 0xffff0000;
const MIN_NUMBER = 0;
const MAX_NUMBER = 0xffff;
const INVALID_LINE = -1;
function setLine(lineCol, lineNo) {
    if (lineNo < MIN_NUMBER) {
        lineNo = MIN_NUMBER;
    }
    if (lineNo > MAX_NUMBER) {
        logger.warn(`setLine overflow ${lineNo}`);
        lineNo = MAX_NUMBER;
    }
    return (lineNo << LOW_BITS_SIZE) | (lineCol & LOW_BITS_MASK);
}
exports.setLine = setLine;
function setCol(lineCol, colNo) {
    if (colNo < MIN_NUMBER) {
        colNo = MIN_NUMBER;
    }
    if (colNo > MAX_NUMBER) {
        logger.warn(`setCol overflow ${colNo}`);
        colNo = MAX_NUMBER;
    }
    return (lineCol & HIGH_BITS_MASK) | colNo;
}
exports.setCol = setCol;
function setLineCol(lineNo, colNo) {
    let lineCol = 0;
    lineCol = setLine(lineCol, lineNo);
    lineCol = setCol(lineCol, colNo);
    return lineCol;
}
exports.setLineCol = setLineCol;
function getLineNo(lineCol) {
    let line = lineCol >>> LOW_BITS_SIZE;
    if (line === MIN_NUMBER) {
        return INVALID_LINE;
    }
    return line;
}
exports.getLineNo = getLineNo;
function getColNo(lineCol) {
    let col = lineCol & LOW_BITS_MASK;
    if (col === MIN_NUMBER) {
        return INVALID_LINE;
    }
    return col;
}
exports.getColNo = getColNo;
/**
 * @category core/base
 */
class LineColPosition {
    constructor(lineNo, colNo) {
        this.lineCol = setLineCol(lineNo, colNo);
    }
    getLineNo() {
        return getLineNo(this.lineCol);
    }
    getColNo() {
        return getColNo(this.lineCol);
    }
    static buildFromNode(node, sourceFile) {
        let { line, character } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
        // line start from 1.
        return new LineColPosition(line + 1, character + 1);
    }
}
exports.LineColPosition = LineColPosition;
LineColPosition.DEFAULT = new LineColPosition(INVALID_LINE, INVALID_LINE);
class FullPosition {
    constructor(firstLine, firstCol, lastLine, lastCol) {
        this.first = setLineCol(firstLine, firstCol);
        this.last = setLineCol(lastLine, lastCol);
    }
    getFirstLine() {
        return getLineNo(this.first);
    }
    getLastLine() {
        return getLineNo(this.last);
    }
    getFirstCol() {
        return getColNo(this.first);
    }
    getLastCol() {
        return getColNo(this.last);
    }
    static buildFromNode(node, sourceFile) {
        const { line: startLine, character: startCharacter } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
        const { line: endLine, character: endCharacter } = ohos_typescript_1.default.getLineAndCharacterOfPosition(sourceFile, node.getEnd());
        // line start from 1
        return new FullPosition(startLine + 1, startCharacter + 1, endLine + 1, endCharacter + 1);
    }
    static merge(leftMostPosition, rightMostPosition) {
        return new FullPosition(leftMostPosition.getFirstLine(), leftMostPosition.getFirstCol(), rightMostPosition.getLastLine(), rightMostPosition.getLastCol());
    }
}
exports.FullPosition = FullPosition;
FullPosition.DEFAULT = new FullPosition(INVALID_LINE, INVALID_LINE, INVALID_LINE, INVALID_LINE);
