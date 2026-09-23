# cat06_troca_com_volta_recebida.ps1 (18 cenários)

Add-Scenario "SCEN_TR_001" "troca_com_volta_recebida" "Passei minha XRE por 20 mil pro Renan, peguei a Fan dele por 12 mil e ele me voltou 8 mil no Pix." `
    @{ existing_customers = @(@{ id="c110"; name="Renan" }); existing_items = @(@{ id="i110"; name="XRE 300 2021"; cost=16000; status="disponivel" }) } `
    "create_trade" @{ customer="Renan"; item_out="XRE 300 2021"; item_in="Fan 160"; trade_balance=8000; direction="received"; payment_method="pix"; cash_inflow=8000; receivable=$null } `
    $false $null @{ cash_delta=8000; receivables_delta=0; inventory_delta=-4000; gross_profit=4000 }

Add-Scenario "SCEN_TR_002" "troca_com_volta_recebida" "Vendi o Civic por 50 mil pro Diego, peguei o Celta dele por 20 mil, 10 mil no Pix e 10 parcelas de mil." `
    @{ existing_customers = @(@{ id="c111"; name="Diego" }); existing_items = @(@{ id="i111"; name="Civic LXR 2014"; cost=42000; status="disponivel" }) } `
    "create_trade" @{ customer="Diego"; item_out="Civic LXR 2014"; item_in="Celta 2010"; trade_balance=30000; direction="received"; cash_inflow=10000; receivable=@{ total_amount=20000; installments_count=10; installment_value=1000 } } `
    $false $null @{ cash_delta=10000; receivables_delta=20000; inventory_delta=-22000; gross_profit=8000 }

Add-Scenario "SCEN_TR_003" "troca_com_volta_recebida" "Passei meu iPhone 14 Pro Max por 5.500 pro Gabriel. Peguei o iPhone 11 dele por 1.500 e 4 mil no Pix." `
    @{ existing_customers = @(@{ id="c112"; name="Gabriel" }); existing_items = @(@{ id="i112"; name="iPhone 14 Pro Max"; cost=4500; status="disponivel" }) } `
    "create_trade" @{ customer="Gabriel"; item_out="iPhone 14 Pro Max"; item_in="iPhone 11 64GB"; trade_balance=4000; direction="received"; payment_method="pix"; cash_inflow=4000; receivable=$null } `
    $false $null @{ cash_delta=4000; receivables_delta=0; inventory_delta=-3000; gross_profit=1000 }

Add-Scenario "SCEN_TR_004" "troca_com_volta_recebida" "Troquei minha Titan 160 na Biz do Paulinho. Peguei a Biz por 7 mil e ele me voltou 5 mil em 5 de mil." `
    @{ existing_customers = @(@{ id="c113"; name="Paulinho" }); existing_items = @(@{ id="i113"; name="Titan 160"; cost=9800; status="disponivel" }) } `
    "create_trade" @{ customer="Paulinho"; item_out="Titan 160"; item_in="Biz 110"; trade_balance=5000; direction="received"; cash_inflow=0; receivable=@{ total_amount=5000; installments_count=5; installment_value=1000 } } `
    $false $null @{ cash_delta=0; receivables_delta=5000; inventory_delta=-2800; gross_profit=2200 }

Add-Scenario "SCEN_TR_005" "troca_com_volta_recebida" "Passei o PlayStation 5 pro William, peguei o PS4 dele por mil e ele me deu mais 2.200 no dinheiro." `
    @{ existing_customers = @(@{ id="c114"; name="William" }); existing_items = @(@{ id="i114"; name="PlayStation 5"; cost=2600; status="disponivel" }) } `
    "create_trade" @{ customer="William"; item_out="PlayStation 5"; item_in="PlayStation 4 Slim"; trade_balance=2200; direction="received"; payment_method="cash"; cash_inflow=2200; receivable=$null } `
    $false $null @{ cash_delta=2200; receivables_delta=0; inventory_delta=-1600; gross_profit=600 }

Add-Scenario "SCEN_TR_006" "troca_com_volta_recebida" "Entreguei o notebook gamer pro Cláudio por 4.500. Peguei o notebook comum dele por 1.500 e 3 mil no Pix." `
    @{ existing_customers = @(@{ id="c115"; name="Cláudio" }); existing_items = @(@{ id="i115"; name="Acer Nitro 5"; cost=3600; status="disponivel" }) } `
    "create_trade" @{ customer="Cláudio"; item_out="Acer Nitro 5"; item_in="Notebook Samsung"; trade_balance=3000; direction="received"; payment_method="pix"; cash_inflow=3000; receivable=$null } `
    $false $null @{ cash_delta=3000; receivables_delta=0; inventory_delta=-2100; gross_profit=900 }

