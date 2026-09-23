# cat02_venda_parcelada.ps1 (22 cenários)

Add-Scenario "SCEN_VP_001" "venda_parcelada" "Vendi o iPhone 13 pro João por 3 mil. Ele deu mil no Pix e o resto ficou em quatro de quinhentos." `
    @{ existing_customers = @(@{ id="c20"; name="João" }); existing_items = @(@{ id="i20"; name="iPhone 13 128GB"; cost=2200; status="disponivel" }) } `
    "create_sale" @{ customer="João"; item="iPhone 13 128GB"; total_deal_value=3000; payment_method="pix"; cash_inflow=1000; receivable=@{ total_amount=2000; installments_count=4; installment_value=500 } } `
    $false $null @{ cash_delta=1000; receivables_delta=2000; inventory_delta=-2200; gross_profit=800 }

Add-Scenario "SCEN_VP_002" "venda_parcelada" "Passei a Bros 160 pro Carlos por 15 mil. Ele me deu 5 mil à vista e dez parcelas de mil todo dia 10." `
    @{ existing_customers = @(@{ id="c21"; name="Carlos" }); existing_items = @(@{ id="i21"; name="Bros 160 2021"; cost=12000; status="disponivel" }) } `
    "create_sale" @{ customer="Carlos"; item="Bros 160 2021"; total_deal_value=15000; payment_method="cash"; cash_inflow=5000; receivable=@{ total_amount=10000; installments_count=10; installment_value=1000; due_day=10 } } `
    $false $null @{ cash_delta=5000; receivables_delta=10000; inventory_delta=-12000; gross_profit=3000 }

Add-Scenario "SCEN_VP_003" "venda_parcelada" "Vendi a TV 50 pro Ricardo em 5 vezes de 400 sem entrada, primeira pro mês que vem." `
    @{ existing_customers = @(@{ id="c22"; name="Ricardo" }); existing_items = @(@{ id="i22"; name="Smart TV 50 LG"; cost=1400; status="disponivel" }) } `
    "create_sale" @{ customer="Ricardo"; item="Smart TV 50 LG"; total_deal_value=2000; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=2000; installments_count=5; installment_value=400 } } `
    $false $null @{ cash_delta=0; receivables_delta=2000; inventory_delta=-1400; gross_profit=600 }

Add-Scenario "SCEN_VP_004" "venda_parcelada" "Passei a moto pro Tiago no fiado por 6 mil pra ele me pagar quando colher o café." `
    @{ existing_customers = @(@{ id="c23"; name="Tiago" }); existing_items = @(@{ id="i23"; name="CG 125 Fan"; cost=4200; status="disponivel" }) } `
    "create_sale" @{ customer="Tiago"; item="CG 125 Fan"; total_deal_value=6000; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=6000; installments_count=1; installment_value=6000; is_fiado=$true } } `
    $false $null @{ cash_delta=0; receivables_delta=6000; inventory_delta=-4200; gross_profit=1800 }

Add-Scenario "SCEN_VP_005" "venda_parcelada" "Vendi o Palio pro André por 18 mil. Entrada de 6 mil no TED e 12 promissórias de mil reais." `
    @{ existing_customers = @(@{ id="c24"; name="André" }); existing_items = @(@{ id="i24"; name="Palio Fire 2012"; cost=13500; status="disponivel" }) } `
    "create_sale" @{ customer="André"; item="Palio Fire 2012"; total_deal_value=18000; payment_method="bank_transfer"; cash_inflow=6000; receivable=@{ total_amount=12000; installments_count=12; installment_value=1000; is_promissory=$true } } `
    $false $null @{ cash_delta=6000; receivables_delta=12000; inventory_delta=-13500; gross_profit=4500 }

Add-Scenario "SCEN_VP_006" "venda_parcelada" "Entreguei o PlayStation pro Marcelo por 2.400, quatrocentos no Pix e duas de mil." `
    @{ existing_customers = @(@{ id="c25"; name="Marcelo" }); existing_items = @(@{ id="i25"; name="PlayStation 4 Pro"; cost=1700; status="disponivel" }) } `
    "create_sale" @{ customer="Marcelo"; item="PlayStation 4 Pro"; total_deal_value=2400; payment_method="pix"; cash_inflow=400; receivable=@{ total_amount=2000; installments_count=2; installment_value=1000 } } `
    $false $null @{ cash_delta=400; receivables_delta=2000; inventory_delta=-1700; gross_profit=700 }

