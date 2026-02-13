import {
    runMetamorphicSuite,
    TransformOutput,
    TransformSpec,
} from "./metamorphic/MetamorphicHarness";

const transforms: TransformSpec[] = [
    {
        name: "noop",
        apply(sourceCode: string): TransformOutput {
            const functionHeader = /export function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{\s*/m;
            const m = sourceCode.match(functionHeader);
            if (!m || m.index === undefined) {
                return { code: sourceCode, changed: false };
            }

            const insertPos = m.index + m[0].length;
            const code = sourceCode.slice(0, insertPos)
                + "\n  let __meta_noop = 0;\n  __meta_noop = __meta_noop + 1;\n"
                + sourceCode.slice(insertPos);
            return { code, changed: code !== sourceCode };
        },
    },
    {
        name: "rename_taint_src",
        apply(sourceCode: string): TransformOutput {
            const code = sourceCode.replace(/\btaint_src\b/g, "taint_src_meta");
            return { code, changed: code !== sourceCode };
        },
    },
];

runMetamorphicSuite({
    defaults: {
        manifestPath: "tests/manifests/metamorphic_seed.list",
        sourceDir: "tests/demo/senior_full",
        tempProjectDir: "tmp/phase42/metamorphic_project",
        reportPath: "tmp/phase42/metamorphic_report.json",
        k: 1,
    },
    transforms,
    variantTag: "m",
}).catch(err => {
    console.error(err);
    process.exitCode = 1;
});
