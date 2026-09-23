# build_benchmark.ps1
# Compiles all modular categories into the official dataset_benchmark_voz.json

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputDir = "c:\Users\luc14\OneDrive\Documentos\WORK\figocrm\docs\benchmark"
$outputFile = Join-Path $outputDir "dataset_benchmark_voz.json"

if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$scenarios = @()

function Add-Scenario {
    param(
        [string]$id,
        [string]$category,
        [string]$spokenText,
        [hashtable]$context,
        [string]$expectedIntent,
        [hashtable]$expectedEntities,
        [bool]$requiresConfirmation,
        [string]$confirmationPrompt,
        [hashtable]$expectedOutcome
    )
    $script:scenarios += [PSCustomObject]@{
        id = $id
        category = $category
        spoken_text = $spokenText
        context = $context
        expected_intent = $expectedIntent
        expected_entities = $expectedEntities
        requires_confirmation = $requiresConfirmation
        confirmation_prompt = $confirmationPrompt
        expected_financial_outcome = $expectedOutcome
    }
}

Write-Host "Iniciando compilação do dataset de benchmark de voz..." -ForegroundColor Cyan

$categoriesPath = Join-Path $scriptDir "categories"
$catFiles = Get-ChildItem -Path $categoriesPath -Filter "cat*.ps1" | Sort-Object Name

foreach ($file in $catFiles) {
    Write-Host "  -> Carregando $($file.Name)..."
    . $file.FullName
}

Write-Host "`nTotal de cenários carregados: $($scenarios.Count)" -ForegroundColor Green

# Categorias e volumetria
$stats = $scenarios | Group-Object category | Select-Object Name, Count | Sort-Object Name
Write-Host "`nDistribuição por categoria:" -ForegroundColor Yellow
foreach ($stat in $stats) {
    Write-Host ("  - {0,-35}: {1} cenários" -f $stat.Name, $stat.Count)
}

# Converter para JSON estruturado
$jsonContent = $scenarios | ConvertTo-Json -Depth 15

# Gravar em UTF8 sem BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputFile, $jsonContent, $utf8NoBom)

Write-Host "`nArquivo gerado com sucesso:" -ForegroundColor Green
Write-Host "  Path: $outputFile"
Write-Host "  Tamanho: $([math]::Round((Get-Item $outputFile).Length / 1KB, 2)) KB"