Add-Scenario "SCEN_VP_007" "venda_parcelada" "Vendi o notebook pro Fernando por 2.500 em 5 de 500 direto, sem entrada." `
    @{ existing_customers = @(@{ id="c26"; name="Fernando" }); existing_items = @(@{ id="i26"; name="Acer Aspire 5"; cost=1800; status="disponivel" }) } `
    "create_sale" @{ customer="Fernando"; item="Acer Aspire 5"; total_deal_value=2500; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=2500; installments_count=5; installment_value=500 } } `
    $false $null @{ cash_delta=0; receivables_delta=2500; inventory_delta=-1800; gross_profit=700 }

Add-Scenario "SCEN_VP_008" "venda_parcelada" "Vendi a betoneira pro Mestre Cícero por 2 mil. Deu 500 no dinheiro e 3 de 500 a cada 30 dias." `
    @{ existing_customers = @(@{ id="c27"; name="Mestre Cícero" }); existing_items = @(@{ id="i27"; name="Betoneira Menegotti"; cost=1300; status="disponivel" }) } `
    "create_sale" @{ customer="Mestre Cícero"; item="Betoneira Menegotti"; total_deal_value=2000; payment_method="cash"; cash_inflow=500; receivable=@{ total_amount=1500; installments_count=3; installment_value=500 } } `
    $false $null @{ cash_delta=500; receivables_delta=1500; inventory_delta=-1300; gross_profit=700 }

Add-Scenario "SCEN_VP_009" "venda_parcelada" "Passei a Titan 160 pro Wesley por 13 mil, 3 mil no Pix de sinal e o restante em 10 de mil." `
    @{ existing_customers = @(@{ id="c28"; name="Wesley" }); existing_items = @(@{ id="i28"; name="Titan 160 2020"; cost=10200; status="disponivel" }) } `
    "create_sale" @{ customer="Wesley"; item="Titan 160 2020"; total_deal_value=13000; payment_method="pix"; cash_inflow=3000; receivable=@{ total_amount=10000; installments_count=10; installment_value=1000 } } `
    $false $null @{ cash_delta=3000; receivables_delta=10000; inventory_delta=-10200; gross_profit=2800 }

Add-Scenario "SCEN_VP_010" "venda_parcelada" "Vendi o ar condicionado pro Patrick por mil e oitocentos em 3 parcelas de 600 reais." `
    @{ existing_customers = @(@{ id="c29"; name="Patrick" }); existing_items = @(@{ id="i29"; name="Split 12000 Elgin"; cost=1200; status="disponivel" }) } `
    "create_sale" @{ customer="Patrick"; item="Split 12000 Elgin"; total_deal_value=1800; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=1800; installments_count=3; installment_value=600 } } `
    $false $null @{ cash_delta=0; receivables_delta=1800; inventory_delta=-1200; gross_profit=600 }

Add-Scenario "SCEN_VP_011" "venda_parcelada" "Vendi o Uno Mille pro Gilmar por 12 mil. 4 mil no dinheiro e 8 de mil na promissória." `
    @{ existing_customers = @(@{ id="c30"; name="Gilmar" }); existing_items = @(@{ id="i30"; name="Uno Mille 2008"; cost=9000; status="disponivel" }) } `
    "create_sale" @{ customer="Gilmar"; item="Uno Mille 2008"; total_deal_value=12000; payment_method="cash"; cash_inflow=4000; receivable=@{ total_amount=8000; installments_count=8; installment_value=1000; is_promissory=$true } } `
    $false $null @{ cash_delta=4000; receivables_delta=8000; inventory_delta=-9000; gross_profit=3000 }

Add-Scenario "SCEN_VP_012" "venda_parcelada" "Passei a roçadeira pro Zé do Pão por 900 reais, 300 agora no Pix e duas de 300 pra dia 15." `
    @{ existing_customers = @(@{ id="c31"; name="Zé do Pão" }); existing_items = @(@{ id="i31"; name="Roçadeira Stihl"; cost=600; status="disponivel" }) } `
    "create_sale" @{ customer="Zé do Pão"; item="Roçadeira Stihl"; total_deal_value=900; payment_method="pix"; cash_inflow=300; receivable=@{ total_amount=600; installments_count=2; installment_value=300; due_day=15 } } `
    $false $null @{ cash_delta=300; receivables_delta=600; inventory_delta=-600; gross_profit=300 }

