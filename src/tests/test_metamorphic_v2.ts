import {
    runMetamorphicSuite,
    TransformOutput,
    TransformSpec,
} from "./metamorphic/MetamorphicHarness";

const transforms: TransformSpec[] = [
    {
        name: "split_assignment",
        apply(sourceCode: string): TransformOutput {
            const assignmentPattern = /let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*taint_src\s*;/;
            const m = sourceCode.match(assignmentPattern);
            if (!m || m.index === undefined) {
                return { code: sourceCode, changed: false };
            }

            const varName = m[1];
            const replacement = `let __meta_split = taint_src;\n  let ${varName} = __meta_split;`;
            const code = sourceCode.replace(assignmentPattern, replacement);
            return { code, changed: code !== sourceCode };
        },
    },
    {
        name: "equiv_sink_branch",
        apply(sourceCode: string): TransformOutput {
            const sinkPattern = /taint\.Sink\(([^)]+)\);/;
            const sinkMatch = sourceCode.match(sinkPattern);
            if (!sinkMatch) {
                return { code: sourceCode, changed: false };
            }

            const argExpr = sinkMatch[1].trim();
            const replacement = [
                "if (1 === 1) {",
                `    taint.Sink(${argExpr});`,
                "  } else {",
                `    taint.Sink(${argExpr});`,
                "  }",
            ].join("\n  ");
            const code = sourceCode.replace(sinkPattern, replacement);
            return { code, changed: code !== sourceCode };
        },
    },
];

runMetamorphicSuite({
    defaults: {
        manifestPath: "tests/manifests/metamorphic_seed_v2.list",
        sourceDir: "tests/demo/metamorphic_seed_v2",
        tempProjectDir: "tmp/phase42_v2/metamorphic_project",
        reportPath: "tmp/phase42_v2/metamorphic_report.json",
        k: 1,
    },
    transforms,
    variantTag: "m",
}).catch(err => {
    console.error(err);
    process.exitCode = 1;
});
