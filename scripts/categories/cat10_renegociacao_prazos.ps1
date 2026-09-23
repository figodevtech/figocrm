# cat10_renegociacao_prazos.ps1 (15 cenários)

Add-Scenario "SCEN_RN_001" "renegociacao_e_prazos" "Joga a parcela do Pedro que vencia hoje pro dia 25." `
    @{ existing_customers = @(@{ id="c190"; name="Pedro"; pending_deals = @(@{ id="d190"; item="iPhone 11"; balance=600; next_due_date="2026-09-23" }) }) } `
    "update_due_date" @{ customer="Pedro"; deal_reference="iPhone 11"; new_due_date="2026-09-25" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_002" "renegociacao_e_prazos" "O Márcio tinha duas parcelas atrasadas de 600. Juntei tudo e parcelei os 1.200 em 4 vezes de 300." `
    @{ existing_customers = @(@{ id="c191"; name="Márcio"; pending_deals = @(@{ id="d191"; item="Titan 150"; balance=1200; overdue_installments=2 }) }) } `
    "renegotiate_debt" @{ customer="Márcio"; deal_reference="Titan 150"; consolidated_amount=1200; new_installments_count=4; new_installment_value=300 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_003" "renegociacao_e_prazos" "Muda o vencimento da parcela de mil reais do Carlos pro dia 10 do mês que vem." `
    @{ existing_customers = @(@{ id="c192"; name="Carlos"; pending_deals = @(@{ id="d192"; item="Bros 160"; balance=5000; next_installment=1000 }) }) } `
    "update_due_date" @{ customer="Carlos"; deal_reference="Bros 160"; target_installment_value=1000; new_due_day=10 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_004" "renegociacao_e_prazos" "O André não vai conseguir pagar os mil reais da promissória esse mês, divide essa parcela em duas de 500." `
    @{ existing_customers = @(@{ id="c193"; name="André"; pending_deals = @(@{ id="d193"; item="Palio Fire"; balance=4000; next_installment=1000 }) }) } `
    "split_installment" @{ customer="André"; deal_reference="Palio Fire"; target_installment_amount=1000; new_installments_count=2; new_installment_value=500 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_005" "renegociacao_e_prazos" "O Wesley me devia 3 parcelas de mil da Titan. Reparcielei o saldo de 3 mil em 6 vezes de 500." `
    @{ existing_customers = @(@{ id="c194"; name="Wesley"; pending_deals = @(@{ id="d194"; item="Titan 160"; balance=3000; overdue_installments=3 }) }) } `
    "renegotiate_debt" @{ customer="Wesley"; deal_reference="Titan 160"; consolidated_amount=3000; new_installments_count=6; new_installment_value=500 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_006" "renegociacao_e_prazos" "Passa o fiado de 800 do Pedrão pra duas parcelas de 400, uma dia 10 e outra dia 25." `
    @{ existing_customers = @(@{ id="c195"; name="Pedrão"; total_debt=800 }) } `
    "renegotiate_debt" @{ customer="Pedrão"; deal_reference=$null; consolidated_amount=800; new_installments_count=2; new_installment_value=400; specific_dates=@("dia 10", "dia 25") } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_007" "renegociacao_e_prazos" "Joga as parcelas do Gilmar do Uno todas com vencimento pro dia 15 em vez de dia 5." `
    @{ existing_customers = @(@{ id="c196"; name="Gilmar"; pending_deals = @(@{ id="d196"; item="Uno Mille"; balance=5000 }) }) } `
    "update_deal_due_day" @{ customer="Gilmar"; deal_reference="Uno Mille"; new_due_day=15 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_008" "renegociacao_e_prazos" "O Mestre Cícero pediu mais 15 dias pra pagar a parcela de 500 da betoneira." `
    @{ existing_customers = @(@{ id="c197"; name="Mestre Cícero"; pending_deals = @(@{ id="d197"; item="Betoneira"; balance=1000; next_installment=500 }) }) } `
    "extend_due_date" @{ customer="Mestre Cícero"; deal_reference="Betoneira"; days_to_add=15 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_009" "renegociacao_e_prazos" "Renegociei o saldo de 2 mil do Patrick do ar condicionado, virou 5 parcelas de 400." `
    @{ existing_customers = @(@{ id="c198"; name="Patrick"; pending_deals = @(@{ id="d198"; item="Split Elgin"; balance=2000 }) }) } `
    "renegotiate_debt" @{ customer="Patrick"; deal_reference="Split Elgin"; consolidated_amount=2000; new_installments_count=5; new_installment_value=400 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_010" "renegociacao_e_prazos" "O Ricardo atrasou duas parcelas de 400 da TV. Junta tudo e põe 8 parcelas de 100 reais semanais." `
    @{ existing_customers = @(@{ id="c199"; name="Ricardo"; pending_deals = @(@{ id="d199"; item="TV 50"; balance=800; overdue_installments=2 }) }) } `
    "renegotiate_debt" @{ customer="Ricardo"; deal_reference="TV 50"; consolidated_amount=800; new_installments_count=8; new_installment_value=100; interval_type="weekly" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_011" "renegociacao_e_prazos" "Empurra a promissória do Valmir que vencia amanhã pro fim do mês." `
    @{ existing_customers = @(@{ id="c200"; name="Valmir"; pending_deals = @(@{ id="d200"; item="Corsa Sedan"; balance=6000; next_installment=1000 }) }) } `
    "update_due_date" @{ customer="Valmir"; deal_reference="Corsa Sedan"; new_due_date="end_of_month" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_012" "renegociacao_e_prazos" "O Zé do Pão pediu pra juntar as duas parcelas de 300 numa só de 600 pro dia 30." `
    @{ existing_customers = @(@{ id="c201"; name="Zé do Pão"; pending_deals = @(@{ id="d201"; item="Roçadeira"; balance=600; installments_count=2 }) }) } `
    "consolidate_installments" @{ customer="Zé do Pão"; deal_reference="Roçadeira"; new_installments_count=1; new_installment_value=600; new_due_day=30 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_013" "renegociacao_e_prazos" "O Borracheiro Zé não aguentou pagar 600 por mês, refiz o saldo de 1.800 em 6 de 300 reais." `
    @{ existing_customers = @(@{ id="c202"; name="Borracheiro Zé"; pending_deals = @(@{ id="d202"; item="Lote Pneus"; balance=1800 }) }) } `
    "renegotiate_debt" @{ customer="Borracheiro Zé"; deal_reference="Lote Pneus"; consolidated_amount=1800; new_installments_count=6; new_installment_value=300 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_014" "renegociacao_e_prazos" "Adia a parcela da Biz da Vanessa em 20 dias." `
    @{ existing_customers = @(@{ id="c203"; name="Vanessa"; pending_deals = @(@{ id="d203"; item="Biz 125"; balance=3000; next_installment=1000 }) }) } `
    "extend_due_date" @{ customer="Vanessa"; deal_reference="Biz 125"; days_to_add=20 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RN_015" "renegociacao_e_prazos" "O Marcão tinha 3 parcelas de mil da esquadrejadeira. Transformei em 10 parcelas de 300 reais." `
    @{ existing_customers = @(@{ id="c204"; name="Marcão"; pending_deals = @(@{ id="d204"; item="Esquadrejadeira"; balance=3000 }) }) } `
    "renegotiate_debt" @{ customer="Marcão"; deal_reference="Esquadrejadeira"; consolidated_amount=3000; new_installments_count=10; new_installment_value=300 } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }
