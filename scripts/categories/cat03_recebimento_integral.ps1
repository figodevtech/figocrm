# cat03_recebimento_integral.ps1 (15 cenários)

Add-Scenario "SCEN_RI_001" "recebimento_integral" "O João me pagou os 500 da parcela do iPhone no Pix." `
    @{ existing_customers = @(@{ id="c50"; name="João"; pending_deals = @(@{ id="d1"; item="iPhone 13"; balance=2000; next_installment=500 }) }) } `
    "register_payment" @{ customer="João"; deal_reference="iPhone 13"; amount=500; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_002" "recebimento_integral" "Carlos me pagou a parcela de mil reais da moto em dinheiro." `
    @{ existing_customers = @(@{ id="c51"; name="Carlos"; pending_deals = @(@{ id="d2"; item="Bros 160"; balance=7000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="Carlos"; deal_reference="Bros 160"; amount=1000; payment_method="cash"; is_full_installment=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_003" "recebimento_integral" "O André quitou a promissória de mil reais do Palio." `
    @{ existing_customers = @(@{ id="c52"; name="André"; pending_deals = @(@{ id="d3"; item="Palio Fire"; balance=5000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="André"; deal_reference="Palio Fire"; amount=1000; payment_method="cash"; is_full_installment=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_004" "recebimento_integral" "Ricardo mandou 400 no Pix da parcela da televisão." `
    @{ existing_customers = @(@{ id="c53"; name="Ricardo"; pending_deals = @(@{ id="d4"; item="TV 50"; balance=1200; next_installment=400 }) }) } `
    "register_payment" @{ customer="Ricardo"; deal_reference="TV 50"; amount=400; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=400; receivables_delta=-400; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_005" "recebimento_integral" "Tiago veio aqui e limpou a conta dele, pagou os 6 mil da moto à vista." `
    @{ existing_customers = @(@{ id="c54"; name="Tiago"; total_debt=6000 }) } `
    "register_payment" @{ customer="Tiago"; deal_reference=$null; amount=6000; payment_method="cash"; is_full_settlement=$true } `
    $false $null @{ cash_delta=6000; receivables_delta=-6000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_006" "recebimento_integral" "Marcelo pagou a última parcela de mil reais do videogame no Pix." `
    @{ existing_customers = @(@{ id="c55"; name="Marcelo"; pending_deals = @(@{ id="d6"; item="PlayStation 4"; balance=1000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="Marcelo"; deal_reference="PlayStation 4"; amount=1000; payment_method="pix"; is_full_settlement=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_007" "recebimento_integral" "Mestre Cícero me entregou os 500 da betoneira em cédula." `
    @{ existing_customers = @(@{ id="c56"; name="Mestre Cícero"; pending_deals = @(@{ id="d7"; item="Betoneira"; balance=1000; next_installment=500 }) }) } `
    "register_payment" @{ customer="Mestre Cícero"; deal_reference="Betoneira"; amount=500; payment_method="cash"; is_full_installment=$true } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_008" "recebimento_integral" "Wesley pagou a parcela de mil da Titan no Pix." `
    @{ existing_customers = @(@{ id="c57"; name="Wesley"; pending_deals = @(@{ id="d8"; item="Titan 160"; balance=8000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="Wesley"; deal_reference="Titan 160"; amount=1000; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_009" "recebimento_integral" "Patrick mandou 600 no Pix do ar condicionado." `
    @{ existing_customers = @(@{ id="c58"; name="Patrick"; pending_deals = @(@{ id="d9"; item="Split Elgin"; balance=1200; next_installment=600 }) }) } `
    "register_payment" @{ customer="Patrick"; deal_reference="Split Elgin"; amount=600; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=600; receivables_delta=-600; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_010" "recebimento_integral" "Gilmar me deu mil reais em dinheiro da promissória do Uno." `
    @{ existing_customers = @(@{ id="c59"; name="Gilmar"; pending_deals = @(@{ id="d10"; item="Uno Mille"; balance=6000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="Gilmar"; deal_reference="Uno Mille"; amount=1000; payment_method="cash"; is_full_installment=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_011" "recebimento_integral" "Zé do Pão acertou os 300 reais da roçadeira no Pix." `
    @{ existing_customers = @(@{ id="c60"; name="Zé do Pão"; pending_deals = @(@{ id="d11"; item="Roçadeira"; balance=600; next_installment=300 }) }) } `
    "register_payment" @{ customer="Zé do Pão"; deal_reference="Roçadeira"; amount=300; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=300; receivables_delta=-300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_012" "recebimento_integral" "Renan me pagou os 300 da parcela do iPhone 11 no Pix." `
    @{ existing_customers = @(@{ id="c61"; name="Renan"; pending_deals = @(@{ id="d12"; item="iPhone 11"; balance=1500; next_installment=300 }) }) } `
    "register_payment" @{ customer="Renan"; deal_reference="iPhone 11"; amount=300; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=300; receivables_delta=-300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_013" "recebimento_integral" "Kleber pagou 500 do som da caixa trio no dinheiro." `
    @{ existing_customers = @(@{ id="c62"; name="Kleber"; pending_deals = @(@{ id="d13"; item="Caixa Trio"; balance=500; next_installment=500 }) }) } `
    "register_payment" @{ customer="Kleber"; deal_reference="Caixa Trio"; amount=500; payment_method="cash"; is_full_settlement=$true } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_014" "recebimento_integral" "Vanessa transferiu mil reais no Pix da parcela da Biz." `
    @{ existing_customers = @(@{ id="c63"; name="Vanessa"; pending_deals = @(@{ id="d14"; item="Biz 125"; balance=4000; next_installment=1000 }) }) } `
    "register_payment" @{ customer="Vanessa"; deal_reference="Biz 125"; amount=1000; payment_method="pix"; is_full_installment=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1000; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RI_015" "recebimento_integral" "Pedrão pagou os 800 do fiado das ferramentas certinho no dinheiro." `
    @{ existing_customers = @(@{ id="c64"; name="Pedrão"; total_debt=800 }) } `
    "register_payment" @{ customer="Pedrão"; deal_reference=$null; amount=800; payment_method="cash"; is_full_settlement=$true } `
    $false $null @{ cash_delta=800; receivables_delta=-800; inventory_delta=0; gross_profit=0 }
