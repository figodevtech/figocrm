# validate_benchmark.ps1
# Automated validation of dataset_benchmark_voz.json

$ErrorActionPreference = "Stop"

$jsonPath = "c:\Users\luc14\OneDrive\Documentos\WORK\figocrm\docs\benchmark\dataset_benchmark_voz.json"

if (!(Test-Path $jsonPath)) {
    Write-Error "Arquivo de benchmark não encontrado em: $jsonPath"
    exit 1
}

Write-Host "Iniciando validação do dataset de benchmark..." -ForegroundColor Cyan

# 1. Carregar e verificar parse do JSON
try {
    $rawContent = [System.IO.File]::ReadAllText($jsonPath, [System.Text.Encoding]::UTF8)
    $dataset = $rawContent | ConvertFrom-Json
} catch {
    Write-Error "Falha crítica de parse do JSON: $_"
    exit 1
}

$total = $dataset.Count
Write-Host "Total de cenários carregados: $total"

if ($total -lt 150) {
    Write-Error "Requisito mínimo de 150 cenários não atingido. Total atual: $total"
    exit 1
}

# 2. Verificação de unicidade de IDs
$ids = $dataset | ForEach-Object { $_.id }
$duplicateIds = $ids | Group-Object | Where-Object { $_.Count -gt 1 }

if ($duplicateIds) {
    Write-Error "IDs duplicados encontrados: $($duplicateIds.Name -join ', ')"
    exit 1
}
Write-Host "Todos os $total IDs são estritamente únicos." -ForegroundColor Green

# 3. Validação dos campos obrigatórios em cada cenário
$errors = @()
$categories = @{}
$confirmationCount = 0

for ($i = 0; $i -lt $dataset.Count; $i++) {
    $item = $dataset[$i]

    if ([string]::IsNullOrWhiteSpace($item.id)) {
        $errors += "Índice $($i): 'id' está vazio."
    }
    if ([string]::IsNullOrWhiteSpace($item.category)) {
        $errors += "ID $($item.id): 'category' está vazia."
    } else {
        $cat = $item.category
        if (-not $categories.ContainsKey($cat)) { $categories[$cat] = 0 }
        $categories[$cat]++
    }
    if ([string]::IsNullOrWhiteSpace($item.spoken_text)) {
        $errors += "ID $($item.id): 'spoken_text' está vazio."
    }
    if ([string]::IsNullOrWhiteSpace($item.expected_intent)) {
        $errors += "ID $($item.id): 'expected_intent' está vazio."
    }
    if ($item.requires_confirmation -eq $true) {
        $confirmationCount++
        if ([string]::IsNullOrWhiteSpace($item.confirmation_prompt)) {
            $errors += "ID $($item.id): 'requires_confirmation' é verdadeiro, mas 'confirmation_prompt' está vazio."
        }
    }
    if ($null -eq $item.expected_financial_outcome) {
        $errors += "ID $($item.id): 'expected_financial_outcome' está ausente."
    }
}

if ($errors.Count -gt 0) {
    Write-Error "Erros de integridade encontrados ($($errors.Count)):"
    $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "Todos os cenários contêm os campos obrigatórios." -ForegroundColor Green
Write-Host "Cenários com solicitação de confirmação / ambiguidade: $confirmationCount" -ForegroundColor Yellow

# 4. Exibir resumo das categorias
Write-Host "`nResumo de Cobertura por Categoria:" -ForegroundColor Cyan
foreach ($cat in ($categories.Keys | Sort-Object)) {
    Write-Host ("  {0,-35}: {1} casos de teste" -f $cat, $categories[$cat])
}

Write-Host "`nValidação concluída com 100% de sucesso!" -ForegroundColor Green