Add-Scenario "SCEN_VP_013" "venda_parcelada" "Vendi o iPhone 11 pro Renan por 1.800 em 6 vezes de 300 reais sem entrada." `
    @{ existing_customers = @(@{ id="c32"; name="Renan" }); existing_items = @(@{ id="i32"; name="iPhone 11 64GB"; cost=1300; status="disponivel" }) } `
    "create_sale" @{ customer="Renan"; item="iPhone 11 64GB"; total_deal_value=1800; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=1800; installments_count=6; installment_value=300 } } `
    $false $null @{ cash_delta=0; receivables_delta=1800; inventory_delta=-1300; gross_profit=500 }

Add-Scenario "SCEN_VP_014" "venda_parcelada" "Vendi o som automotivo pro Kleber por 1.500. 500 no Pix e duas de 500 pro dia 5 de cada mês." `
    @{ existing_customers = @(@{ id="c33"; name="Kleber" }); existing_items = @(@{ id="i33"; name="Caixa Trio Pioneer"; cost=1000; status="disponivel" }) } `
    "create_sale" @{ customer="Kleber"; item="Caixa Trio Pioneer"; total_deal_value=1500; payment_method="pix"; cash_inflow=500; receivable=@{ total_amount=1000; installments_count=2; installment_value=500; due_day=5 } } `
    $false $null @{ cash_delta=500; receivables_delta=1000; inventory_delta=-1000; gross_profit=500 }

Add-Scenario "SCEN_VP_015" "venda_parcelada" "Passei a Biz 125 pra Vanessa por 9 mil. 3 mil de entrada no Pix e 6 de mil." `
    @{ existing_customers = @(@{ id="c34"; name="Vanessa" }); existing_items = @(@{ id="i34"; name="Biz 125 2018"; cost=7200; status="disponivel" }) } `
    "create_sale" @{ customer="Vanessa"; item="Biz 125 2018"; total_deal_value=9000; payment_method="pix"; cash_inflow=3000; receivable=@{ total_amount=6000; installments_count=6; installment_value=1000 } } `
    $false $null @{ cash_delta=3000; receivables_delta=6000; inventory_delta=-7200; gross_profit=1800 }

Add-Scenario "SCEN_VP_016" "venda_parcelada" "Vendi o motor estacionário pro Cláudio por 1.600 reais em 4 quinzenais de 400." `
    @{ existing_customers = @(@{ id="c35"; name="Cláudio" }); existing_items = @(@{ id="i35"; name="Motor Branco 6.5HP"; cost=1100; status="disponivel" }) } `
    "create_sale" @{ customer="Cláudio"; item="Motor Branco 6.5HP"; total_deal_value=1600; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=1600; installments_count=4; installment_value=400; interval_days=15 } } `
    $false $null @{ cash_delta=0; receivables_delta=1600; inventory_delta=-1100; gross_profit=500 }

