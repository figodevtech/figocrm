# cat01_venda_a_vista.ps1 (18 cenários)

Add-Scenario "SCEN_VV_001" "venda_a_vista" "Vendi o iPhone 13 pro Lucas por 2.800 no Pix agora." `
    @{ existing_customers = @(@{ id="c1"; name="Lucas" }); existing_items = @(@{ id="i1"; name="iPhone 13"; cost=2200; status="disponivel" }) } `
    "create_sale" @{ customer="Lucas"; item="iPhone 13"; total_deal_value=2800; payment_method="pix"; cash_inflow=2800; receivable=$null } `
    $false $null @{ cash_delta=2800; receivables_delta=0; inventory_delta=-2200; gross_profit=600 }

Add-Scenario "SCEN_VV_002" "venda_a_vista" "Passei a Fan 160 pro Marcos por 11 mil no dinheiro vivo." `
    @{ existing_customers = @(@{ id="c2"; name="Marcos" }); existing_items = @(@{ id="i2"; name="Fan 160"; cost=9000; status="disponivel" }) } `
    "create_sale" @{ customer="Marcos"; item="Fan 160"; total_deal_value=11000; payment_method="cash"; cash_inflow=11000; receivable=$null } `
    $false $null @{ cash_delta=11000; receivables_delta=0; inventory_delta=-9000; gross_profit=2000 }

Add-Scenario "SCEN_VV_003" "venda_a_vista" "Vendi o notebook Dell pro Rodrigo por 3 mil e quinhentos no débito." `
    @{ existing_customers = @(@{ id="c3"; name="Rodrigo" }); existing_items = @(@{ id="i3"; name="Dell G15"; cost=2900; status="disponivel" }) } `
    "create_sale" @{ customer="Rodrigo"; item="Dell G15"; total_deal_value=3500; payment_method="debit_card"; cash_inflow=3500; receivable=$null } `
    $false $null @{ cash_delta=3500; receivables_delta=0; inventory_delta=-2900; gross_profit=600 }

Add-Scenario "SCEN_VV_004" "venda_a_vista" "Fechei o Celta 2010 com o Seu Jorge por 16 mil à vista no Pix." `
    @{ existing_customers = @(@{ id="c4"; name="Seu Jorge" }); existing_items = @(@{ id="i4"; name="Celta 2010"; cost=13500; status="disponivel" }) } `
    "create_sale" @{ customer="Seu Jorge"; item="Celta 2010"; total_deal_value=16000; payment_method="pix"; cash_inflow=16000; receivable=$null } `
    $false $null @{ cash_delta=16000; receivables_delta=0; inventory_delta=-13500; gross_profit=2500 }

Add-Scenario "SCEN_VV_005" "venda_a_vista" "Vendi o Apple Watch pro Bruno por mil e duzentos contos no Pix." `
    @{ existing_customers = @(@{ id="c5"; name="Bruno" }); existing_items = @(@{ id="i5"; name="Apple Watch Series 7"; cost=850; status="disponivel" }) } `
    "create_sale" @{ customer="Bruno"; item="Apple Watch Series 7"; total_deal_value=1200; payment_method="pix"; cash_inflow=1200; receivable=$null } `
    $false $null @{ cash_delta=1200; receivables_delta=0; inventory_delta=-850; gross_profit=350 }

Add-Scenario "SCEN_VV_006" "venda_a_vista" "Vendi o jogo de rodas 17 pro Tiago por dois pau em dinheiro." `
    @{ existing_customers = @(@{ id="c6"; name="Tiago" }); existing_items = @(@{ id="i6"; name="Rodas Aro 17"; cost=1400; status="disponivel" }) } `
    "create_sale" @{ customer="Tiago"; item="Rodas Aro 17"; total_deal_value=2000; payment_method="cash"; cash_inflow=2000; receivable=$null } `
    $false $null @{ cash_delta=2000; receivables_delta=0; inventory_delta=-1400; gross_profit=600 }