Add-Scenario "SCEN_TR_007" "troca_com_volta_recebida" "Vendi a Saveiro por 28 mil pro Renato. Peguei a motinha dele por 8 mil e 20 mil no TED." `
    @{ existing_customers = @(@{ id="c116"; name="Renato" }); existing_items = @(@{ id="i116"; name="Saveiro 2011"; cost=23000; status="disponivel" }) } `
    "create_trade" @{ customer="Renato"; item_out="Saveiro 2011"; item_in="Fan 125 2010"; trade_balance=20000; direction="received"; payment_method="bank_transfer"; cash_inflow=20000; receivable=$null } `
    $false $null @{ cash_delta=20000; receivables_delta=0; inventory_delta=-15000; gross_profit=5000 }

Add-Scenario "SCEN_TR_008" "troca_com_volta_recebida" "Passei meu iPhone 13 pro Sérgio. Peguei o celular Motorola dele por 600 reais e 2.200 no Pix." `
    @{ existing_customers = @(@{ id="c117"; name="Sérgio" }); existing_items = @(@{ id="i117"; name="iPhone 13 128GB"; cost=2200; status="disponivel" }) } `
    "create_trade" @{ customer="Sérgio"; item_out="iPhone 13 128GB"; item_in="Moto G22"; trade_balance=2200; direction="received"; payment_method="pix"; cash_inflow=2200; receivable=$null } `
    $false $null @{ cash_delta=2200; receivables_delta=0; inventory_delta=-1600; gross_profit=600 }

Add-Scenario "SCEN_TR_009" "troca_com_volta_recebida" "Troquei minha Twister pela Titan do Rogério. A Titan entrou por 9 mil e ele me voltou 6 mil no Pix." `
    @{ existing_customers = @(@{ id="c118"; name="Rogério" }); existing_items = @(@{ id="i118"; name="CB Twister 2019"; cost=12500; status="disponivel" }) } `
    "create_trade" @{ customer="Rogério"; item_out="CB Twister 2019"; item_in="Titan 160"; trade_balance=6000; direction="received"; payment_method="pix"; cash_inflow=6000; receivable=$null } `
    $false $null @{ cash_delta=6000; receivables_delta=0; inventory_delta=-3500; gross_profit=2500 }

Add-Scenario "SCEN_TR_010" "troca_com_volta_recebida" "Passei o gerador 5KVA pro Miltinho. Peguei o geradorzinho dele de 2KVA por mil e 2 mil no dinheiro." `
    @{ existing_customers = @(@{ id="c119"; name="Miltinho" }); existing_items = @(@{ id="i119"; name="Gerador 5KVA"; cost=2300; status="disponivel" }) } `
    "create_trade" @{ customer="Miltinho"; item_out="Gerador 5KVA"; item_in="Gerador 2KVA"; trade_balance=2000; direction="received"; payment_method="cash"; cash_inflow=2000; receivable=$null } `
    $false $null @{ cash_delta=2000; receivables_delta=0; inventory_delta=-1300; gross_profit=700 }

Add-Scenario "SCEN_TR_011" "troca_com_volta_recebida" "Entreguei a TV 65 pro Emerson. Peguei a TV 43 dele por 800 e 2 mil parcelado em 4 de 500." `
    @{ existing_customers = @(@{ id="c120"; name="Emerson" }); existing_items = @(@{ id="i120"; name="Smart TV 65 LG"; cost=2100; status="disponivel" }) } `
    "create_trade" @{ customer="Emerson"; item_out="Smart TV 65 LG"; item_in="Smart TV 43 AOC"; trade_balance=2000; direction="received"; cash_inflow=0; receivable=@{ total_amount=2000; installments_count=4; installment_value=500 } } `
    $false $null @{ cash_delta=0; receivables_delta=2000; inventory_delta=-1300; gross_profit=700 }

Add-Scenario "SCEN_TR_012" "troca_com_volta_recebida" "Troquei o drone DJI Air 2 pelo Mini 2 do Dudu. Ele me voltou 1.500 no Pix." `
    @{ existing_customers = @(@{ id="c121"; name="Dudu" }); existing_items = @(@{ id="i121"; name="DJI Air 2"; cost=3800; status="disponivel" }) } `
    "create_trade" @{ customer="Dudu"; item_out="DJI Air 2"; item_in="DJI Mini 2"; trade_balance=1500; direction="received"; payment_method="pix"; cash_inflow=1500; receivable=$null } `
    $false $null @{ cash_delta=1500; receivables_delta=0; inventory_delta=-2300; gross_profit=0 }

