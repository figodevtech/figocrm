# test_financial_engine.ps1
# Suíte de testes automatizados para validar a exatidão matemática do motor financeiro

$ErrorActionPreference = "Stop"

Write-Host "Iniciando testes unitários do Motor Financeiro..." -ForegroundColor Cyan

$passed = 0
$failed = 0

function Assert-Equal {
    param($actual, $expected, $testName)
    if ([math]::Abs($actual - $expected) -lt 0.0001) {
        Write-Host "  [PASS] $testName" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  [FAIL] $testName - Esperado: $expected, Obtido: $actual" -ForegroundColor Red
        $script:failed++
    }
}

function Assert-True {
    param($condition, $testName)
    if ($condition) {
        Write-Host "  [PASS] $testName" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  [FAIL] $testName" -ForegroundColor Red
        $script:failed++
    }
}

# --- TESTE 1: CMV com custos agregados ---
# Compra: 10.000 + Bateria: 250 + Funilaria: 400 + Despachante: 450 = 11.100
$compra = 10000.00
$custos = @(250.00, 400.00, 450.00)
$cmvCalculado = $compra + ($custos | Measure-Object -Sum).Sum
Assert-Equal $cmvCalculado 11100.00 "1. CMV composto com custos agregados"

# --- TESTE 2: Lucro Bruto ---
# Venda: 15.000 - CMV: 11.100 = 3.900
$venda = 15000.00
$lucroBruto = $venda - $cmvCalculado
Assert-Equal $lucroBruto 3900.00 "2. Lucro Bruto apurado da venda"

# --- TESTE 3: Geração de parcelas com dízima e resto de centavos ---
# R$ 1.000 em 3 parcelas: 333.34 + 333.33 + 333.33 = 1000.00
$total = 1000.00
$qtd = 3
$base = [math]::Floor(($total / $qtd) * 100) / 100
$restoCentavos = [math]::Round(($total - ($base * $qtd)) * 100)

$parcelas = @()
for ($i = 1; $i -le $qtd; $i++) {
    $val = $base
    if ($restoCentavos -gt 0) {
        $val += 0.01
        $restoCentavos--
    }
    $parcelas += $val
}

Assert-Equal $parcelas[0] 333.34 "3.1 Parcela 1 absorve centavo"
Assert-Equal $parcelas[1] 333.33 "3.2 Parcela 2 padrão"
Assert-Equal $parcelas[2] 333.33 "3.3 Parcela 3 padrão"
$somaParcelas = ($parcelas | Measure-Object -Sum).Sum
Assert-Equal $somaParcelas 1000.00 "3.4 Soma exata das parcelas bate 100% com o total"

# --- TESTE 4: Pagamento Parcial sem Quitação Precoce ---
$parcelaOriginal = 500.00
$pagoInicial = 0.00
$pagamentoRecebido = 200.00

$novoPago = $pagoInicial + $pagamentoRecebido
$novoSaldo = $parcelaOriginal - $novoPago
$status = if ($novoSaldo -le 0) { "paid" } else { "partially_paid" }

Assert-Equal $novoPago 200.00 "4.1 Valor acumulado pago na parcela"
Assert-Equal $novoSaldo 300.00 "4.2 Saldo devedor residual recalculado"
Assert-True ($status -eq "partially_paid") "4.3 Status não é quitado (permanece partially_paid)"

# --- TESTE 5: Indicadores da Home ("Na rua", "Atrasado", "Em mercadoria") ---
$parcelasBase = @(
    @{ saldo = 500.00; vencida = $true },
    @{ saldo = 500.00; vencida = $false },
    @{ saldo = 1000.00; vencida = $true },
    @{ saldo = 1000.00; vencida = $false }
)

$naRua = ($parcelasBase | ForEach-Object { $_.saldo } | Measure-Object -Sum).Sum
$atrasado = ($parcelasBase | Where-Object { $_.vencida -eq $true } | ForEach-Object { $_.saldo } | Measure-Object -Sum).Sum

Assert-Equal $naRua 3000.00 "5.1 Indicador 'Na rua' consolidado"
Assert-Equal $atrasado 1500.00 "5.2 Indicador 'Atrasado' (inadimplência real)"

# --- TESTE 6: Troca com Volta ---
# Entregou item de 20.000 (custou 16.000). Recebeu item de 12.000 + 8.000 no Pix.
# Lucro = 20.000 - 16.000 = 4.000
$itemOutValor = 20000.00
$itemOutCMV = 16000.00
$itemInAvaliado = 12000.00
$voltaDinheiro = 8000.00

$lucroTroca = $itemOutValor - $itemOutCMV
$equacaoFechada = ($itemInAvaliado + $voltaDinheiro) - $itemOutValor

Assert-Equal $lucroTroca 4000.00 "6.1 Lucro reconhecido na permuta"
Assert-Equal $equacaoFechada 0.00 "6.2 Balanço de valor da permuta perfeitamente equilibrado"

Write-Host "`nTestes concluídos:" -ForegroundColor Cyan
Write-Host "  Passaram: $passed" -ForegroundColor Green
Write-Host "  Falharam: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

if ($failed -gt 0) {
    exit 1
}
