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
exports.DiffPTData = exports.PtsCollectionType = exports.PtsBV = exports.PtsSet = exports.createPtsCollectionCtor = void 0;
const SparseBitVector_1 = require("../../utils/SparseBitVector");
/*
 * Return PtsSet or PtsBV 's constructor by input type
 */
function createPtsCollectionCtor(type) {
    if (type === PtsCollectionType.Set) {
        return PtsSet;
    }
    else if (type === PtsCollectionType.BitVector) {
        return PtsBV;
    }
    throw new Error(`Unsupported pts collection type: ${type}`);
}
exports.createPtsCollectionCtor = createPtsCollectionCtor;
/*
 * A simple set to store pts data
 */
class PtsSet {
    constructor() {
        this.pts = new Set();
    }
    contains(elem) {
        return this.pts.has(elem);
    }
    insert(elem) {
        if (this.pts.has(elem)) {
            return false;
        }
        this.pts.add(elem);
        return true;
    }
    remove(elem) {
        if (!this.pts.has(elem)) {
            return false;
        }
        this.pts.delete(elem);
        return true;
    }
    clone() {
        let clonedSet = new PtsSet();
        clonedSet.pts = new Set(this.pts);
        // TODO: need validate
        return clonedSet;
    }
    union(other) {
        let changed = false;
        for (const elem of other.pts) {
            changed = this.insert(elem) || changed;
        }
        return changed;
    }
    subtract(other) {
        let changed = false;
        for (const elem of other.pts) {
            changed = this.remove(elem) || changed;
        }
        return changed;
    }
    clear() {
        this.pts.clear();
    }
    count() {
        return this.pts.size;
    }
    isEmpty() {
        return this.pts.size === 0;
    }
    // If current collection is a super set of other
    superset(other) {
        for (const elem of other.pts) {
            if (!this.pts.has(elem)) {
                return false;
            }
        }
        return true;
    }
    // If current collection is intersect with other
    intersect(other) {
        for (const elem of other.pts) {
            if (this.pts.has(elem)) {
                return true;
            }
        }
        return false;
    }
    getProtoPtsSet() {
        return this.pts;
    }
    [Symbol.iterator]() {
        return this.pts[Symbol.iterator]();
    }
}
exports.PtsSet = PtsSet;
class PtsBV {
    constructor() {
        this.pts = new SparseBitVector_1.SparseBitVector();
    }
    contains(elem) {
        return this.pts.test(elem);
    }
    insert(elem) {
        this.pts.set(elem);
        return true;
    }
    remove(elem) {
        this.pts.reset(elem);
        return true;
    }
    clone() {
        let cloned = new PtsBV();
        cloned.pts = this.pts.clone();
        return cloned;
    }
    union(other) {
        return this.pts.unionWith(other.pts);
    }
    subtract(other) {
        return this.pts.subtractWith(other.pts);
    }
    clear() {
        this.pts.clear();
    }
    count() {
        return this.pts.count();
    }
    isEmpty() {
        return this.pts.isEmpty();
    }
    // If current collection is a super set of other
    superset(other) {
        for (const elem of other.pts) {
            if (!this.pts.test(elem)) {
                return false;
            }
        }
        return true;
    }
    // If current collection is intersect with other
    intersect(other) {
        for (const elem of other.pts) {
            if (this.pts.test(elem)) {
                return true;
            }
        }
        return false;
    }
    getProtoPtsSet() {
        return this.pts;
    }
    [Symbol.iterator]() {
        return this.pts[Symbol.iterator]();
    }
}
exports.PtsBV = PtsBV;
var PtsCollectionType;
(function (PtsCollectionType) {
    PtsCollectionType[PtsCollectionType["Set"] = 0] = "Set";
    PtsCollectionType[PtsCollectionType["BitVector"] = 1] = "BitVector";
})(PtsCollectionType = exports.PtsCollectionType || (exports.PtsCollectionType = {}));
class DiffPTData {
    constructor(DSCreator) {
        this.DSCreator = DSCreator;
        this.diffPtsMap = new Map();
        this.propaPtsMap = new Map();
    }
    clear() {
        this.diffPtsMap.clear();
        this.propaPtsMap.clear();
    }
    addPts(v, elem) {
        let propa = this.propaPtsMap.get(v);
        if (propa && propa.contains(elem)) {
            return false;
        }
        let diff = this.diffPtsMap.get(v) || new this.DSCreator();
        this.diffPtsMap.set(v, diff);
        return diff.insert(elem);
    }
    resetElem(v) {
        let propa = this.propaPtsMap.get(v);
        if (propa) {
            this.diffPtsMap.set(v, propa.clone());
            return true;
        }
        return false;
    }
    unionDiffPts(dstv, srcv) {
        if (dstv === srcv) {
            return false;
        }
        let changed = false;
        let diff = this.diffPtsMap.get(srcv);
        if (diff) {
            let srcDs = diff.clone();
            changed = this.unionPtsTo(dstv, srcDs);
        }
        return changed;
    }
    unionPts(dstv, srcv) {
        if (dstv === srcv) {
            return false;
        }
        let changed = false;
        let diff = this.diffPtsMap.get(srcv);
        if (diff) {
            let srcDs = diff.clone();
            changed = this.unionPtsTo(dstv, srcDs);
        }
        let propa = this.propaPtsMap.get(srcv);
        if (propa) {
            let srcDs = propa.clone();
            changed = this.unionPtsTo(dstv, srcDs) || changed;
        }
        return changed;
    }
    unionPtsTo(dstv, srcDs) {
        let diff = this.diffPtsMap.get(dstv) || new this.DSCreator();
        let propa = this.propaPtsMap.get(dstv) || new this.DSCreator();
        let newSet = srcDs.clone();
        newSet.subtract(propa);
        let changed = diff.union(newSet);
        this.diffPtsMap.set(dstv, diff);
        return changed;
    }
    removePtsElem(v, elem) {
        var _a, _b, _c, _d;
        let removedFromDiff = (_b = (_a = this.diffPtsMap.get(v)) === null || _a === void 0 ? void 0 : _a.remove(elem)) !== null && _b !== void 0 ? _b : false;
        let removedFromPropa = (_d = (_c = this.propaPtsMap.get(v)) === null || _c === void 0 ? void 0 : _c.remove(elem)) !== null && _d !== void 0 ? _d : false;
        return removedFromDiff || removedFromPropa;
    }
    getDiffPts(v) {
        return this.diffPtsMap.get(v);
    }
    getMutDiffPts(v) {
        if (!this.diffPtsMap.has(v)) {
            this.diffPtsMap.set(v, new this.DSCreator());
        }
        return this.diffPtsMap.get(v);
    }
    getPropaPts(v) {
        return this.propaPtsMap.get(v);
    }
    getAllPropaPts() {
        return this.propaPtsMap;
    }
    getPropaPtsMut(v) {
        if (!this.propaPtsMap.has(v)) {
            this.propaPtsMap.set(v, new this.DSCreator());
        }
        return this.propaPtsMap.get(v);
    }
    flush(v) {
        if (!this.diffPtsMap.has(v)) {
            return;
        }
        let diff = this.diffPtsMap.get(v);
        let propa = this.getPropaPtsMut(v);
        // do not clear origin propa, only copy the pt and add it to diff
        propa.union(diff);
        diff.clear();
    }
    clearPts(v) {
        let diff = this.diffPtsMap.get(v);
        if (diff) {
            diff.clear();
        }
        let propa = this.propaPtsMap.get(v);
        if (propa) {
            propa.clear();
        }
    }
    clearDiffPts(v) {
        let diff = this.diffPtsMap.get(v);
        if (diff) {
            diff.clear();
        }
    }
    clearPropaPts(v) {
        let propa = this.propaPtsMap.get(v);
        if (propa) {
            propa.clear();
        }
    }
    calculateDiff(src, dst) {
        let srcDiff = this.diffPtsMap.get(src);
        let dstPropa = this.propaPtsMap.get(dst);
        if (!dstPropa) {
            return srcDiff.clone();
        }
        let result = srcDiff.clone();
        result.subtract(dstPropa);
        return result;
    }
}
exports.DiffPTData = DiffPTData;
