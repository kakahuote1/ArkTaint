"use strict";
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
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
exports.StoragePlugin = exports.StorageLinkEdgeType = exports.StorageType = void 0;
const Constant_1 = require("../../../core/base/Constant");
const Expr_1 = require("../../../core/base/Expr");
const Local_1 = require("../../../core/base/Local");
const Stmt_1 = require("../../../core/base/Stmt");
const Type_1 = require("../../../core/base/Type");
const Pag_1 = require("../Pag");
var StorageType;
(function (StorageType) {
    StorageType[StorageType["APP_STORAGE"] = 0] = "APP_STORAGE";
    StorageType[StorageType["LOCAL_STORAGE"] = 1] = "LOCAL_STORAGE";
    StorageType[StorageType["SUBSCRIBED_ABSTRACT_PROPERTY"] = 2] = "SUBSCRIBED_ABSTRACT_PROPERTY";
    StorageType[StorageType["Undefined"] = 3] = "Undefined";
})(StorageType = exports.StorageType || (exports.StorageType = {}));
;
var StorageLinkEdgeType;
(function (StorageLinkEdgeType) {
    StorageLinkEdgeType[StorageLinkEdgeType["Property2Local"] = 0] = "Property2Local";
    StorageLinkEdgeType[StorageLinkEdgeType["Local2Property"] = 1] = "Local2Property";
    StorageLinkEdgeType[StorageLinkEdgeType["TwoWay"] = 2] = "TwoWay";
})(StorageLinkEdgeType = exports.StorageLinkEdgeType || (exports.StorageLinkEdgeType = {}));
;
/**
 * StoragePlugin processes AppStorage, LocalStorage, and SubscribedAbstractProperty APIs.
 */
