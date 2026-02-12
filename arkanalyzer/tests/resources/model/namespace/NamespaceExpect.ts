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

export const Namespaces_With_The_Same_Name = [
    {
        namespaceName: 'NamespaceA',
        namespaceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA',
        declaringNamespaceSignature: null,
        declaringInstanceSignature: '@namespace/NamespacesWithTheSameName.ts: ',
        linCols: [
            [16, 1],
            [31, 1],
        ],
        classes: [
            {
                className: 'ClassA',
                classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.ClassA',
            },
            {
                className: 'ClassB',
                classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.ClassB',
            },
            {
                className: '%dflt',
                classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.%dflt',
            },
        ],
        nestedNamespaces: [
            {
                namespaceName: 'NamespaceB',
                namespaceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceB',
                declaringNamespaceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA',
                declaringInstanceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA',
                linCols: [
                    [20, 5],
                    [35, 5],
                    [40, 5],
                ],
                classes: [
                    {
                        className: 'ClassC',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceB.ClassC',
                    },
                    {
                        className: 'ClassD',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceB.ClassD',
                    },
                    {
                        className: 'ClassE',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceB.ClassE',
                    },
                    {
                        className: '%dflt',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceB.%dflt',
                    },
                ],
                nestedNamespaces: [],
            },
            {
                namespaceName: 'NamespaceC',
                namespaceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceC',
                declaringNamespaceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA',
                declaringInstanceSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA',
                linCols: [
                    [25, 5],
                ],
                classes: [
                    {
                        className: 'ClassF',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceC.ClassF',
                    },
                    {
                        className: '%dflt',
                        classSignature: '@namespace/NamespacesWithTheSameName.ts: NamespaceA.NamespaceC.%dflt',
                    },
                ],
                nestedNamespaces: [],
            },
        ],
    },
];

export const Basic_Namespace_Nested = {
    namespaceName: 'A',
    namespaceSignature: '@namespace/Namespaces.ts: A',
    declaringNamespaceSignature: null,
    declaringInstanceSignature: '@namespace/Namespaces.ts: ',
    linCols: [
        [16, 1],
    ],
    classes: [
        {
            className: '%dflt',
            classSignature: '@namespace/Namespaces.ts: A.%dflt',
        },
    ],
    nestedNamespaces: [
        {
            namespaceName: 'B',
            namespaceSignature: '@namespace/Namespaces.ts: A.B',
            declaringNamespaceSignature: '@namespace/Namespaces.ts: A',
            declaringInstanceSignature: '@namespace/Namespaces.ts: A',
            linCols: [
                [17, 5],
            ],
            classes: [
                {
                    className: 'X',
                    classSignature: '@namespace/Namespaces.ts: A.B.X',
                },
                {
                    className: '%dflt',
                    classSignature: '@namespace/Namespaces.ts: A.B.%dflt',
                },
            ],
            nestedNamespaces: [],
        },
    ]
};

export const Continuous_Namespace_Nested = {
    namespaceName: 'Foo',
    namespaceSignature: '@namespace/Namespaces.ts: Foo',
    declaringNamespaceSignature: null,
    declaringInstanceSignature: '@namespace/Namespaces.ts: ',
    linCols: [
        [22, 1],
    ],
    classes: [
        {
            className: '%dflt',
            classSignature: '@namespace/Namespaces.ts: Foo.%dflt',
        },
    ],
    nestedNamespaces: [
        {
            namespaceName: 'Bar',
            namespaceSignature: '@namespace/Namespaces.ts: Foo.Bar',
            declaringNamespaceSignature: '@namespace/Namespaces.ts: Foo',
            declaringInstanceSignature: '@namespace/Namespaces.ts: Foo',
            linCols: [
                [22, 15],
            ],
            classes: [
                {
                    className: '%dflt',
                    classSignature: '@namespace/Namespaces.ts: Foo.Bar.%dflt',
                },
            ],
            nestedNamespaces: [
                {
                    namespaceName: 'Baz',
                    namespaceSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz',
                    declaringNamespaceSignature: '@namespace/Namespaces.ts: Foo.Bar',
                    declaringInstanceSignature: '@namespace/Namespaces.ts: Foo.Bar',
                    linCols: [
                        [23, 5],
                    ],
                    classes: [
                        {
                            className: '%dflt',
                            classSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz.%dflt',
                        },
                    ],
                    nestedNamespaces: [
                        {
                            namespaceName: 'Bas',
                            namespaceSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz.Bas',
                            declaringNamespaceSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz',
                            declaringInstanceSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz',
                            linCols: [
                                [23, 19],
                            ],
                            classes: [
                                {
                                    className: '%dflt',
                                    classSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz.Bas.%dflt',
                                },
                                {
                                    className: 'X',
                                    classSignature: '@namespace/Namespaces.ts: Foo.Bar.Baz.Bas.X',
                                },
                            ],
                            nestedNamespaces: [],
                        },
                    ],
                },
            ],
        },
    ]
};

export const Continuous_Namespace_Nested_With_The_Same_Name = {
    namespaceName: 'C',
    namespaceSignature: '@namespace/Namespaces.ts: C',
    declaringNamespaceSignature: null,
    declaringInstanceSignature: '@namespace/Namespaces.ts: ',
    linCols: [
        [28, 1],
        [38, 1],
    ],
    classes: [
        {
            className: '%dflt',
            classSignature: '@namespace/Namespaces.ts: C.%dflt',
        },
    ],
    nestedNamespaces: [
        {
            namespaceName: 'Baz',
            namespaceSignature: '@namespace/Namespaces.ts: C.Baz',
            declaringNamespaceSignature: '@namespace/Namespaces.ts: C',
            declaringInstanceSignature: '@namespace/Namespaces.ts: C',
            linCols: [
                [29, 5],
                [33, 5],
                [39, 5],
            ],
            classes: [
                {
                    className: '%dflt',
                    classSignature: '@namespace/Namespaces.ts: C.Baz.%dflt',
                },
                {
                    className: 'Z',
                    classSignature: '@namespace/Namespaces.ts: C.Baz.Z',
                },
            ],
            nestedNamespaces: [
                {
                    namespaceName: 'Bas',
                    namespaceSignature: '@namespace/Namespaces.ts: C.Baz.Bas',
                    declaringNamespaceSignature: '@namespace/Namespaces.ts: C.Baz',
                    declaringInstanceSignature: '@namespace/Namespaces.ts: C.Baz',
                    linCols: [
                        [29, 19],
                        [33, 19],
                    ],
                    classes: [
                        {
                            className: '%dflt',
                            classSignature: '@namespace/Namespaces.ts: C.Baz.Bas.%dflt',
                        },
                        {
                            className: 'X',
                            classSignature: '@namespace/Namespaces.ts: C.Baz.Bas.X',
                        },
                        {
                            className: 'Y',
                            classSignature: '@namespace/Namespaces.ts: C.Baz.Bas.Y',
                        },
                    ],
                    nestedNamespaces: [],
                },
            ],
        },
    ]
};