Add-Scenario "SCEN_VV_007" "venda_a_vista" "Passei a betoneira pro Valdir por 1.800 reais no Pix." `
    @{ existing_customers = @(@{ id="c7"; name="Valdir" }); existing_items = @(@{ id="i7"; name="Betoneira 400L"; cost=1200; status="disponivel" }) } `
    "create_sale" @{ customer="Valdir"; item="Betoneira 400L"; total_deal_value=1800; payment_method="pix"; cash_inflow=1800; receivable=$null } `
    $false $null @{ cash_delta=1800; receivables_delta=0; inventory_delta=-1200; gross_profit=600 }

Add-Scenario "SCEN_VV_008" "venda_a_vista" "Vendi a TV Samsung 55 pro Clayton por 2 mil e cem no Pix." `
    @{ existing_customers = @(@{ id="c8"; name="Clayton" }); existing_items = @(@{ id="i8"; name="Smart TV 55 Samsung"; cost=1600; status="disponivel" }) } `
    "create_sale" @{ customer="Clayton"; item="Smart TV 55 Samsung"; total_deal_value=2100; payment_method="pix"; cash_inflow=2100; receivable=$null } `
    $false $null @{ cash_delta=2100; receivables_delta=0; inventory_delta=-1600; gross_profit=500 }

Add-Scenario "SCEN_VV_009" "venda_a_vista" "Vendi a Titan 150 pro Daniel por 7 mil à vista em notas de cem." `
    @{ existing_customers = @(@{ id="c9"; name="Daniel" }); existing_items = @(@{ id="i9"; name="Titan 150 2014"; cost=5500; status="disponivel" }) } `
    "create_sale" @{ customer="Daniel"; item="Titan 150 2014"; total_deal_value=7000; payment_method="cash"; cash_inflow=7000; receivable=$null } `
    $false $null @{ cash_delta=7000; receivables_delta=0; inventory_delta=-5500; gross_profit=1500 }

Add-Scenario "SCEN_VV_010" "venda_a_vista" "Passei o PlayStation 5 pro Leo por 3.200 no Pix." `
    @{ existing_customers = @(@{ id="c10"; name="Leo" }); existing_items = @(@{ id="i10"; name="PlayStation 5"; cost=2600; status="disponivel" }) } `
    "create_sale" @{ customer="Leo"; item="PlayStation 5"; total_deal_value=3200; payment_method="pix"; cash_inflow=3200; receivable=$null } `
    $false $null @{ cash_delta=3200; receivables_delta=0; inventory_delta=-2600; gross_profit=600 }

Add-Scenario "SCEN_VV_011" "venda_a_vista" "Vendi o drone DJI pro Matheus por 4 mil redondo no Pix." `
    @{ existing_customers = @(@{ id="c11"; name="Matheus" }); existing_items = @(@{ id="i11"; name="Drone DJI Mini 3"; cost=3100; status="disponivel" }) } `
    "create_sale" @{ customer="Matheus"; item="Drone DJI Mini 3"; total_deal_value=4000; payment_method="pix"; cash_inflow=4000; receivable=$null } `
    $false $null @{ cash_delta=4000; receivables_delta=0; inventory_delta=-3100; gross_profit=900 }

Add-Scenario "SCEN_VV_012" "venda_a_vista" "Entreguei o gerador de energia pro Gilberto por 2.500 no dinheiro." `
    @{ existing_customers = @(@{ id="c12"; name="Gilberto" }); existing_items = @(@{ id="i12"; name="Gerador 3500W"; cost=1900; status="disponivel" }) } `
    "create_sale" @{ customer="Gilberto"; item="Gerador 3500W"; total_deal_value=2500; payment_method="cash"; cash_inflow=2500; receivable=$null } `
    $false $null @{ cash_delta=2500; receivables_delta=0; inventory_delta=-1900; gross_profit=600 }

