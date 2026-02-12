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

export const Stmt_Metadata_Expected = {
    stmts: [{
        text: 'this = this: @metadata/MetadataTest.ts: %dflt',
        leadingComments: [],
        trailingComments: [],
    },
        {
            text: 'a = 1',
            leadingComments: [
                {
                    'content': '/*\n * Copyright (c) 2024 Huawei Device Co., Ltd.\n * Licensed under the Apache License, Version 2.0 (the "License");\n * you may not use this file except in compliance with the License.\n * You may obtain a copy of the License at\n *\n *     http://www.apache.org/licenses/LICENSE-2.0\n *\n * Unless required by applicable law or agreed to in writing, software\n * distributed under the License is distributed on an "AS IS" BASIS,\n * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n * See the License for the specific language governing permissions and\n * limitations under the License.\n */',
                    'position': [
                        1,
                        1,
                        14,
                        4,
                    ],
                },
                {
                    'content': '// single line head comment',
                    'position': [
                        16,
                        1,
                        16,
                        28,
                    ],
                },
            ],
            trailingComments: [],
        },
        {
            text: 'b = 2',
            leadingComments: [
                {
                    'content': '// single line head comment 1',
                    'position': [
                        19,
                        1,
                        19,
                        30,
                    ],
                },
                {
                    'content': '// single line head comment 2',
                    'position': [
                        20,
                        1,
                        20,
                        30,
                    ],
                },
            ],
            trailingComments: [],
        },
        {
            text: 'c = 4',
            leadingComments: [
                {
                    'content': '/* multiple line head comment 1\n*  multiple line head comment 2\n*/',
                    'position': [
                        23,
                        1,
                        25,
                        3,
                    ],
                },
            ],
            trailingComments: [],
        },
        {
            text: 'd = 5',
            leadingComments: [
                {
                    'content': '// single line head comment 3',
                    'position': [
                        28,
                        1,
                        28,
                        30,
                    ],
                },
            ],
            trailingComments: [
                {
                    'content': '// single line tail comment',
                    'position': [
                        29,
                        12,
                        29,
                        39,
                    ],
                },
            ],
        },
        {
            text: 'e = 6',
            leadingComments: [],
            trailingComments: [
                {
                    'content': '/* multiple line tail comment 1\n*  multiple line tail comment 2\n*/',
                    'position': [
                        31,
                        12,
                        33,
                        3,
                    ],
                },
            ],
        },
        {
            text: 'return',
            leadingComments: [],
            trailingComments: [],
        }],
};