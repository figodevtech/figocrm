# cat07_troca_com_volta_paga.ps1 (14 cenários)

Add-Scenario "SCEN_TP_001" "troca_com_volta_paga" "Peguei uma Hilux de 120 mil do Beto, dei meu Corolla avaliado em 80 mil e paguei 40 mil de volta no Pix." `
    @{ existing_customers = @(@{ id="c130"; name="Beto" }); existing_items = @(@{ id="i130"; name="Corolla XEi 2018"; cost=75000; status="disponivel" }) } `
    "create_trade" @{ customer="Beto"; item_out="Corolla XEi 2018"; item_in="Hilux SRV 2020"; trade_balance=40000; direction="paid"; payment_method="pix"; cash_outflow=40000; payable=$null } `
    $false $null @{ cash_delta=-40000; receivables_delta=0; inventory_delta=45000; gross_profit=0 }

Add-Scenario "SCEN_TP_002" "troca_com_volta_paga" "Peguei a BMW por 90 mil. Dei meu Golf por 60 mil e vou pagar 6 parcelas de 5 mil pro Rodrigo." `
    @{ existing_customers = @(@{ id="c131"; name="Rodrigo" }); existing_items = @(@{ id="i131"; name="Golf TSI 2015"; cost=55000; status="disponivel" }) } `
    "create_trade" @{ customer="Rodrigo"; item_out="Golf TSI 2015"; item_in="BMW 320i 2017"; trade_balance=30000; direction="paid"; cash_outflow=0; payable=@{ total_amount=30000; installments_count=6; installment_value=5000 } } `
    $false $null @{ cash_delta=0; receivables_delta=0; payables_delta=30000; inventory_delta=35000; gross_profit=0 }

Add-Scenario "SCEN_TP_003" "troca_com_volta_paga" "Peguei o iPhone 15 Pro do Caio por 6 mil. Dei meu 13 de 3 mil e voltei 3 mil no Pix." `
    @{ existing_customers = @(@{ id="c132"; name="Caio" }); existing_items = @(@{ id="i132"; name="iPhone 13 128GB"; cost=2400; status="disponivel" }) } `
    "create_trade" @{ customer="Caio"; item_out="iPhone 13 128GB"; item_in="iPhone 15 Pro"; trade_balance=3000; direction="paid"; payment_method="pix"; cash_outflow=3000; payable=$null } `
    $false $null @{ cash_delta=-3000; receivables_delta=0; inventory_delta=3600; gross_profit=0 }

Add-Scenario "SCEN_TP_004" "troca_com_volta_paga" "Peguei a CB 500 do Gustavo. Dei minha Titan avaliada em 11 mil e paguei 14 mil no dinheiro vivo." `
    @{ existing_customers = @(@{ id="c133"; name="Gustavo" }); existing_items = @(@{ id="i133"; name="Titan 160 2021"; cost=9500; status="disponivel" }) } `
    "create_trade" @{ customer="Gustavo"; item_out="Titan 160 2021"; item_in="CB 500F 2020"; trade_balance=14000; direction="paid"; payment_method="cash"; cash_outflow=14000; payable=$null } `
    $false $null @{ cash_delta=-14000; receivables_delta=0; inventory_delta=15500; gross_profit=0 }

Add-Scenario "SCEN_TP_005" "troca_com_volta_paga" "Peguei a Toro do Maurício. Dei o Celta por 18 mil e dei 35 mil de volta no Pix." `
    @{ existing_customers = @(@{ id="c134"; name="Maurício" }); existing_items = @(@{ id="i134"; name="Celta 2011"; cost=15000; status="disponivel" }) } `
    "create_trade" @{ customer="Maurício"; item_out="Celta 2011"; item_in="Fiat Toro 2017"; trade_balance=35000; direction="paid"; payment_method="pix"; cash_outflow=35000; payable=$null } `
    $false $null @{ cash_delta=-35000; receivables_delta=0; inventory_delta=38000; gross_profit=0 }

Add-Scenario "SCEN_TP_006" "troca_com_volta_paga" "Peguei o MacBook Pro M2 do Daniel. Dei meu Dell por 3 mil e paguei 4 mil de volta no Pix." `
    @{ existing_customers = @(@{ id="c135"; name="Daniel" }); existing_items = @(@{ id="i135"; name="Dell Inspiron"; cost=2500; status="disponivel" }) } `
    "create_trade" @{ customer="Daniel"; item_out="Dell Inspiron"; item_in="MacBook Pro M2"; trade_balance=4000; direction="paid"; payment_method="pix"; cash_outflow=4000; payable=$null } `
    $false $null @{ cash_delta=-4000; receivables_delta=0; inventory_delta=4500; gross_profit=0 }

