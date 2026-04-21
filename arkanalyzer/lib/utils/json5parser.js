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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJsonText = exports.fetchDependenciesFromFile = void 0;
const ts = __importStar(require("ohos-typescript"));
const fs = __importStar(require("fs"));
const logger_1 = __importStar(require("./logger"));
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'json5parser');
function fetchDependenciesFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    let configurationsText;
    try {
        configurationsText = fs.readFileSync(filePath, 'utf-8');
    }
    catch (error) {
        logger.error(`Error reading file: ${error}`);
        return {};
    }
    const file = parseJsonText(configurationsText);
    return file;
}
exports.fetchDependenciesFromFile = fetchDependenciesFromFile;
function parseJsonText(text) {
    let file;
    try {
        file = ts.parseJsonText('', text);
    }
    catch (error) {
        logger.error(`Error parsing file: ${error}`);
        return {};
    }
    const rootObjectLiteralExpression = getRootObjectLiteral(file);
    if (!rootObjectLiteralExpression) {
        logger.error('The JSON5 file format is incorrect, rootObjectLiteralExpression is null.');
        return {};
    }
    return parseObjectLiteralExpression(rootObjectLiteralExpression, file);
}
exports.parseJsonText = parseJsonText;
function getRootObjectLiteral(file) {
    if (!file || !file.statements || !file.statements.length) {
        logger.error('The JSON5 file format is incorrect, the root node statements is empty.');
        return undefined;
    }
    const expressionStatement = file.statements[0];
    if (expressionStatement.kind !== ts.SyntaxKind.ExpressionStatement) {
        logger.error(`The JSON5 file format is incorrect, the first child node is not ExpressionStatement. kind: ${expressionStatement.kind}`);
        return undefined;
    }
    const rootObjectLiteralExpression = expressionStatement.expression;
    if (!rootObjectLiteralExpression) {
        logger.error('The JSON5 file format is incorrect, the first child node is empty.');
        return undefined;
    }
    if (rootObjectLiteralExpression.kind === ts.SyntaxKind.ObjectLiteralExpression) {
        return rootObjectLiteralExpression;
    }
    if (rootObjectLiteralExpression.kind === ts.SyntaxKind.ArrayLiteralExpression) {
        const elements = rootObjectLiteralExpression.elements;
        if (elements && elements.length && elements[0].kind === ts.SyntaxKind.ObjectLiteralExpression) {
            return elements[0];
        }
        logger.error('The JSON5 file format is incorrect, the node ArrayLiteralExpression first element is not ObjectLiteralExpression.');
    }
    logger.error('The JSON5 file format is incorrect.');
    return undefined;
}
function parsePropertyInitializer(node, file) {
    if (node.kind === ts.SyntaxKind.StringLiteral) {
        return node.text;
    }
    else if (node.kind === ts.SyntaxKind.NumericLiteral) {
        return node.text;
    }
    else if (node.kind === ts.SyntaxKind.PrefixUnaryExpression) {
        return node.getText(file);
    }
    else if (node.kind === ts.SyntaxKind.ArrayLiteralExpression) {
        return parseArrayLiteral(node, file);
    }
    else if (node.kind === ts.SyntaxKind.ObjectLiteralExpression) {
        return parseObjectLiteralExpression(node, file);
    }
    else if (node.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
    }
    else if (node.kind === ts.SyntaxKind.FalseKeyword) {
        return false;
    }
    return undefined;
}
function parseArrayLiteral(node, file) {
    const res = [];
    node.elements.forEach(n => {
        res.push(parsePropertyInitializer(n, file));
    });
    return res;
}
function parseObjectLiteralExpression(ObjectLiteralExpression, file) {
    const res = {};
    ObjectLiteralExpression.properties.forEach(node => {
        const propNode = node;
        const key = propNode.name.text;
        const value = parsePropertyInitializer(propNode.initializer, file);
        res[key] = value;
    });
    return res;
}
