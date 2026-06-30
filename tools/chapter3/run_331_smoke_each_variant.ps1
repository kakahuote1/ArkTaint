param(
  [string]$Profile = "deepseek-v4-pro",
  [string]$OutputRoot = "internal_docs\reports\chapter3_experiment_artifacts\final\runs\33_llm_asset_generation\evidence_ablation_331\smoke_each_variant_dsv4",
  [switch]$Execute
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

$cases = @(
  @{ Variant = "L0_NAME_SIGNATURE_ONLY"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L1_IDENTITY_ONLY"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L2_NO_CALLSITE"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L3_NO_METHOD_SNIPPET"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L4_NO_COMPANION"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L5_NO_EXACT_IDENTITY"; Sample = "SF331-RULE-SOURCE-001" },
  @{ Variant = "L6_NO_OFFICIAL_ENTRY_EVIDENCE"; Sample = "SF331-ARKMAIN-001" },
  @{ Variant = "L7_FULL_SLICE"; Sample = "SF331-RULE-SOURCE-001" }
)

foreach ($case in $cases) {
  $outDir = Join-Path $OutputRoot $case.Variant
  $args = @(
    "tools\chapter3\run_331_evidence_ablation_llm_eval.js",
    "--limit", "1",
    "--sampleId", $case.Sample,
    "--variantId", $case.Variant,
    "--llmProfile", $Profile,
    "--outputDir", $outDir
  )
  if ($Execute) {
    $args = @("tools\chapter3\run_331_evidence_ablation_llm_eval.js", "--execute") + $args[1..($args.Count - 1)]
  }
  Write-Host "331 smoke variant=$($case.Variant) sample=$($case.Sample) execute=$($Execute.IsPresent) out=$outDir"
  & node @args
}