Add-Scenario "SCEN_TR_013" "troca_com_volta_recebida" "Passei meu Corsa pro Valdir. Peguei a moto dele por 5 mil e 7 mil no dinheiro à vista." `
    @{ existing_customers = @(@{ id="c122"; name="Valdir" }); existing_items = @(@{ id="i122"; name="Corsa Wind 2002"; cost=9000; status="disponivel" }) } `
    "create_trade" @{ customer="Valdir"; item_out="Corsa Wind 2002"; item_in="Ybr 125 2008"; trade_balance=7000; direction="received"; payment_method="cash"; cash_inflow=7000; receivable=$null } `
    $false $null @{ cash_delta=7000; receivables_delta=0; inventory_delta=-4000; gross_profit=3000 }

Add-Scenario "SCEN_TR_014" "troca_com_volta_recebida" "Vendi o compressor grande pro Alemão. Peguei o compressorzinho dele por 400 e 800 no Pix." `
    @{ existing_customers = @(@{ id="c123"; name="Alemão" }); existing_items = @(@{ id="i123"; name="Compressor 20 Pes"; cost=850; status="disponivel" }) } `
    "create_trade" @{ customer="Alemão"; item_out="Compressor 20 Pes"; item_in="Compressor Ar Direto"; trade_balance=800; direction="received"; payment_method="pix"; cash_inflow=800; receivable=$null } `
    $false $null @{ cash_delta=800; receivables_delta=0; inventory_delta=-450; gross_profit=350 }

Add-Scenario "SCEN_TR_015" "troca_com_volta_recebida" "Troquei as rodas aro 18 pelas 15 do Juliano. Ele me voltou 1.200 em 3 de 400 no cartão." `
    @{ existing_customers = @(@{ id="c124"; name="Juliano" }); existing_items = @(@{ id="i124"; name="Jogo Rodas 18"; cost=1700; status="disponivel" }) } `
    "create_trade" @{ customer="Juliano"; item_out="Jogo Rodas 18"; item_in="Jogo Rodas 15"; trade_balance=1200; direction="received"; cash_inflow=0; receivable=@{ total_amount=1200; installments_count=3; installment_value=400 } } `
    $false $null @{ cash_delta=0; receivables_delta=1200; inventory_delta=-500; gross_profit=700 }

Add-Scenario "SCEN_TR_016" "troca_com_volta_recebida" "Passei a roçadeira profissional pro Zezinho. Peguei o cortador de grama dele por 300 e 700 no dinheiro." `
    @{ existing_customers = @(@{ id="c125"; name="Zezinho" }); existing_items = @(@{ id="i125"; name="Roçadeira Kawashima"; cost=650; status="disponivel" }) } `
    "create_trade" @{ customer="Zezinho"; item_out="Roçadeira Kawashima"; item_in="Cortador de Grama"; trade_balance=700; direction="received"; payment_method="cash"; cash_inflow=700; receivable=$null } `
    $false $null @{ cash_delta=700; receivables_delta=0; inventory_delta=-350; gross_profit=350 }

Add-Scenario "SCEN_TR_017" "troca_com_volta_recebida" "Vendi o iPad Pro pro Daniel. Peguei o iPad normal dele por 1.200 e 2.800 no Pix." `
    @{ existing_customers = @(@{ id="c126"; name="Daniel" }); existing_items = @(@{ id="i126"; name="iPad Pro 11"; cost=3100; status="disponivel" }) } `
    "create_trade" @{ customer="Daniel"; item_out="iPad Pro 11"; item_in="iPad 9 64GB"; trade_balance=2800; direction="received"; payment_method="pix"; cash_inflow=2800; receivable=$null } `
    $false $null @{ cash_delta=2800; receivables_delta=0; inventory_delta=-1900; gross_profit=900 }

Add-Scenario "SCEN_TR_018" "troca_com_volta_recebida" "Troquei a serra fita pela meia esquadria do Nivaldo. Ele me voltou 900 no Pix." `
    @{ existing_customers = @(@{ id="c127"; name="Nivaldo" }); existing_items = @(@{ id="i127"; name="Serra Fita"; cost=1500; status="disponivel" }) } `
    "create_trade" @{ customer="Nivaldo"; item_out="Serra Fita"; item_in="Serra Meia Esquadria"; trade_balance=900; direction="received"; payment_method="pix"; cash_inflow=900; receivable=$null } `
    $false $null @{ cash_delta=900; receivables_delta=0; inventory_delta=-600; gross_profit=300 }