Add-Scenario "SCEN_VP_017" "venda_parcelada" "Fechei o Corsa com o Valmir por 14 mil. 4 mil no dinheiro e 10 de mil na promissória." `
    @{ existing_customers = @(@{ id="c36"; name="Valmir" }); existing_items = @(@{ id="i36"; name="Corsa Sedan 2005"; cost=10500; status="disponivel" }) } `
    "create_sale" @{ customer="Valmir"; item="Corsa Sedan 2005"; total_deal_value=14000; payment_method="cash"; cash_inflow=4000; receivable=@{ total_amount=10000; installments_count=10; installment_value=1000; is_promissory=$true } } `
    $false $null @{ cash_delta=4000; receivables_delta=10000; inventory_delta=-10500; gross_profit=3500 }

Add-Scenario "SCEN_VP_018" "venda_parcelada" "Vendi o gerador pro Fabiano por 3 mil. Mil de entrada no Pix e 4 de quinhentos." `
    @{ existing_customers = @(@{ id="c37"; name="Fabiano" }); existing_items = @(@{ id="i37"; name="Gerador Toyama 3000"; cost=2100; status="disponivel" }) } `
    "create_sale" @{ customer="Fabiano"; item="Gerador Toyama 3000"; total_deal_value=3000; payment_method="pix"; cash_inflow=1000; receivable=@{ total_amount=2000; installments_count=4; installment_value=500 } } `
    $false $null @{ cash_delta=1000; receivables_delta=2000; inventory_delta=-2100; gross_profit=900 }

Add-Scenario "SCEN_VP_019" "venda_parcelada" "Entreguei as ferramentas pro Pedrão por 800 conto no fiado pra ele pagar dia 20." `
    @{ existing_customers = @(@{ id="c38"; name="Pedrão" }); existing_items = @(@{ id="i38"; name="Kit Chaves Tramontina Pro"; cost=500; status="disponivel" }) } `
    "create_sale" @{ customer="Pedrão"; item="Kit Chaves Tramontina Pro"; total_deal_value=800; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=800; installments_count=1; installment_value=800; is_fiado=$true; due_day=20 } } `
    $false $null @{ cash_delta=0; receivables_delta=800; inventory_delta=-500; gross_profit=300 }

Add-Scenario "SCEN_VP_020" "venda_parcelada" "Vendi a serra esquadrejadeira pro Marcão por 4 mil. Mil no Pix e 3 de mil." `
    @{ existing_customers = @(@{ id="c39"; name="Marcão" }); existing_items = @(@{ id="i39"; name="Esquadrejadeira Baldan"; cost=2800; status="disponivel" }) } `
    "create_sale" @{ customer="Marcão"; item="Esquadrejadeira Baldan"; total_deal_value=4000; payment_method="pix"; cash_inflow=1000; receivable=@{ total_amount=3000; installments_count=3; installment_value=1000 } } `
    $false $null @{ cash_delta=1000; receivables_delta=3000; inventory_delta=-2800; gross_profit=1200 }

Add-Scenario "SCEN_VP_021" "venda_parcelada" "Passei o lote de pneus pro Borracheiro Zé por 2.400 em 4 de 600 no carnê." `
    @{ existing_customers = @(@{ id="c40"; name="Borracheiro Zé" }); existing_items = @(@{ id="i40"; name="Lote 8 Pneus Aro 14"; cost=1600; status="disponivel" }) } `
    "create_sale" @{ customer="Borracheiro Zé"; item="Lote 8 Pneus Aro 14"; total_deal_value=2400; payment_method=$null; cash_inflow=0; receivable=@{ total_amount=2400; installments_count=4; installment_value=600 } } `
    $false $null @{ cash_delta=0; receivables_delta=2400; inventory_delta=-1600; gross_profit=800 }

Add-Scenario "SCEN_VP_022" "venda_parcelada" "Vendi a carretinha reboque pro Jurandir por 3.500. 1.500 à vista e duas de mil." `
    @{ existing_customers = @(@{ id="c41"; name="Jurandir" }); existing_items = @(@{ id="i41"; name="Carretinha Reboque 2022"; cost=2400; status="disponivel" }) } `
    "create_sale" @{ customer="Jurandir"; item="Carretinha Reboque 2022"; total_deal_value=3500; payment_method="cash"; cash_inflow=1500; receivable=@{ total_amount=2000; installments_count=2; installment_value=1000 } } `
    $false $null @{ cash_delta=1500; receivables_delta=2000; inventory_delta=-2400; gross_profit=1100 }