Add-Scenario "SCEN_VV_013" "venda_a_vista" "Vendi a furadeira de bancada pro Nelson por 650 no Pix." `
    @{ existing_customers = @(@{ id="c13"; name="Nelson" }); existing_items = @(@{ id="i13"; name="Furadeira de Bancada"; cost=420; status="disponivel" }) } `
    "create_sale" @{ customer="Nelson"; item="Furadeira de Bancada"; total_deal_value=650; payment_method="pix"; cash_inflow=650; receivable=$null } `
    $false $null @{ cash_delta=650; receivables_delta=0; inventory_delta=-420; gross_profit=230 }

Add-Scenario "SCEN_VV_014" "venda_a_vista" "Fechei a saveiro com o Douglas por 32 mil integral no TED." `
    @{ existing_customers = @(@{ id="c14"; name="Douglas" }); existing_items = @(@{ id="i14"; name="Saveiro Cross 2013"; cost=27000; status="disponivel" }) } `
    "create_sale" @{ customer="Douglas"; item="Saveiro Cross 2013"; total_deal_value=32000; payment_method="bank_transfer"; cash_inflow=32000; receivable=$null } `
    $false $null @{ cash_delta=32000; receivables_delta=0; inventory_delta=-27000; gross_profit=5000 }

Add-Scenario "SCEN_VV_015" "venda_a_vista" "Vendi o iPad Air pro Caio por dois e quatrocentos no Pix." `
    @{ existing_customers = @(@{ id="c15"; name="Caio" }); existing_items = @(@{ id="i15"; name="iPad Air 4"; cost=1850; status="disponivel" }) } `
    "create_sale" @{ customer="Caio"; item="iPad Air 4"; total_deal_value=2400; payment_method="pix"; cash_inflow=2400; receivable=$null } `
    $false $null @{ cash_delta=2400; receivables_delta=0; inventory_delta=-1850; gross_profit=550 }

Add-Scenario "SCEN_VV_016" "venda_a_vista" "Vendi a roçadeira Stihl pro Agenor por mil reais no dinheiro." `
    @{ existing_customers = @(@{ id="c16"; name="Agenor" }); existing_items = @(@{ id="i16"; name="Roçadeira Stihl FS 160"; cost=700; status="disponivel" }) } `
    "create_sale" @{ customer="Agenor"; item="Roçadeira Stihl FS 160"; total_deal_value=1000; payment_method="cash"; cash_inflow=1000; receivable=$null } `
    $false $null @{ cash_delta=1000; receivables_delta=0; inventory_delta=-700; gross_profit=300 }

Add-Scenario "SCEN_VV_017" "venda_a_vista" "Passei o freezer horizontal pro Sandro por 1.300 no Pix." `
    @{ existing_customers = @(@{ id="c17"; name="Sandro" }); existing_items = @(@{ id="i17"; name="Freezer Consul 310L"; cost=900; status="disponivel" }) } `
    "create_sale" @{ customer="Sandro"; item="Freezer Consul 310L"; total_deal_value=1300; payment_method="pix"; cash_inflow=1300; receivable=$null } `
    $false $null @{ cash_delta=1300; receivables_delta=0; inventory_delta=-900; gross_profit=400 }

Add-Scenario "SCEN_VV_018" "venda_a_vista" "Vendi o compressor de ar pro Carlinhos por 850 reais no Pix." `
    @{ existing_customers = @(@{ id="c18"; name="Carlinhos" }); existing_items = @(@{ id="i18"; name="Compressor Chiaperini"; cost=550; status="disponivel" }) } `
    "create_sale" @{ customer="Carlinhos"; item="Compressor Chiaperini"; total_deal_value=850; payment_method="pix"; cash_inflow=850; receivable=$null } `
    $false $null @{ cash_delta=850; receivables_delta=0; inventory_delta=-550; gross_profit=300 }
