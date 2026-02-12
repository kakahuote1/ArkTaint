/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
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

import { describe, expect, it } from 'vitest';
import { DependsGraph } from '../../../../src/core/graph/DependsGraph';
import { GraphPrinter } from '../../../../src';

const CASE1_EXPECT = `digraph "DependsGraph" {

\tlabel="DependsGraph";

\tNode0 [shape=recode,shape=box,label="entry"];
\tNode0 -> Node1[color=black]
\tNode0 -> Node2[color=black]
\tNode1 [shape=recode,shape=box,label="ohos"];
\tNode2 [shape=recode,shape=box,label="hms"];
}`;

interface Pkg {
    name: string;
    kind: number;
}

interface EdgeAttr {
    kind: number;
}

describe('DependsGraphTest', () => {
    it('case1: DependsGraph interface', () => {
        let dg = new DependsGraph<Pkg, EdgeAttr>();
        let n0 = dg.addDepsNode('0', { name: 'entry', kind: 0 });
        let n1 = dg.addDepsNode('1', { name: 'ohos', kind: 1 });
        let n2 = dg.addDepsNode('2', { name: 'hms', kind: 1 });

        dg.addEdge(n0, n1, { kind: 0 });
        dg.addEdge(n0, n2, { kind: 0 });

        let printer = new GraphPrinter(dg);
        expect(printer.dump().trim()).eq(CASE1_EXPECT);
    });
});
