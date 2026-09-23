# cat09_abatimento_servico_desconto.ps1 (12 cenários)

Add-Scenario "SCEN_AS_001" "abatimento_servico_ou_desconto" "Abati 300 reais do Marcos porque ele poliu os três carros da loja." `
    @{ existing_customers = @(@{ id="c170"; name="Marcos"; pending_deals = @(@{ id="d170"; item="Fan 160"; balance=2000 }) }) } `
    "register_adjustment" @{ customer="Marcos"; deal_reference="Fan 160"; adjustment_type="service_labor"; service_description="Polimento de 3 carros"; amount=300 } `
    $false $null @{ cash_delta=0; receivables_delta=-300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_002" "abatimento_servico_ou_desconto" "O Bruno me devia 1.200. Pagou 1.000 no Pix e dei 200 de desconto pra fechar a conta." `
    @{ existing_customers = @(@{ id="c171"; name="Bruno"; pending_deals = @(@{ id="d171"; item="Apple Watch"; balance=1200 }) }) } `
    "register_payment_with_discount" @{ customer="Bruno"; deal_reference="Apple Watch"; cash_paid=1000; payment_method="pix"; discount_amount=200; is_full_settlement=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1200; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_003" "abatimento_servico_ou_desconto" "Abati 400 reais da conta do Mecânico Tonho porque ele trocou a embreagem do Celta." `
    @{ existing_customers = @(@{ id="c172"; name="Mecânico Tonho"; total_debt=1500 }) } `
    "register_adjustment" @{ customer="Mecânico Tonho"; deal_reference=$null; adjustment_type="service_labor"; service_description="Troca de embreagem do Celta"; amount=400 } `
    $false $null @{ cash_delta=0; receivables_delta=-400; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_004" "abatimento_servico_ou_desconto" "Pedrão fez um serviço de pedreiro de 250 reais aqui no galpão, desconta do fiado dele." `
    @{ existing_customers = @(@{ id="c173"; name="Pedrão"; total_debt=500 }) } `
    "register_adjustment" @{ customer="Pedrão"; deal_reference=$null; adjustment_type="service_labor"; service_description="Serviço de pedreiro no galpão"; amount=250 } `
    $false $null @{ cash_delta=0; receivables_delta=-250; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_005" "abatimento_servico_ou_desconto" "O André me devia 3.300 do Palio, me deu 3 mil no TED e dei 300 de desconto pra quitar tudo." `
    @{ existing_customers = @(@{ id="c174"; name="André"; pending_deals = @(@{ id="d174"; item="Palio Fire"; balance=3300 }) }) } `
    "register_payment_with_discount" @{ customer="André"; deal_reference="Palio Fire"; cash_paid=3000; payment_method="bank_transfer"; discount_amount=300; is_full_settlement=$true } `
    $false $null @{ cash_delta=3000; receivables_delta=-3300; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_006" "abatimento_servico_ou_desconto" "Abati 150 reais da parcela do Zé do Pão porque ele trouxe pão e lanche pra equipe da loja." `
    @{ existing_customers = @(@{ id="c175"; name="Zé do Pão"; pending_deals = @(@{ id="d175"; item="Roçadeira"; balance=300 }) }) } `
    "register_adjustment" @{ customer="Zé do Pão"; deal_reference="Roçadeira"; adjustment_type="goodwill_credit"; service_description="Lanches para equipe"; amount=150 } `
    $false $null @{ cash_delta=0; receivables_delta=-150; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_007" "abatimento_servico_ou_desconto" "Faltavam 500 do Celso. Ele pagou 400 em dinheiro e perdoei os outros 100 pra morrer a dívida." `
    @{ existing_customers = @(@{ id="c176"; name="Celso"; total_debt=500 }) } `
    "register_payment_with_discount" @{ customer="Celso"; deal_reference=$null; cash_paid=400; payment_method="cash"; discount_amount=100; is_full_settlement=$true } `
    $false $null @{ cash_delta=400; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_008" "abatimento_servico_ou_desconto" "Abati 500 da dívida do Eletricista Jorge porque ele instalou o quadro de luz novo da oficina." `
    @{ existing_customers = @(@{ id="c177"; name="Eletricista Jorge"; total_debt=1800 }) } `
    "register_adjustment" @{ customer="Eletricista Jorge"; deal_reference=$null; adjustment_type="service_labor"; service_description="Instalação de quadro de luz"; amount=500 } `
    $false $null @{ cash_delta=0; receivables_delta=-500; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_009" "abatimento_servico_ou_desconto" "O Douglas pagou 2.000 no Pix adiantado e dei 200 de desconto no saldo devedor dele." `
    @{ existing_customers = @(@{ id="c178"; name="Douglas"; total_debt=4000 }) } `
    "register_payment_with_discount" @{ customer="Douglas"; deal_reference=$null; cash_paid=2000; payment_method="pix"; discount_amount=200; is_full_settlement=$false } `
    $false $null @{ cash_delta=2000; receivables_delta=-2200; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_010" "abatimento_servico_ou_desconto" "Abati 350 reais da parcela do Rodrigo porque ele fez o frete da saveiro de Curitiba até aqui." `
    @{ existing_customers = @(@{ id="c179"; name="Rodrigo"; pending_deals = @(@{ id="d179"; item="BMW 320i"; balance=20000 }) }) } `
    "register_adjustment" @{ customer="Rodrigo"; deal_reference="BMW 320i"; adjustment_type="service_labor"; service_description="Frete interestadual"; amount=350 } `
    $false $null @{ cash_delta=0; receivables_delta=-350; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_011" "abatimento_servico_ou_desconto" "Valmir devia 1.150, pagou mil no dinheiro e perdoei os 150 pra encerrar o carnê." `
    @{ existing_customers = @(@{ id="c180"; name="Valmir"; pending_deals = @(@{ id="d180"; item="Corsa Sedan"; balance=1150 }) }) } `
    "register_payment_with_discount" @{ customer="Valmir"; deal_reference="Corsa Sedan"; cash_paid=1000; payment_method="cash"; discount_amount=150; is_full_settlement=$true } `
    $false $null @{ cash_delta=1000; receivables_delta=-1150; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AS_012" "abatimento_servico_ou_desconto" "Abati 600 reais da dívida do Pintor Cláudio porque ele pintou o portão e a fachada da loja." `
    @{ existing_customers = @(@{ id="c181"; name="Pintor Cláudio"; total_debt=2200 }) } `
    "register_adjustment" @{ customer="Pintor Cláudio"; deal_reference=$null; adjustment_type="service_labor"; service_description="Pintura de portão e fachada"; amount=600 } `
    $false $null @{ cash_delta=0; receivables_delta=-600; inventory_delta=0; gross_profit=0 }
