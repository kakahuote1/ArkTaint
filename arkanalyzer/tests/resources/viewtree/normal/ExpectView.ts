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

export const SubComponent_Expect_ViewTree: any = {
    name: 'Column',
    children: [
        {
            name: 'Text',
            children: []
        }
    ]
}

export const CommonTest_Expect_ViewTree = {
    name: 'View',
    children: [
        SubComponent_Expect_ViewTree
    ],
    attributes: ['create', 'pop', 'width', 'height']
}

export const ControlCenterComplexToggleLayout_Expect_ViewTree = {
    name: 'Grid',
    children: [
        {
            name: 'ForEach',
            children: [
                {
                    name: 'GridItem',
                    children: []
                }
            ],
            stateValues: ['mComplexToggleLayout']
        }
    ],
    stateValues: ['mComplexToggleLayout', 'style']
}

export const CountDownComponent_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'If',
            children: [
                {
                    name: 'IfBranch',
                    children: [
                        { name: 'Text', children: [], stateValues: ['count'] }
                    ]
                },
                {
                    name: 'IfBranch',
                    children: [
                        { name: 'Text', children: [] }
                    ]
                }
            ],
            stateValues: ['count']
        },
        {
            name: 'Button',
            children: [
                { name: 'Text', children: [] }
            ],
            stateValues: ['count']
        }
    ]
}

export const ParentComponent_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['countDownStartValue']
        },
        {
            name: 'Button',
            children: [
                {
                    name: 'Text',
                    children: []
                }
            ],
            stateValues: ['countDownStartValue']
        },
        {
            name: 'Button',
            children: [
                {
                    name: 'Text',
                    children: []
                }
            ],
            stateValues: ['countDownStartValue']
        },
        {
            name: 'View',
            children: [
                CountDownComponent_Expect_ViewTree
            ],
            stateValues: ['countDownStartValue']
        }

    ]
}

export const ControlCenterSimpleToggleLayout_Expect_ViewTree = {
    name: 'Grid',
    children: [
        {
            name: 'ForEach',
            children: [
                {
                    name: 'GridItem',
                    children: [
                    ]
                }
            ],
            stateValues: ['mSimpleToggleLayout']
        }
    ],
    stateValues: ['mSimpleToggleLayout', 'mColumnCount', 'style']
}

export const ControlCenterComponent_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'If',
            children: [
                {
                    name: 'IfBranch',
                    children: [
                        {
                            name: 'Column',
                            children: [
                                {
                                    name: 'Column',
                                    children: [],
                                    stateValues: ['style']
                                },
                                {
                                    name: 'Row',
                                    children: [
                                        {
                                            name: 'Column',
                                            children: [
                                                {
                                                    name: 'View',
                                                    children: [ControlCenterComplexToggleLayout_Expect_ViewTree]
                                                },
                                                {
                                                    name: 'Column',
                                                    children: [
                                                        {
                                                            name: 'View',
                                                            children: [ControlCenterSimpleToggleLayout_Expect_ViewTree],
                                                            stateValues: ['mSimpleToggleColumnCount']
                                                        },
                                                        {
                                                            name: 'Column',
                                                            children: [],
                                                            stateValues: ['style']
                                                        }
                                                    ],
                                                    stateValues: ['style']
                                                }
                                            ],
                                            stateValues: ['style']
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    name: 'IfBranch',
                    children: [
                        {
                            name: 'Column',
                            children: []
                        }
                    ]
                }
            ],
            stateValues: ['mIsEditSimpleToggleLayout']
        }
    ]
}

export const NotificationItem_Expect_ViewTree = {
    name: 'Column',
    children: [

    ]
}

export const SelfDepends_Expect_ViewTree = {
    name: 'Column',
    children: [
        {
            name: 'Text',
            children: [],
            stateValues: ['item']
        },
        {
            name: 'WaterFlow',
            children: [
                {
                    name: 'LazyForEach',
                    children: [
                        {
                            name: 'FlowItem',
                            children: [
                                {
                                    name: 'View',
                                    children: [],
                                    skip: true
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}