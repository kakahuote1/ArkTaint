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

export const HelloComponent_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['message']
        }
    ]
}

export const HelloChildComponent_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['message']
        }
    ]
}

export const HelloGrandsonComponent_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['message']
        }
    ]
}

export const GrandsonBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Text', children: []
                },
                {
                    name: 'View',
                    children: [
                        HelloGrandsonComponent_Expect_ViewTree
                    ]
                }
            ]
        }
    ]
}

export const ChildBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Text',
                    children: []
                },
                {
                    name: 'View',
                    children: [HelloChildComponent_Expect_ViewTree]
                },
                {
                    name: 'Builder',
                    children: [
                        GrandsonBuilder_Expect_ViewTree
                    ]
                }
            ]
        }
    ]
}

export const ParentBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Text',
                    children: []
                },
                {
                    name: 'View',
                    children: [HelloComponent_Expect_ViewTree]
                },
                {
                    name: 'Builder',
                    children: [
                        ChildBuilder_Expect_ViewTree
                    ]
                }
            ]
        }
    ]
}

export const BuilderTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [ParentBuilder_Expect_ViewTree],
            stateValues: ['label']
        },
        {
            name: 'Button',
            children: [],
            stateValues: ['label']
        }
    ]
}

export const Case1_OverBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: []
        }
    ]
}

export const Case1_BuilderTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [
                {
                    name: 'View',
                    children: [
                        {
                            name: 'Row',
                            children: [
                                {
                                    name: 'Text',
                                    children: [],
                                    stateValues: ['bundleName'],
                                },
                                {
                                    name: 'Text',
                                    children: [],
                                    stateValues: []
                                },
                            ],
                            stateValues: [],
                        },
                    ],
                    stateValues: ['bundleName', 'height', 'lastAppInfo'],
                },
            ],
        },
        {
            name: 'Builder',
            children: [Case1_OverBuilder_Expect_ViewTree],
            stateValues: ['label']
        },
        {
            name: 'Button',
            children: [],
            stateValues: ['label'],
        },
    ],
    stateValues: ['scale', 'animateScale'],
    total: ['label', 'height', 'bundleName', 'scale', 'lastAppInfo', 'animateScale']
};

export const Case2_HelloComponent_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['message']
        }
    ]
}

export const Case2_OverBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Column',
            children: [
                {
                    name: 'Text',
                    children: []
                },
                {
                    name: 'View',
                    children: [Case2_HelloComponent_Expect_ViewTree]
                }

            ]
        }
    ]
}

export const Case2_BuilderTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [Case2_OverBuilder_Expect_ViewTree],
            stateValues: ['label']
        },
        {
            name: 'Button',
            children: [],
            stateValues: ['label'],
        },
    ],
    total: ['label']
};

export const Case3_OverBuilder_Expect_ViewTree = {
    name: 'Row',
    children: [
        {
            name: 'Text',
            children: []
        }
    ]
}

export const Case3_BuilderTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Builder',
            children: [Case3_OverBuilder_Expect_ViewTree],
            stateValues: ['label']
        },
    ],
    total: ['label']
};

export const Case_moreRootBuilderTest_Expect_ViewTree = {
    name: 'Builder',
    children: [
        {
            name: 'Column',
            children: []
        },
        {
            name: 'Column',
            children: []
        }
    ]
}
export const WaterFlowTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'WaterFlow',
            children: [
                {
                    name: 'Builder',
                    children: [
                        {
                            name: 'Text',
                            children: [],
                        },
                    ],
                },
            ],
        },
    ],
};

export const Case_ComplexStateValueTest_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'View',
            children: [
                {
                    name: 'Column',
                    children: [
                        {
                            name: 'Text',
                            children: [],
                            stateValues: ['data']
                        },
                        {
                            name: 'Text',
                            children: [],
                            stateValues: ['index']
                        }
                    ]
                }
            ],
            stateValues: ['arrayData', 'viewData', 'n']
        }
    ]
}