class StoragePlugin {
    constructor(pag, pagBuilder, cg) {
        this.storagePropertyMap = new Map();
        this.pag = pag;
        this.pagBuilder = pagBuilder;
        this.cg = cg;
        // Initialize storagePropertyMap for each StorageType
        this.storagePropertyMap.set(StorageType.APP_STORAGE, new Map());
        this.storagePropertyMap.set(StorageType.LOCAL_STORAGE, new Map());
    }
    getName() {
        return 'StoragePlugin';
    }
    canHandle(cs, cgNode) {
        const storageName = cgNode.getMethod().getDeclaringClassSignature().getClassName();
        return this.getStorageType(storageName) !== StorageType.Undefined;
    }
    processCallSite(cs, cid, emptyNode) {
        let calleeFuncID = cs.getCalleeFuncID();
        if (!calleeFuncID) {
            return [];
        }
        const cgNode = this.cg.getNode(calleeFuncID);
        const storageName = cgNode.getMethod().getDeclaringClassSignature().getClassName();
        const storageType = this.getStorageType(storageName);
        const calleeName = cgNode.getMethod().getMethodSubSignature().getMethodName();
        return this.processStorageAPI(cs, cid, storageType, calleeName, this.pagBuilder);
    }
    /**
     * get storageType enum with method's Declaring ClassName
     *
     * @param storageName ClassName that method belongs to, currently support AppStorage and SubscribedAbstractProperty
     * SubscribedAbstractProperty: in following listing, `link1` is infered as ClassType `SubscribedAbstractProperty`,
     * it needs to get PAG node to check the StorageType
     * let link1: SubscribedAbstractProperty<A> = AppStorage.link('PropA');
     * link1.set(a);
     * @param cs: for search PAG node in SubscribedAbstractProperty
     * @param cid: for search PAG node in SubscribedAbstractProperty
     * @returns StorageType enum
     */
    getStorageType(storageName) {
        switch (storageName) {
            case 'AppStorage':
                return StorageType.APP_STORAGE;
            case 'SubscribedAbstractProperty':
                return StorageType.SUBSCRIBED_ABSTRACT_PROPERTY;
            case 'LocalStorage':
                return StorageType.LOCAL_STORAGE;
            default:
                return StorageType.Undefined;
        }
    }
    processStorageAPI(cs, cid, storageType, calleeName, pagBuilder) {
        let srcNodes = [];
        switch (calleeName) {
            case 'setOrCreate':
                this.processStorageSetOrCreate(cs, cid, storageType, srcNodes);
                break;
            case 'link':
                this.processStorageLink(cs, cid, storageType, srcNodes);
                break;
            case 'prop':
                this.processStorageProp(cs, cid, storageType, srcNodes);
                break;
            case 'set':
                this.processStorageSet(cs, cid, storageType, srcNodes);
                break;
            case 'get':
                this.processStorageGet(cs, cid, storageType, srcNodes);
                break;
            default:
                break;
        }
        ;
        return srcNodes;
    }
    processStorageSetOrCreate(cs, cid, storageType, srcNodes) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(StorageType.APP_STORAGE, propertyName);
        if (storageType === StorageType.APP_STORAGE) {
            let storageObj = cs.args[1];
            this.addPropertyLinkEdge(propertyNode, storageObj, cid, cs.callStmt, StorageLinkEdgeType.Local2Property, srcNodes);
        }
        else if (storageType === StorageType.LOCAL_STORAGE) {
            // TODO: WIP
        }
        return;
    }
    /**
     * search the storage map to get propertyNode with given storage and propertyFieldName
     * @param storage storage type: AppStorage, LocalStorage etc.
     * @param propertyName string property key
     * @returns propertyNode: PagLocalNode
     */
    getOrNewPropertyNode(storage, propertyName) {
        let storageMap = this.storagePropertyMap.get(storage);
        let propertyLocal = storageMap.get(propertyName);
        if (!propertyLocal) {
            switch (storage) {
                case StorageType.APP_STORAGE:
                    propertyLocal = new Local_1.Local('AppStorage.' + propertyName);
                    break;
                case StorageType.LOCAL_STORAGE:
                    propertyLocal = new Local_1.Local('LocalStorage.' + propertyName);
                    break;
                default:
                    propertyLocal = new Local_1.Local(propertyName);
            }
            ;
            storageMap.set(propertyName, propertyLocal);
        }
        return this.pag.getOrNewNode(-1, propertyLocal);
    }
    /**
     * add PagEdge
     * @param edgeKind: edge kind differs from API
     * @param propertyNode: PAG node created by protpertyName
     * @param obj: heapObj stored with Storage API
     */
    addPropertyLinkEdge(propertyNode, storageObj, cid, stmt, edgeKind, srcNodes) {
        if (!(storageObj.getType() instanceof Type_1.ClassType)) {
            return;
        }
        let objNode = this.pag.getOrNewNode(cid, storageObj);
        if (edgeKind === StorageLinkEdgeType.Property2Local) {
            // propertyNode --> objNode
            this.pag.addPagEdge(propertyNode, objNode, Pag_1.PagEdgeKind.Copy, stmt);
            srcNodes.push(propertyNode.getID());
        }
        else if (edgeKind === StorageLinkEdgeType.Local2Property) {
            // propertyNode <-- objNode
            this.pag.addPagEdge(objNode, propertyNode, Pag_1.PagEdgeKind.Copy, stmt);
            srcNodes.push(objNode.getID());
        }
        else if (edgeKind === StorageLinkEdgeType.TwoWay) {
            // propertyNode <-> objNode
            this.pag.addPagEdge(propertyNode, objNode, Pag_1.PagEdgeKind.Copy, stmt);
            this.pag.addPagEdge(objNode, propertyNode, Pag_1.PagEdgeKind.Copy, stmt);
            srcNodes.push(propertyNode.getID(), objNode.getID());
        }
        return;
    }
    processStorageLink(cs, cid, storageType, srcNodes) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(StorageType.APP_STORAGE, propertyName);
        let leftOp = cs.callStmt.getLeftOp();
        let linkedOpNode = this.pag.getOrNewNode(cid, leftOp);
        if (storageType === StorageType.APP_STORAGE) {
            if (linkedOpNode instanceof Pag_1.PagLocalNode) {
                linkedOpNode.setStorageLink(StorageType.APP_STORAGE, propertyName);
            }
            this.pag.addPagEdge(propertyNode, linkedOpNode, Pag_1.PagEdgeKind.Copy);
            this.pag.addPagEdge(linkedOpNode, propertyNode, Pag_1.PagEdgeKind.Copy);
            srcNodes.push(propertyNode.getID(), linkedOpNode.getID());
        }
        else if (storageType === StorageType.LOCAL_STORAGE) {
            // TODO: WIP
        }
        return;
    }
    processStorageProp(cs, cid, storageType, srcNodes) {
        let propertyStr = this.getPropertyName(cs.args[0]);
        if (!propertyStr) {
            return;
        }
        let propertyName = propertyStr;
        let propertyNode = this.getOrNewPropertyNode(StorageType.APP_STORAGE, propertyName);
        let leftOp = cs.callStmt.getLeftOp();
        let propedOpNode = this.pag.getOrNewNode(cid, leftOp);
        if (storageType === StorageType.APP_STORAGE) {
            if (propedOpNode instanceof Pag_1.PagLocalNode) {
                propedOpNode.setStorageLink(StorageType.APP_STORAGE, propertyName);
            }
            this.pag.addPagEdge(propertyNode, propedOpNode, Pag_1.PagEdgeKind.Copy);
            srcNodes.push(propertyNode.getID());
        }
        else if (storageType === StorageType.LOCAL_STORAGE) {
            // TODO: WIP
        }
        return;
    }
    processStorageSet(cs, cid, storageType, srcNodes) {
        let ivkExpr = cs.callStmt.getInvokeExpr();
        if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            let base = ivkExpr.getBase();
            let baseNode = this.pag.getOrNewNode(cid, base);
            if (baseNode.isStorageLinked()) {
                let argsNode = this.pag.getOrNewNode(cid, cs.args[0]);
                this.pag.addPagEdge(argsNode, baseNode, Pag_1.PagEdgeKind.Copy);
                srcNodes.push(argsNode.getID());
                return;
            }
        }
        else if (ivkExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            // TODO: process AppStorage.set()
        }
        return;
    }
    processStorageGet(cs, cid, storageType, srcNodes) {
        if (!(cs.callStmt instanceof Stmt_1.ArkAssignStmt)) {
            return;
        }
        let leftOp = cs.callStmt.getLeftOp();
        let leftOpNode = this.pag.getOrNewNode(cid, leftOp);
        let ivkExpr = cs.callStmt.getInvokeExpr();
        let propertyName;
        if (ivkExpr instanceof Expr_1.ArkStaticInvokeExpr) {
            let propertyStr = this.getPropertyName(cs.args[0]);
            if (propertyStr) {
                propertyName = propertyStr;
            }
            let propertyNode = this.getOrNewPropertyNode(storageType, propertyName);
            if (!propertyNode) {
                return;
            }
            this.pag.addPagEdge(propertyNode, leftOpNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
            srcNodes.push(propertyNode.getID());
        }
        else if (ivkExpr instanceof Expr_1.ArkInstanceInvokeExpr) {
            let baseNode = this.pag.getOrNewNode(cid, ivkExpr.getBase());
            this.pag.addPagEdge(baseNode, leftOpNode, Pag_1.PagEdgeKind.Copy, cs.callStmt);
            srcNodes.push(baseNode.getID());
        }
        return;
    }
    getPropertyName(value) {
        if (value instanceof Local_1.Local) {
            let type = value.getType();
            if (type instanceof Type_1.StringType) {
                return type.getName();
            }
        }
        else if (value instanceof Constant_1.Constant) {
            return value.getValue();
        }
        return undefined;
    }
}
exports.StoragePlugin = StoragePlugin;
