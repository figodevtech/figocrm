# cat04_recebimento_parcial.ps1 (18 cenários)

Add-Scenario "SCEN_RP_001" "recebimento_parcial" "O João só conseguiu me pagar 200 daquela parcela de 500 do iPhone." `
    @{ existing_customers = @(@{ id="c70"; name="João"; pending_deals = @(@{ id="d1"; item="iPhone 13"; balance=2000; next_installment=500 }) }) } `
    "register_partial_payment" @{ customer="João"; deal_reference="iPhone 13"; amount_paid=200; installment_original_value=500; remaining_installment_balance=300 } `
    $false $null @{ cash_delta=200; receivables_delta=-200; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_002" "recebimento_parcial" "Carlos me deu 400 conto da parcela de mil da Bros, ficou devendo 600." `
    @{ existing_customers = @(@{ id="c71"; name="Carlos"; pending_deals = @(@{ id="d2"; item="Bros 160"; balance=7000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Carlos"; deal_reference="Bros 160"; amount_paid=400; installment_original_value=1000; remaining_installment_balance=600 } `
    $false $null @{ cash_delta=400; receivables_delta=-400; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_003" "recebimento_parcial" "André mandou 700 no Pix pra abater na promissória de mil do Palio." `
    @{ existing_customers = @(@{ id="c72"; name="André"; pending_deals = @(@{ id="d3"; item="Palio Fire"; balance=5000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="André"; deal_reference="Palio Fire"; amount_paid=700; installment_original_value=1000; remaining_installment_balance=300 } `
    $false $null @{ cash_delta=700; receivables_delta=-700; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_004" "recebimento_parcial" "Ricardo pagou 250 da parcela de 400 da televisão no Pix." `
    @{ existing_customers = @(@{ id="c73"; name="Ricardo"; pending_deals = @(@{ id="d4"; item="TV 50"; balance=1200; next_installment=400 }) }) } `
    "register_partial_payment" @{ customer="Ricardo"; deal_reference="TV 50"; amount_paid=250; installment_original_value=400; remaining_installment_balance=150 } `
    $false $null @{ cash_delta=250; receivables_delta=-250; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_005" "recebimento_parcial" "Mestre Cícero me deu 300 reais da parcela da betoneira e disse que paga os 200 semana que vem." `
    @{ existing_customers = @(@{ id="c74"; name="Mestre Cícero"; pending_deals = @(@{ id="d7"; item="Betoneira"; balance=1000; next_installment=500 }) }) } `
    "register_partial_payment" @{ customer="Mestre Cícero"; deal_reference="Betoneira"; amount_paid=300; installment_original_value=500; remaining_installment_balance=200 } `
    $false $null @{ cash_delta=300; receivables_delta=-300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_006" "recebimento_parcial" "Wesley me deu 500 no dinheiro da parcela de mil da Titan." `
    @{ existing_customers = @(@{ id="c75"; name="Wesley"; pending_deals = @(@{ id="d8"; item="Titan 160"; balance=8000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Wesley"; deal_reference="Titan 160"; amount_paid=500; installment_original_value=1000; remaining_installment_balance=500 } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_007" "recebimento_parcial" "Patrick pagou 350 da parcela de 600 do ar condicionado." `
    @{ existing_customers = @(@{ id="c76"; name="Patrick"; pending_deals = @(@{ id="d9"; item="Split Elgin"; balance=1200; next_installment=600 }) }) } `
    "register_partial_payment" @{ customer="Patrick"; deal_reference="Split Elgin"; amount_paid=350; installment_original_value=600; remaining_installment_balance=250 } `
    $false $null @{ cash_delta=350; receivables_delta=-350; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_008" "recebimento_parcial" "Gilmar me passou 600 reais no Pix da promissória de mil do Uno." `
    @{ existing_customers = @(@{ id="c77"; name="Gilmar"; pending_deals = @(@{ id="d10"; item="Uno Mille"; balance=6000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Gilmar"; deal_reference="Uno Mille"; amount_paid=600; installment_original_value=1000; remaining_installment_balance=400 } `
    $false $null @{ cash_delta=600; receivables_delta=-600; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_009" "recebimento_parcial" "Renan me deu 150 reais da parcela de 300 do iPhone 11." `
    @{ existing_customers = @(@{ id="c78"; name="Renan"; pending_deals = @(@{ id="d12"; item="iPhone 11"; balance=1500; next_installment=300 }) }) } `
    "register_partial_payment" @{ customer="Renan"; deal_reference="iPhone 11"; amount_paid=150; installment_original_value=300; remaining_installment_balance=150 } `
    $false $null @{ cash_delta=150; receivables_delta=-150; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_010" "recebimento_parcial" "Vanessa transferiu 600 no Pix da parcela de mil da Biz." `
    @{ existing_customers = @(@{ id="c79"; name="Vanessa"; pending_deals = @(@{ id="d14"; item="Biz 125"; balance=4000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Vanessa"; deal_reference="Biz 125"; amount_paid=600; installment_original_value=1000; remaining_installment_balance=400 } `
    $false $null @{ cash_delta=600; receivables_delta=-600; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_011" "recebimento_parcial" "Pedrão pagou 400 do fiado de 800, ficou devendo 400 ainda." `
    @{ existing_customers = @(@{ id="c80"; name="Pedrão"; total_debt=800 }) } `
    "register_partial_payment" @{ customer="Pedrão"; deal_reference=$null; amount_paid=400; remaining_installment_balance=400 } `
    $false $null @{ cash_delta=400; receivables_delta=-400; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_012" "recebimento_parcial" "Cláudio pagou 200 da quinzena de 400 do motor." `
    @{ existing_customers = @(@{ id="c81"; name="Cláudio"; pending_deals = @(@{ id="d15"; item="Motor Branco"; balance=1600; next_installment=400 }) }) } `
    "register_partial_payment" @{ customer="Cláudio"; deal_reference="Motor Branco"; amount_paid=200; installment_original_value=400; remaining_installment_balance=200 } `
    $false $null @{ cash_delta=200; receivables_delta=-200; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_013" "recebimento_parcial" "Valmir pagou 500 reais da promissória de mil do Corsa." `
    @{ existing_customers = @(@{ id="c82"; name="Valmir"; pending_deals = @(@{ id="d16"; item="Corsa Sedan"; balance=10000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Valmir"; deal_reference="Corsa Sedan"; amount_paid=500; installment_original_value=1000; remaining_installment_balance=500 } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_014" "recebimento_parcial" "Fabiano mandou 250 no Pix da parcela de quinhentos do gerador." `
    @{ existing_customers = @(@{ id="c83"; name="Fabiano"; pending_deals = @(@{ id="d17"; item="Gerador Toyama"; balance=2000; next_installment=500 }) }) } `
    "register_partial_payment" @{ customer="Fabiano"; deal_reference="Gerador Toyama"; amount_paid=250; installment_original_value=500; remaining_installment_balance=250 } `
    $false $null @{ cash_delta=250; receivables_delta=-250; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_015" "recebimento_parcial" "Marcão me pagou 500 no Pix da parcela de mil da esquadrejadeira." `
    @{ existing_customers = @(@{ id="c84"; name="Marcão"; pending_deals = @(@{ id="d18"; item="Esquadrejadeira"; balance=3000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Marcão"; deal_reference="Esquadrejadeira"; amount_paid=500; installment_original_value=1000; remaining_installment_balance=500 } `
    $false $null @{ cash_delta=500; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_016" "recebimento_parcial" "Borracheiro Zé deu 300 reais do carnê dos pneus de 600." `
    @{ existing_customers = @(@{ id="c85"; name="Borracheiro Zé"; pending_deals = @(@{ id="d19"; item="Lote Pneus"; balance=2400; next_installment=600 }) }) } `
    "register_partial_payment" @{ customer="Borracheiro Zé"; deal_reference="Lote Pneus"; amount_paid=300; installment_original_value=600; remaining_installment_balance=300 } `
    $false $null @{ cash_delta=300; receivables_delta=-300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_017" "recebimento_parcial" "Jurandir pagou 600 reais no dinheiro da parcela de mil da carretinha." `
    @{ existing_customers = @(@{ id="c86"; name="Jurandir"; pending_deals = @(@{ id="d20"; item="Carretinha Reboque"; balance=2000; next_installment=1000 }) }) } `
    "register_partial_payment" @{ customer="Jurandir"; deal_reference="Carretinha Reboque"; amount_paid=600; installment_original_value=1000; remaining_installment_balance=400 } `
    $false $null @{ cash_delta=600; receivables_delta=-600; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_RP_018" "recebimento_parcial" "O Carlos mandou 1.500 no Pix, abate mil da parcela vencida da moto e 500 na que vence mês que vem." `
    @{ existing_customers = @(@{ id="c87"; name="Carlos"; pending_deals = @(@{ id="d2"; item="Bros 160"; balance=7000; installments=@(@{ num=1; val=1000; overdue=$true }, @{ num=2; val=1000; overdue=$false }) }) }) } `
    "register_multi_installment_payment" @{ customer="Carlos"; deal_reference="Bros 160"; total_paid=1500; allocations=@(@{ installment=1; paid=1000; status="paid" }, @{ installment=2; paid=500; status="partially_paid" }) } `
    $false $null @{ cash_delta=1500; receivables_delta=-1500; inventory_delta=0; gross_profit=0 }