Add-Scenario "SCEN_TP_007" "troca_com_volta_paga" "Peguei o gerador a diesel do Wanderley. Dei meu gerador a gasolina por 2 mil e passei 3 mil de volta no Pix." `
    @{ existing_customers = @(@{ id="c136"; name="Wanderley" }); existing_items = @(@{ id="i136"; name="Gerador Gasolina 3.5KVA"; cost=1600; status="disponivel" }) } `
    "create_trade" @{ customer="Wanderley"; item_out="Gerador Gasolina 3.5KVA"; item_in="Gerador Diesel 7KVA"; trade_balance=3000; direction="paid"; payment_method="pix"; cash_outflow=3000; payable=$null } `
    $false $null @{ cash_delta=-3000; receivables_delta=0; inventory_delta=3400; gross_profit=0 }

Add-Scenario "SCEN_TP_008" "troca_com_volta_paga" "Peguei a XRE 300 do Fabinho. Dei minha Fan por 10 mil e fiquei de pagar 8 mil em 4 de 2 mil." `
    @{ existing_customers = @(@{ id="c137"; name="Fabinho" }); existing_items = @(@{ id="i137"; name="Fan 160 2019"; cost=8500; status="disponivel" }) } `
    "create_trade" @{ customer="Fabinho"; item_out="Fan 160 2019"; item_in="XRE 300 2020"; trade_balance=8000; direction="paid"; cash_outflow=0; payable=@{ total_amount=8000; installments_count=4; installment_value=2000 } } `
    $false $null @{ cash_delta=0; receivables_delta=0; payables_delta=8000; inventory_delta=9500; gross_profit=0 }

Add-Scenario "SCEN_TP_009" "troca_com_volta_paga" "Peguei o tratorito do Seu Bento. Dei a roçadeira por 800 e paguei 2.200 no dinheiro." `
    @{ existing_customers = @(@{ id="c138"; name="Seu Bento" }); existing_items = @(@{ id="i138"; name="Roçadeira Stihl"; cost=600; status="disponivel" }) } `
    "create_trade" @{ customer="Seu Bento"; item_out="Roçadeira Stihl"; item_in="Tratorito Branco 7HP"; trade_balance=2200; direction="paid"; payment_method="cash"; cash_outflow=2200; payable=$null } `
    $false $null @{ cash_delta=-2200; receivables_delta=0; inventory_delta=2400; gross_profit=0 }

Add-Scenario "SCEN_TP_010" "troca_com_volta_paga" "Peguei a TV 75 do Cristiano. Entreguei a TV 50 por 1.800 e voltei 2 mil no Pix." `
    @{ existing_customers = @(@{ id="c139"; name="Cristiano" }); existing_items = @(@{ id="i139"; name="TV 50 Samsung"; cost=1400; status="disponivel" }) } `
    "create_trade" @{ customer="Cristiano"; item_out="TV 50 Samsung"; item_in="TV 75 LG Nanocell"; trade_balance=2000; direction="paid"; payment_method="pix"; cash_outflow=2000; payable=$null } `
    $false $null @{ cash_delta=-2000; receivables_delta=0; inventory_delta=2400; gross_profit=0 }

Add-Scenario "SCEN_TP_011" "troca_com_volta_paga" "Peguei a caminhonete S10 do Osvaldo. Dei o Uno por 14 mil e paguei 36 mil no TED." `
    @{ existing_customers = @(@{ id="c140"; name="Osvaldo" }); existing_items = @(@{ id="i140"; name="Uno Way 2011"; cost=11500; status="disponivel" }) } `
    "create_trade" @{ customer="Osvaldo"; item_out="Uno Way 2011"; item_in="Chevrolet S10 2013"; trade_balance=36000; direction="paid"; payment_method="bank_transfer"; cash_outflow=36000; payable=$null } `
    $false $null @{ cash_delta=-36000; receivables_delta=0; inventory_delta=38500; gross_profit=0 }

Add-Scenario "SCEN_TP_012" "troca_com_volta_paga" "Peguei o compressor parafuso do Juracy. Dei o compressor de pistão por 2 mil e paguei 5 mil no Pix." `
    @{ existing_customers = @(@{ id="c141"; name="Juracy" }); existing_items = @(@{ id="i141"; name="Compressor Pistao 20"; cost=1500; status="disponivel" }) } `
    "create_trade" @{ customer="Juracy"; item_out="Compressor Pistao 20"; item_in="Compressor Parafuso Schulz"; trade_balance=5000; direction="paid"; payment_method="pix"; cash_outflow=5000; payable=$null } `
    $false $null @{ cash_delta=-5000; receivables_delta=0; inventory_delta=5500; gross_profit=0 }

Add-Scenario "SCEN_TP_013" "troca_com_volta_paga" "Peguei o drone Mavic 3 do Heitor. Dei meu Mini 3 por 3.500 e voltei 4 mil em 4 parcelas de mil." `
    @{ existing_customers = @(@{ id="c142"; name="Heitor" }); existing_items = @(@{ id="i142"; name="DJI Mini 3 Pro"; cost=2900; status="disponivel" }) } `
    "create_trade" @{ customer="Heitor"; item_out="DJI Mini 3 Pro"; item_in="DJI Mavic 3"; trade_balance=4000; direction="paid"; cash_outflow=0; payable=@{ total_amount=4000; installments_count=4; installment_value=1000 } } `
    $false $null @{ cash_delta=0; receivables_delta=0; payables_delta=4000; inventory_delta=4600; gross_profit=0 }

Add-Scenario "SCEN_TP_014" "troca_com_volta_paga" "Peguei as rodas aro 20 do Leandro. Dei minhas rodas 17 por 1.500 e voltei 1.500 no dinheiro." `
    @{ existing_customers = @(@{ id="c143"; name="Leandro" }); existing_items = @(@{ id="i143"; name="Jogo Rodas 17"; cost=1100; status="disponivel" }) } `
    "create_trade" @{ customer="Leandro"; item_out="Jogo Rodas 17"; item_in="Jogo Rodas 20 Bmw"; trade_balance=1500; direction="paid"; payment_method="cash"; cash_outflow=1500; payable=$null } `
    $false $null @{ cash_delta=-1500; receivables_delta=0; inventory_delta=1900; gross_profit=0 }
