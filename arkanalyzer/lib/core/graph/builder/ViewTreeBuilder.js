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
exports.buildViewTree = exports.ViewTreeImpl = void 0;
const Constant_1 = require("../../base/Constant");
const Decorator_1 = require("../../base/Decorator");
const Expr_1 = require("../../base/Expr");
const Local_1 = require("../../base/Local");
const Ref_1 = require("../../base/Ref");
const Stmt_1 = require("../../base/Stmt");
const Type_1 = require("../../base/Type");
const EtsConst_1 = require("../../common/EtsConst");
const ArkClass_1 = require("../../model/ArkClass");
const logger_1 = __importStar(require("../../../utils/logger"));
const ModelUtils_1 = require("../../common/ModelUtils");
const Const_1 = require("../../common/Const");
const logger = logger_1.default.getLogger(logger_1.LOG_MODULE_TYPE.ARKANALYZER, 'ViewTreeBuilder');
const COMPONENT_CREATE_FUNCTIONS = new Set([EtsConst_1.COMPONENT_CREATE_FUNCTION, EtsConst_1.COMPONENT_BRANCH_FUNCTION]);
function backtraceLocalInitValue(value) {
    let stmt = value.getDeclaringStmt();
    if (stmt instanceof Stmt_1.ArkAssignStmt) {
        let rightOp = stmt.getRightOp();
        if (rightOp instanceof Local_1.Local) {
            return backtraceLocalInitValue(rightOp);
        }
        else if (rightOp instanceof Ref_1.ArkInstanceFieldRef && rightOp.getBase().getName().startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
            return backtraceLocalInitValue(rightOp.getBase());
        }
        else if (rightOp instanceof Ref_1.ArkArrayRef) {
            return backtraceLocalInitValue(rightOp.getBase());
        }
        return rightOp;
    }
    return value;
}
function parseObjectLiteral(objectLiteralCls, scene) {
    let map = new Map();
    if ((objectLiteralCls === null || objectLiteralCls === void 0 ? void 0 : objectLiteralCls.getCategory()) !== ArkClass_1.ClassCategory.OBJECT) {
        return map;
    }
    objectLiteralCls === null || objectLiteralCls === void 0 ? void 0 : objectLiteralCls.getFields().forEach(field => {
        let stmts = field.getInitializer();
        if (stmts.length === 0) {
            return;
        }
        let assignStmt = stmts[stmts.length - 1];
        if (!(assignStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        let value = assignStmt.getRightOp();
        if (value instanceof Local_1.Local) {
            value = backtraceLocalInitValue(value);
        }
        map.set(field, value);
        if (value instanceof Expr_1.ArkNewExpr) {
            let subCls = ModelUtils_1.ModelUtils.getArkClassInBuild(scene, value.getClassType());
            let childMap = parseObjectLiteral(subCls, scene);
            if (childMap) {
                map.set(field, childMap);
            }
        }
    });
    return map;
}
class StateValuesUtils {
    constructor(declaringArkClass) {
        this.declaringArkClass = declaringArkClass;
    }
    static getInstance(declaringArkClass) {
        return new StateValuesUtils(declaringArkClass);
    }
    parseStmtUsesStateValues(stmt, uses = new Set(), wholeMethod = false, visitor = new Set()) {
        if (visitor.has(stmt)) {
            return uses;
        }
        visitor.add(stmt);
        let values = stmt.getUses();
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            values.push(stmt.getLeftOp());
        }
        for (const v of values) {
            this.parseValueUsesStateValues(v, uses, wholeMethod, visitor);
        }
        return uses;
    }
    objectLiteralMapUsedStateValues(uses, map) {
        for (const [_, value] of map) {
            if (value instanceof Ref_1.ArkInstanceFieldRef) {
                let srcField = this.declaringArkClass.getFieldWithName(value.getFieldName());
                let decorators = srcField === null || srcField === void 0 ? void 0 : srcField.getStateDecorators();
                if (srcField && decorators && decorators.length > 0) {
                    uses.add(srcField);
                }
            }
            else if (value instanceof Map) {
                this.objectLiteralMapUsedStateValues(uses, value);
            }
            else if (value instanceof Expr_1.ArkNormalBinopExpr || value instanceof Expr_1.ArkConditionExpr) {
                this.parseValueUsesStateValues(value.getOp1(), uses);
                this.parseValueUsesStateValues(value.getOp2(), uses);
            }
        }
    }
    parseObjectUsedStateValues(type, uses = new Set()) {
        if (!(type instanceof Type_1.ClassType)) {
            return uses;
        }
        let cls = ModelUtils_1.ModelUtils.getArkClassInBuild(this.declaringArkClass.getDeclaringArkFile().getScene(), type);
        let map = parseObjectLiteral(cls, this.declaringArkClass.getDeclaringArkFile().getScene());
        this.objectLiteralMapUsedStateValues(uses, map);
        return uses;
    }
    parseMethodUsesStateValues(methodSignature, uses, visitor = new Set()) {
        var _a;
        if (visitor.has(methodSignature)) {
            return;
        }
        visitor.add(methodSignature);
        let method = this.declaringArkClass.getDeclaringArkFile().getScene().getMethod(methodSignature);
        if (!method) {
            return;
        }
        let stmts = (_a = method.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts();
        if (!stmts) {
            return;
        }
        for (const stmt of stmts) {
            this.parseStmtUsesStateValues(stmt, uses, true, visitor);
        }
    }
    parseValueUsesStateValues(v, uses = new Set(), wholeMethod = false, visitor = new Set()) {
        if (v instanceof Ref_1.ArkInstanceFieldRef) {
            let field = this.declaringArkClass.getField(v.getFieldSignature());
            let decorators = field === null || field === void 0 ? void 0 : field.getStateDecorators();
            if (field && decorators && decorators.length > 0) {
                uses.add(field);
            }
        }
        else if (v instanceof Expr_1.ArkInstanceInvokeExpr) {
            this.parseMethodUsesStateValues(v.getMethodSignature(), uses, visitor);
        }
        else if (v instanceof Local_1.Local) {
            if (v.getName() === 'this') {
                return uses;
            }
            let type = v.getType();
            if (type instanceof Type_1.FunctionType) {
                this.parseMethodUsesStateValues(type.getMethodSignature(), uses, visitor);
                return uses;
            }
            this.parseObjectUsedStateValues(type, uses);
            let declaringStmt = v.getDeclaringStmt();
            if (!wholeMethod && declaringStmt) {
                this.parseStmtUsesStateValues(declaringStmt, uses, wholeMethod, visitor);
            }
        }
        return uses;
    }
}
var ViewTreeNodeType;
(function (ViewTreeNodeType) {
    ViewTreeNodeType[ViewTreeNodeType["SystemComponent"] = 0] = "SystemComponent";
    ViewTreeNodeType[ViewTreeNodeType["CustomComponent"] = 1] = "CustomComponent";
    ViewTreeNodeType[ViewTreeNodeType["Builder"] = 2] = "Builder";
    ViewTreeNodeType[ViewTreeNodeType["BuilderParam"] = 3] = "BuilderParam";
})(ViewTreeNodeType || (ViewTreeNodeType = {}));
class ViewTreeNodeImpl {
    constructor(name) {
        this.name = name;
        this.attributes = new Map();
        this.stmts = this.attributes;
        this.stateValues = new Set();
        this.parent = null;
        this.children = [];
        this.type = ViewTreeNodeType.SystemComponent;
    }
    /**
     * Whether the node type is Builder.
     * @returns true: node is Builder, false others.
     */
    isBuilder() {
        return this.type === ViewTreeNodeType.Builder;
    }
    /**
     * @internal
     */
    isBuilderParam() {
        return this.type === ViewTreeNodeType.BuilderParam;
    }
    /**
     * Whether the node type is custom component.
     * @returns true: node is custom component, false others.
     */
    isCustomComponent() {
        return this.type === ViewTreeNodeType.CustomComponent;
    }
    /**
     * walk node and node's children
     * @param selector Node selector function, return true skipping the follow-up nodes.
     * @returns
     *  - true: There are nodes that meet the selector.
     *  - false: does not exist.
     */
    walk(selector, visitor = new Set()) {
        if (visitor.has(this)) {
            return false;
        }
        let ret = selector(this);
        visitor.add(this);
        for (const child of this.children) {
            ret = ret || child.walk(selector, visitor);
            if (ret) {
                break;
            }
        }
        return ret;
    }
    static createCustomComponent() {
        let instance = new ViewTreeNodeImpl(EtsConst_1.COMPONENT_CUSTOMVIEW);
        instance.type = ViewTreeNodeType.CustomComponent;
        return instance;
    }
    static createBuilderNode() {
        let instance = new ViewTreeNodeImpl(EtsConst_1.BUILDER_DECORATOR);
        instance.type = ViewTreeNodeType.Builder;
        return instance;
    }
    static createBuilderParamNode() {
        let instance = new ViewTreeNodeImpl(EtsConst_1.BUILDER_PARAM_DECORATOR);
        instance.type = ViewTreeNodeType.BuilderParam;
        return instance;
    }
    static createBehaviorNode() {
        let instance = new ViewTreeNodeImpl(EtsConst_1.COMPONENT_BEHAVIOR);
        instance.type = ViewTreeNodeType.SystemComponent; // to check
        return instance;
    }
    changeBuilderParam2BuilderNode(builder) {
        var _a;
        this.name = EtsConst_1.BUILDER_DECORATOR;
        this.type = ViewTreeNodeType.Builder;
        this.signature = builder.getSignature();
        this.classSignature = this.signature;
        const root = (_a = builder.getViewTree()) === null || _a === void 0 ? void 0 : _a.getRoot();
        if (root) {
            for (let child of root.children) {
                this.children.push(child);
            }
        }
        else {
            logger.error(`ViewTree->changeBuilderParam2BuilderNode ${builder.getSignature().toString()} @Builder viewtree fail.`);
        }
    }
    hasBuilderParam() {
        return this.walk(item => {
            return item.isBuilderParam();
        });
    }
    clone(parent, map = new Map()) {
        let newNode = new ViewTreeNodeImpl(this.name);
        newNode.attributes = this.attributes;
        newNode.stmts = newNode.attributes;
        newNode.stateValues = this.stateValues;
        newNode.parent = parent;
        newNode.type = this.type;
        newNode.signature = this.signature;
        newNode.classSignature = newNode.signature;
        newNode.builderParam = this.builderParam;
        newNode.builder = this.builder;
        map.set(this, newNode);
        for (const child of this.children) {
            if (map.has(child)) {
                newNode.children.push(map.get(child));
            }
            else {
                newNode.children.push(child.clone(newNode, map));
            }
        }
        return newNode;
    }
    addStmt(local2Node, tree, stmt) {
        this.parseAttributes(local2Node, tree, stmt);
        if (this.name !== EtsConst_1.COMPONENT_FOR_EACH && this.name !== EtsConst_1.COMPONENT_LAZY_FOR_EACH) {
            this.parseStateValues(tree, stmt);
        }
    }
    parseAttributes(local2Node, tree, stmt) {
        let expr;
        if (stmt instanceof Stmt_1.ArkAssignStmt) {
            let op = stmt.getRightOp();
            if (op instanceof Expr_1.ArkInstanceInvokeExpr) {
                expr = op;
            }
            else if (op instanceof Expr_1.ArkStaticInvokeExpr) {
                expr = op;
            }
        }
        else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
            let invoke = stmt.getInvokeExpr();
            if (invoke instanceof Expr_1.ArkInstanceInvokeExpr) {
                expr = invoke;
            }
            else if (invoke instanceof Expr_1.ArkStaticInvokeExpr) {
                expr = invoke;
            }
        }
        if (expr) {
            let key = expr.getMethodSignature().getMethodSubSignature().getMethodName();
            let relationValues = [];
            for (const arg of expr.getArgs()) {
                if (arg instanceof Local_1.Local) {
                    this.getBindValues(arg, relationValues);
                }
                else if (arg instanceof Constant_1.Constant) {
                    relationValues.push(arg);
                }
            }
            let builderNode;
            if (tree.COMPONENT_BEHAVIOR_PARSERS.has(key) && expr instanceof Expr_1.ArkInstanceInvokeExpr) {
                let parseFn = tree.COMPONENT_BEHAVIOR_PARSERS.get(key);
                if (parseFn) {
                    builderNode = parseFn(local2Node, stmt, expr);
                }
            }
            if (builderNode) {
                // create a virtual node name 'Behavior' to hold the behaviorNode
                let behaviorNode = ViewTreeNodeImpl.createBehaviorNode();
                behaviorNode.attributes.set(key, [stmt, relationValues]);
                behaviorNode.parseStateValues(tree, stmt);
                behaviorNode.children.push(builderNode);
                builderNode.parent = behaviorNode;
                this.children.push(behaviorNode);
                behaviorNode.parent = this;
            }
            this.attributes.set(key, [stmt, relationValues]);
        }
    }
    getBindValues(local, relationValues, visitor = new Set()) {
        if (visitor.has(local)) {
            return;
        }
        visitor.add(local);
        const stmt = local.getDeclaringStmt();
        if (!stmt) {
            let type = local.getType();
            if (type instanceof Type_1.FunctionType) {
                relationValues.push(type.getMethodSignature());
            }
            return;
        }
        for (const v of stmt.getUses()) {
            if (v instanceof Constant_1.Constant) {
                relationValues.push(v);
            }
            else if (v instanceof Ref_1.ArkInstanceFieldRef) {
                relationValues.push(v);
            }
            else if (v instanceof Local_1.Local) {
                this.getBindValues(v, relationValues, visitor);
            }
        }
    }
    parseStateValues(tree, stmt) {
        let stateValues = StateValuesUtils.getInstance(tree.getDeclaringArkClass()).parseStmtUsesStateValues(stmt);
        stateValues.forEach(field => {
            this.stateValues.add(field);
            tree.addStateValue(field, this);
        }, this);
    }
}
class TreeNodeStack {
    constructor() {
        this.root = null;
        this.stack = [];
    }
    /**
     * @internal
     */
    push(node) {
        let parent = this.getParent();
        node.parent = parent;
        this.stack.push(node);
        if (parent === null || parent === undefined) {
            this.root = node;
        }
        else {
            parent.children.push(node);
        }
    }
    /**
     * @internal
     */
    pop() {
        this.stack.pop();
    }
    /**
     * @internal
     */
    top() {
        return this.isEmpty() ? null : this.stack[this.stack.length - 1];
    }
    /**
     * @internal
     */
    isEmpty() {
        return this.stack.length === 0;
    }
    /**
     * @internal
     */
    popAutomicComponent(name) {
        if (this.isEmpty()) {
            return;
        }
        let node = this.stack[this.stack.length - 1];
        if (name !== node.name && !this.isContainer(node.name)) {
            this.stack.pop();
        }
    }
    /**
     * @internal
     */
    popComponentExpect(name) {
        for (let i = this.stack.length - 1; i >= 0; i--) {
            if (this.stack[i].name !== name) {
                this.stack.pop();
            }
            else {
                break;
            }
        }
        return this;
    }
    getParent() {
        if (this.stack.length === 0) {
            return null;
        }
        let node = this.stack[this.stack.length - 1];
        if (!this.isContainer(node.name)) {
            this.stack.pop();
        }
        return this.stack[this.stack.length - 1];
    }
    isContainer(name) {
        return (0, EtsConst_1.isEtsContainerComponent)(name) || EtsConst_1.SPECIAL_CONTAINER_COMPONENT.has(name) || name === EtsConst_1.BUILDER_DECORATOR;
    }
}
class ViewTreeImpl extends TreeNodeStack {
    /**
     * @internal
     */
    constructor(render) {
        super();
        this.COMPONENT_CREATE_PARSERS = new Map([
            ['ForEach.create', this.forEachCreationParser.bind(this)],
            ['LazyForEach.create', this.forEachCreationParser.bind(this)],
            ['Repeat.create', this.repeatCreationParser.bind(this)],
            ['View.create', this.viewComponentCreationParser.bind(this)],
            ['If.branch', this.ifBranchCreationParser.bind(this)],
            ['WaterFlow.create', this.waterFlowCreationParser.bind(this)],
        ]);
        this.COMPONENT_BEHAVIOR_PARSERS = new Map([
            ['tabBar', this.tabBarComponentParser.bind(this)],
            ['navDestination', this.navDestinationComponentParser.bind(this)],
            ['bindContextMenu', this.bindContextMenuComponentParser.bind(this)],
            ['bindMenu', this.bindContextMenuComponentParser.bind(this)],
            ['bindContentCover', this.bindContentCoverComponentParser.bind(this)],
            ['bindSheet', this.bindContentCoverComponentParser.bind(this)],
            ['bindPopup', this.bindPopupComponentParser.bind(this)],
        ]);
        this.render = render;
        this.stateValues = new Map();
        this.fieldTypes = new Map();
        this.buildViewStatus = false;
    }
    /**
     * ViewTree root node.
     * @returns root node
     */
    getRoot() {
        this.buildViewTree();
        return this.root;
    }
    /**
     * Map of the component controlled by the state variable
     * @returns
     */
    getStateValues() {
        this.buildViewTree();
        return this.stateValues;
    }
    /**
     * @deprecated Use {@link getStateValues} instead.
     */
    isClassField(name) {
        return this.fieldTypes.has(name);
    }
    /**
     * @deprecated Use {@link getStateValues} instead.
     */
    getClassFieldType(name) {
        return this.fieldTypes.get(name);
    }
    /**
     * @internal
     */
    buildViewTree() {
        if (!this.render || this.isInitialized()) {
            return;
        }
        this.buildViewStatus = true;
        this.loadClasssFieldTypes();
        if (this.render.hasBuilderDecorator()) {
            let node = ViewTreeNodeImpl.createBuilderNode();
            node.signature = this.render.getSignature();
            node.classSignature = node.signature;
            this.push(node);
        }
        if (this.render.getCfg()) {
            this.buildViewTreeFromCfg(this.render.getCfg());
        }
    }
    /**
     * @internal
     */
    isInitialized() {
        return this.root != null || this.buildViewStatus;
    }
    /**
     * @internal
     */
    addStateValue(field, node) {
        if (!this.stateValues.has(field)) {
            this.stateValues.set(field, new Set());
        }
        let sets = this.stateValues.get(field);
        sets === null || sets === void 0 ? void 0 : sets.add(node);
    }
    /**
     * @internal
     */
    isCreateFunc(name) {
        return COMPONENT_CREATE_FUNCTIONS.has(name);
    }
    loadClasssFieldTypes() {
        for (const field of this.render.getDeclaringArkClass().getFields()) {
            let decorators = field.getStateDecorators();
            if (decorators.length > 0) {
                if (decorators.length === 1) {
                    this.fieldTypes.set(field.getName(), decorators[0]);
                }
                else {
                    this.fieldTypes.set(field.getName(), decorators[0]);
                }
            }
            else {
                this.fieldTypes.set(field.getName(), field.getSignature().getType());
            }
        }
    }
    /**
     * @internal
     */
    getDeclaringArkClass() {
        return this.render.getDeclaringArkClass();
    }
    /**
     * @internal
     */
    findMethod(methodSignature) {
        let method = this.render.getDeclaringArkFile().getScene().getMethod(methodSignature);
        if (method) {
            return method;
        }
        // class
        method = this.getDeclaringArkClass().getMethod(methodSignature);
        if (method) {
            return method;
        }
        return this.findMethodWithName(methodSignature.getMethodSubSignature().getMethodName());
    }
    /**
     * @internal
     */
    findMethodWithName(name) {
        var _a;
        let method = this.getDeclaringArkClass().getMethodWithName(name);
        if (method) {
            return method;
        }
        // namespace
        (_a = this.getDeclaringArkClass()
            .getDeclaringArkNamespace()) === null || _a === void 0 ? void 0 : _a.getAllMethodsUnderThisNamespace().forEach(value => {
            if (value.getName() === name) {
                method = value;
            }
        });
        if (method) {
            return method;
        }
        this.getDeclaringArkClass()
            .getDeclaringArkFile()
            .getAllNamespacesUnderThisFile()
            .forEach(namespace => {
            namespace.getAllMethodsUnderThisNamespace().forEach(value => {
                if (value.getName() === name) {
                    method = value;
                }
            });
        });
        return method;
    }
    /**
     * @internal
     */
    findClass(classSignature) {
        return ModelUtils_1.ModelUtils.getClass(this.render, classSignature);
    }
    findBuilderMethod(value) {
        let method;
        if (value instanceof Ref_1.ArkInstanceFieldRef) {
            method = this.findMethodWithName(value.getFieldName());
        }
        else if (value instanceof Expr_1.ArkStaticInvokeExpr) {
            method = this.findMethod(value.getMethodSignature());
        }
        else if (value instanceof Local_1.Local && value.getType() instanceof Type_1.FunctionType) {
            method = this.findMethod(value.getType().getMethodSignature());
        }
        else if (value instanceof Local_1.Local) {
            method = this.findMethodWithName(value.getName());
        }
        if (method && !method.hasBuilderDecorator()) {
            method = this.findMethodInvokeBuilderMethod(method);
        }
        return method;
    }
    /**
     * @internal
     */
    addBuilderNode(method, shouldPush = true) {
        let builderViewTree = method.getViewTree();
        if (!builderViewTree || !builderViewTree.getRoot()) {
            logger.error(`ViewTree->addBuilderNode ${method.getSignature().toString()} build viewtree fail.`);
            // add empty node
            let node = ViewTreeNodeImpl.createBuilderNode();
            node.signature = method.getSignature();
            node.classSignature = node.signature;
            if (shouldPush) {
                this.push(node);
                this.pop();
            }
            return node;
        }
        let root = builderViewTree.getRoot();
        if (shouldPush) {
            this.push(root);
        }
        if (method.getDeclaringArkClass() === this.render.getDeclaringArkClass()) {
            for (const [field, nodes] of builderViewTree.getStateValues()) {
                for (const node of nodes) {
                    this.addStateValue(field, node);
                }
            }
        }
        if (shouldPush) {
            this.pop();
        }
        return root;
    }
    /**
     * @internal
     */
    addCustomComponentNode(cls, arg, builder) {
        let node = ViewTreeNodeImpl.createCustomComponent();
        node.signature = cls.getSignature();
        node.classSignature = node.signature;
        node.stateValuesTransfer = this.parseObjectLiteralExpr(cls, arg, builder);
        if (arg instanceof Local_1.Local && arg.getType()) {
            let stateValues = StateValuesUtils.getInstance(this.getDeclaringArkClass()).parseObjectUsedStateValues(arg.getType());
            stateValues.forEach(field => {
                node.stateValues.add(field);
                this.addStateValue(field, node);
            });
        }
        this.push(node);
        let componentViewTree = cls.getViewTree();
        if (!componentViewTree || !componentViewTree.getRoot()) {
            logger.error(`ViewTree->addCustomComponentNode ${cls.getSignature().toString()} build viewtree fail.`);
            return node;
        }
        let root = componentViewTree.getRoot();
        if (root.hasBuilderParam()) {
            root = this.cloneBuilderParamNode(node, root);
        }
        node.children.push(root);
        return node;
    }
    cloneBuilderParamNode(node, root) {
        root = root.clone(node);
        if (node.stateValuesTransfer) {
            root.walk(item => {
                var _a;
                let child = item;
                if (!child.isBuilderParam() || !child.builderParam) {
                    return false;
                }
                let method = (_a = node.stateValuesTransfer) === null || _a === void 0 ? void 0 : _a.get(child.builderParam);
                if (method) {
                    child.changeBuilderParam2BuilderNode(method);
                }
                return false;
            });
        }
        return root;
    }
    /**
     * @internal
     */
    addBuilderParamNode(field) {
        let node = ViewTreeNodeImpl.createBuilderParamNode();
        node.builderParam = field;
        this.push(node);
        this.pop();
        return node;
    }
    /**
     * @internal
     */
    addSystemComponentNode(name) {
        let node = new ViewTreeNodeImpl(name);
        this.push(node);
        return node;
    }
    findMethodInvokeBuilderMethod(method) {
        var _a;
        let stmts = (_a = method.getCfg()) === null || _a === void 0 ? void 0 : _a.getStmts();
        if (!stmts) {
            return undefined;
        }
        for (const stmt of stmts) {
            let expr;
            if (stmt instanceof Stmt_1.ArkInvokeStmt) {
                expr = stmt.getInvokeExpr();
            }
            else if (stmt instanceof Stmt_1.ArkAssignStmt) {
                let rightOp = stmt.getRightOp();
                if (rightOp instanceof Expr_1.ArkInstanceInvokeExpr || rightOp instanceof Expr_1.ArkStaticInvokeExpr) {
                    expr = rightOp;
                }
            }
            if (expr === undefined) {
                continue;
            }
            let method = this.findMethod(expr.getMethodSignature());
            if (method === null || method === void 0 ? void 0 : method.hasBuilderDecorator()) {
                return method;
            }
        }
        return undefined;
    }
    parseFieldInObjectLiteral(field, cls, transferMap) {
        let dstField = cls.getFieldWithName(field.getName());
        if ((dstField === null || dstField === void 0 ? void 0 : dstField.getStateDecorators().length) === 0 && !(dstField === null || dstField === void 0 ? void 0 : dstField.hasBuilderParamDecorator())) {
            return;
        }
        let stmts = field.getInitializer();
        if (stmts.length === 0) {
            return;
        }
        let assignStmt = stmts[stmts.length - 1];
        if (!(assignStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        let value = assignStmt.getRightOp();
        if (value instanceof Local_1.Local) {
            value = backtraceLocalInitValue(value);
        }
        if (dstField === null || dstField === void 0 ? void 0 : dstField.hasBuilderParamDecorator()) {
            let method = this.findBuilderMethod(value);
            if (method) {
                transferMap.set(dstField, method);
            }
        }
        else {
            let srcField;
            if (value instanceof Ref_1.ArkInstanceFieldRef) {
                srcField = this.getDeclaringArkClass().getFieldWithName(value.getFieldName());
            }
            if (srcField && dstField) {
                transferMap.set(dstField, srcField);
            }
        }
    }
    parseObjectLiteralExpr(cls, object, builder) {
        let transferMap = new Map();
        if (object instanceof Local_1.Local && object.getType() instanceof Type_1.ClassType) {
            let anonymousSig = object.getType().getClassSignature();
            let anonymous = this.findClass(anonymousSig);
            anonymous === null || anonymous === void 0 ? void 0 : anonymous.getFields().forEach(field => {
                this.parseFieldInObjectLiteral(field, cls, transferMap);
            });
        }
        // If the builder exists, there will be a unique BuilderParam
        if (builder) {
            cls.getFields().forEach(value => {
                if (value.hasBuilderParamDecorator()) {
                    transferMap.set(value, builder);
                }
            });
        }
        if (transferMap.size === 0) {
            return undefined;
        }
        return transferMap;
    }
    viewComponentCreationParser(name, stmt, expr) {
        let temp = expr.getArg(0);
        let arg;
        temp.getUsedStmts().forEach(value => {
            if (value instanceof Stmt_1.ArkAssignStmt && value.getRightOp() instanceof Expr_1.ArkInstanceInvokeExpr) {
                const rightOp = value.getRightOp();
                const methodName = rightOp.getMethodSignature().getMethodSubSignature().getMethodName();
                if (methodName === 'constructor') {
                    arg = rightOp.getArg(0);
                }
            }
        });
        let builderMethod;
        let builder = expr.getArg(1);
        if (builder) {
            let method = this.findMethod(builder.getType().getMethodSignature());
            if (!(method === null || method === void 0 ? void 0 : method.hasBuilderDecorator())) {
                method === null || method === void 0 ? void 0 : method.addDecorator(new Decorator_1.Decorator(EtsConst_1.BUILDER_DECORATOR));
            }
            if (!(method === null || method === void 0 ? void 0 : method.hasViewTree())) {
                method === null || method === void 0 ? void 0 : method.setViewTree(new ViewTreeImpl(method));
            }
            if (method) {
                builderMethod = method;
            }
        }
        let initValue = backtraceLocalInitValue(temp);
        if (!(initValue instanceof Expr_1.ArkNewExpr)) {
            return undefined;
        }
        const initValueType = initValue.getType();
        if (!(initValueType instanceof Type_1.ClassType)) {
            return undefined;
        }
        let clsSignature = initValueType.getClassSignature();
        if (clsSignature) {
            let cls = this.findClass(clsSignature);
            if (cls && cls.hasComponentDecorator()) {
                return this.addCustomComponentNode(cls, arg, builderMethod);
            }
            else {
                logger.error(`ViewTree->viewComponentCreationParser not found class ${clsSignature.toString()}. ${stmt.toString()}`);
            }
        }
        return undefined;
    }
    waterFlowCreationParser(name, stmt, expr) {
        let node = this.addSystemComponentNode(name);
        let object = expr.getArg(0);
        if (object instanceof Local_1.Local && object.getType() instanceof Type_1.ClassType) {
            let anonymousSig = object.getType().getClassSignature();
            let anonymous = this.findClass(anonymousSig);
            let footer = anonymous === null || anonymous === void 0 ? void 0 : anonymous.getFieldWithName('footer');
            if (!footer) {
                return node;
            }
            let stmts = footer.getInitializer();
            let assignStmt = stmts[stmts.length - 1];
            if (!(assignStmt instanceof Stmt_1.ArkAssignStmt)) {
                return node;
            }
            let value = assignStmt.getRightOp();
            let method = this.findBuilderMethod(value);
            if (method === null || method === void 0 ? void 0 : method.hasBuilderDecorator()) {
                return this.addBuilderNode(method);
            }
        }
        return node;
    }
    forEachCreationParser(name, stmt, expr) {
        let node = this.addSystemComponentNode(name);
        let values = expr.getArg(0);
        let declaringStmt = values === null || values === void 0 ? void 0 : values.getDeclaringStmt();
        if (declaringStmt) {
            let stateValues = StateValuesUtils.getInstance(this.getDeclaringArkClass()).parseStmtUsesStateValues(declaringStmt);
            stateValues.forEach(field => {
                node.stateValues.add(field);
                this.addStateValue(field, node);
            });
        }
        let type = expr.getArg(1).getType();
        let method = this.findMethod(type.getMethodSignature());
        if (method && method.getCfg()) {
            this.buildViewTreeFromCfg(method.getCfg());
        }
        return node;
    }
    repeatCreationParser(name, stmt, expr) {
        let node = this.addSystemComponentNode(name);
        let arg = expr.getArg(0);
        let declaringStmt = arg === null || arg === void 0 ? void 0 : arg.getDeclaringStmt();
        if (declaringStmt) {
            let stateValues = StateValuesUtils.getInstance(this.getDeclaringArkClass()).parseStmtUsesStateValues(declaringStmt);
            stateValues.forEach(field => {
                node.stateValues.add(field);
                this.addStateValue(field, node);
            });
        }
        return node;
    }
    ifBranchCreationParser(name, stmt, expr) {
        this.popComponentExpect(EtsConst_1.COMPONENT_IF);
        return this.addSystemComponentNode(EtsConst_1.COMPONENT_IF_BRANCH);
    }
    componentCreateParse(local2Node, componentName, methodName, stmt, expr) {
        let parserFn = this.COMPONENT_CREATE_PARSERS.get(`${componentName}.${methodName}`);
        if (parserFn) {
            let node = parserFn(componentName, stmt, expr);
            node === null || node === void 0 ? void 0 : node.addStmt(local2Node, this, stmt);
            return node;
        }
        this.popAutomicComponent(componentName);
        let node = this.addSystemComponentNode(componentName);
        node.addStmt(local2Node, this, stmt);
        return node;
    }
    parseStaticInvokeExpr(local2Node, stmt, expr, shouldPush = true) {
        let methodSignature = expr.getMethodSignature();
        let method = this.findMethod(methodSignature);
        if (method === null || method === void 0 ? void 0 : method.hasBuilderDecorator()) {
            let node = this.addBuilderNode(method, shouldPush);
            node.parseStateValues(this, stmt);
            return node;
        }
        let name = methodSignature.getDeclaringClassSignature().getClassName();
        let methodName = methodSignature.getMethodSubSignature().getMethodName();
        if (this.isCreateFunc(methodName)) {
            return this.componentCreateParse(local2Node, name, methodName, stmt, expr);
        }
        let currentNode = this.top();
        if (name === (currentNode === null || currentNode === void 0 ? void 0 : currentNode.name)) {
            currentNode.addStmt(local2Node, this, stmt);
            if (methodName === EtsConst_1.COMPONENT_POP_FUNCTION) {
                this.pop();
            }
            return currentNode;
        }
        else if (name === EtsConst_1.COMPONENT_IF && methodName === EtsConst_1.COMPONENT_POP_FUNCTION) {
            this.popComponentExpect(EtsConst_1.COMPONENT_IF);
            this.pop();
        }
        return undefined;
    }
    /**
     * $temp4.margin({ top: 20 });
     * @param viewTree
     * @param local2Node
     * @param expr
     */
    parseInstanceInvokeExpr(local2Node, stmt, expr, shouldPush = true) {
        let temp = expr.getBase();
        if (local2Node.has(temp)) {
            let component = local2Node.get(temp);
            if ((component === null || component === void 0 ? void 0 : component.name) === EtsConst_1.COMPONENT_REPEAT && expr.getMethodSignature().getMethodSubSignature().getMethodName() === 'each') {
                let arg = expr.getArg(0);
                let type = arg.getType();
                if (type instanceof Type_1.FunctionType) {
                    let method = this.findMethod(type.getMethodSignature());
                    this.buildViewTreeFromCfg(method === null || method === void 0 ? void 0 : method.getCfg());
                }
                this.pop();
            }
            else {
                component === null || component === void 0 ? void 0 : component.addStmt(local2Node, this, stmt);
            }
            return component;
        }
        let name = expr.getBase().getName();
        if (name.startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
            let initValue = backtraceLocalInitValue(expr.getBase());
            if (initValue instanceof Ref_1.ArkThisRef) {
                name = 'this';
            }
        }
        let methodName = expr.getMethodSignature().getMethodSubSignature().getMethodName();
        let field = this.getDeclaringArkClass().getFieldWithName(methodName);
        if (name === 'this' && (field === null || field === void 0 ? void 0 : field.hasBuilderParamDecorator())) {
            return this.addBuilderParamNode(field);
        }
        let method = this.findMethod(expr.getMethodSignature());
        if (name === 'this' && (method === null || method === void 0 ? void 0 : method.hasBuilderDecorator())) {
            return this.addBuilderNode(method, shouldPush);
        }
        return undefined;
    }
    parsePtrInvokeExpr(local2Node, stmt, expr, shouldPush = true) {
        let temp = expr.getFuncPtrLocal();
        if (temp instanceof Local_1.Local && local2Node.has(temp)) {
            let component = local2Node.get(temp);
            if ((component === null || component === void 0 ? void 0 : component.name) === EtsConst_1.COMPONENT_REPEAT && expr.getMethodSignature().getMethodSubSignature().getMethodName() === 'each') {
                let arg = expr.getArg(0);
                let type = arg.getType();
                if (type instanceof Type_1.FunctionType) {
                    let method = this.findMethod(type.getMethodSignature());
                    this.buildViewTreeFromCfg(method === null || method === void 0 ? void 0 : method.getCfg());
                }
                this.pop();
            }
            else {
                component === null || component === void 0 ? void 0 : component.addStmt(local2Node, this, stmt);
            }
            return component;
        }
        else if (temp instanceof Ref_1.ArkInstanceFieldRef) {
            let name = temp.getBase().getName();
            if (name.startsWith(Const_1.TEMP_LOCAL_PREFIX)) {
                let initValue = backtraceLocalInitValue(temp.getBase());
                if (initValue instanceof Ref_1.ArkThisRef) {
                    name = 'this';
                }
            }
            let methodName = temp.getFieldName();
            let field = this.getDeclaringArkClass().getFieldWithName(methodName);
            if (name === 'this' && (field === null || field === void 0 ? void 0 : field.hasBuilderParamDecorator())) {
                return this.addBuilderParamNode(field);
            }
            let method = this.findMethod(expr.getMethodSignature());
            if (name === 'this' && (method === null || method === void 0 ? void 0 : method.hasBuilderDecorator())) {
                return this.addBuilderNode(method, shouldPush);
            }
        }
        return undefined;
    }
    /**
     * $temp3 = View.create($temp2);
     * $temp4 = View.pop();
     * $temp4.margin({ top: 20 });
     *
     * $temp2 = List.create();
     * $temp5 = $temp2.width('100%');
     * $temp6 = $temp5.height('100%');
     * $temp6.backgroundColor('#FFDCDCDC');
     * @param viewTree
     * @param local2Node
     * @param stmt
     * @returns
     */
    parseAssignStmt(local2Node, stmt, shouldPush = true) {
        let left = stmt.getLeftOp();
        let right = stmt.getRightOp();
        if (!(left instanceof Local_1.Local)) {
            return;
        }
        let component;
        if (right instanceof Expr_1.ArkStaticInvokeExpr) {
            component = this.parseStaticInvokeExpr(local2Node, stmt, right, shouldPush);
        }
        else if (right instanceof Expr_1.ArkInstanceInvokeExpr) {
            component = this.parseInstanceInvokeExpr(local2Node, stmt, right, shouldPush);
        }
        else if (right instanceof Expr_1.ArkPtrInvokeExpr) {
            component = this.parsePtrInvokeExpr(local2Node, stmt, right, shouldPush);
        }
        if (component) {
            local2Node.set(left, component);
        }
    }
    parseInvokeStmt(local2Node, stmt) {
        let expr = stmt.getInvokeExpr();
        if (expr instanceof Expr_1.ArkStaticInvokeExpr) {
            this.parseStaticInvokeExpr(local2Node, stmt, expr);
        }
        else if (expr instanceof Expr_1.ArkInstanceInvokeExpr) {
            this.parseInstanceInvokeExpr(local2Node, stmt, expr);
        }
        else if (expr instanceof Expr_1.ArkPtrInvokeExpr) {
            this.parsePtrInvokeExpr(local2Node, stmt, expr);
        }
    }
    buildViewTreeFromCfg(cfg, local2Node = new Map()) {
        if (!cfg) {
            return;
        }
        let blocks = cfg.getBlocks();
        for (const block of blocks) {
            for (const stmt of block.getStmts()) {
                if (!(stmt instanceof Stmt_1.ArkInvokeStmt || stmt instanceof Stmt_1.ArkAssignStmt)) {
                    continue;
                }
                if (stmt instanceof Stmt_1.ArkAssignStmt) {
                    this.parseAssignStmt(local2Node, stmt, false);
                }
                else if (stmt instanceof Stmt_1.ArkInvokeStmt) {
                    this.parseInvokeStmt(local2Node, stmt);
                }
            }
        }
    }
    /**
     * Parses the 'tabBar' behavior binding.
     * Only supports extracting the argument when it is of type CustomBuilder.
     * Other argument types (e.g. string, Resource, TabBarOptions, SubTabBarStyle, BottomTabBarStyle, ComponentContent) are not handled.
     *
     * Supported signatures:
     *   - tabBar(options: string | Resource | CustomBuilder | TabBarOptions)
     *   - tabBar(value: SubTabBarStyle | BottomTabBarStyle) // API 9+
     *   - tabBar(content: ComponentContent | SubTabBarStyle | BottomTabBarStyle | string | Resource | CustomBuilder | TabBarOptions) // API 18+
     */
    tabBarComponentParser(local2Node, stmt, expr) {
        // Only the first argument (index 0) is analyzed for CustomBuilder type
        return this.parseBehaviorComponent(local2Node, expr, 0);
    }
    /**
     * Parses the 'navDestination' behavior binding.
     * Supports extracting the 'builder' argument when it is of FunctionType.
     *
     * navDestination(builder: (name: string, param: unknown) => void)
     */
    navDestinationComponentParser(local2Node, stmt, expr) {
        const args = expr.getArgs();
        const arg = args[0];
        const type = arg.getType();
        if (!(type instanceof Type_1.FunctionType)) {
            return undefined;
        }
        return this.parseBehaviorComponent(local2Node, expr, 0);
    }
    /**
     * Parses the 'bindContextMenu' behavior binding for API 8 and API 12.
     * Only supports extracting the 'content' argument when it is of type CustomBuilder.
     * Other argument types (e.g. ResponseType, ContextMenuOptions) are not handled.
     *
     * Supported signatures:
     *   - bindContextMenu(content: CustomBuilder, responseType: ResponseType, options?: ContextMenuOptions): T   // API 8
     *   - bindContextMenu(isShown: boolean, content: CustomBuilder, options?: ContextMenuOptions): T             // API 12
     */
    bindContextMenuComponentParser(local2Node, stmt, expr) {
        const args = expr.getArgs();
        const firstType = args[0].getType();
        const argIndex = firstType instanceof Type_1.BooleanType ? 1 : 0;
        return this.parseBehaviorComponent(local2Node, expr, argIndex);
    }
    /**
     * Parses the 'bindContentCover' behavior binding.
     * Only supports extracting the CustomBuilder argument from the second parameter.
     * Other ContentCoverOptions properties are not handled.
     *
     * bindContentCover(isShow: boolean, builder: CustomBuilder, options?: ContentCoverOptions): T
     */
    bindContentCoverComponentParser(local2Node, stmt, expr) {
        return this.parseBehaviorComponent(local2Node, expr, 1);
    }
    /**
     * Parses the 'bindPopup' behavior binding.
     * Only supports extracting the 'builder' field from CustomPopupOptions (custom popup content).
     * Other PopupOptions properties are not supported yet.
     *
     * bindPopup(show: boolean, popup: PopupOptions | CustomPopupOptions): T
     */
    bindPopupComponentParser(local2Node, stmt, expr) {
        return this.parseBehaviorComponent(local2Node, expr, 1, 'builder');
    }
    parseBehaviorComponent(local2Node, expr, argIndex, builderFieldName) {
        const args = expr.getArgs();
        const arg = args[argIndex];
        const local = arg;
        const type = arg.getType();
        // Prefer to return existing node
        if (local2Node.has(local)) {
            const node = local2Node.get(local);
            return node;
        }
        // Normal ‘Builder’ parsing
        if (!builderFieldName) {
            if (type instanceof Type_1.FunctionType) {
                const method = this.findMethod(type.getMethodSignature());
                if (method && method.hasBuilderDecorator()) {
                    const builderNode = this.addBuilderNode(method, false);
                    local2Node.set(local, builderNode);
                    return builderNode;
                }
            }
        }
        else {
            // Complex builder field parsing (e.g. 'builder' field in ‘bindPopup’)
            if (type instanceof Type_1.ClassType && builderFieldName) {
                return this.parseBuilderFieldNode(local, type, builderFieldName, local2Node);
            }
        }
        return undefined;
    }
    parseBuilderFieldNode(local, type, builderFieldName, local2Node) {
        const cls = this.findClass(type.getClassSignature());
        if (!cls) {
            return undefined;
        }
        const field = cls.getFieldWithName(builderFieldName);
        if (!field) {
            return undefined;
        }
        const map = parseObjectLiteral(cls, this.getDeclaringArkClass().getDeclaringArkFile().getScene());
        const builderValue = map.get(field);
        if (!(builderValue instanceof Ref_1.ArkInstanceFieldRef)) {
            return undefined;
        }
        const builder_type = builderValue.getType();
        if (!(builder_type instanceof Type_1.FunctionType)) {
            return undefined;
        }
        const method = this.findMethod(builder_type.getMethodSignature());
        if (method && method.hasBuilderDecorator()) {
            const builderNode = this.addBuilderNode(method, false);
            local2Node.set(local, builderNode);
            return builderNode;
        }
        return undefined;
    }
}
exports.ViewTreeImpl = ViewTreeImpl;
function buildViewTree(render) {
    return new ViewTreeImpl(render);
}
exports.buildViewTree = buildViewTree;
