# cat05_troca_seca.ps1 (12 cenários)

Add-Scenario "SCEN_TS_001" "troca_seca" "Troquei pau a pau meu iPhone 13 pelo Galaxy S23 do Felipe." `
    @{ existing_customers = @(@{ id="c90"; name="Felipe" }); existing_items = @(@{ id="i90"; name="iPhone 13"; cost=2400; status="disponivel" }) } `
    "create_trade" @{ customer="Felipe"; item_out="iPhone 13"; item_in="Galaxy S23"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_002" "troca_seca" "Fiz chave na chave na Titan pela Fazer 150 do Samuel, sem volta." `
    @{ existing_customers = @(@{ id="c91"; name="Samuel" }); existing_items = @(@{ id="i91"; name="Titan 160"; cost=10500; status="disponivel" }) } `
    "create_trade" @{ customer="Samuel"; item_out="Titan 160"; item_in="Fazer 150"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_003" "troca_seca" "Troquei meu PlayStation 5 pelo notebook Dell do Gustavo pau a pau." `
    @{ existing_customers = @(@{ id="c92"; name="Gustavo" }); existing_items = @(@{ id="i92"; name="PlayStation 5"; cost=2700; status="disponivel" }) } `
    "create_trade" @{ customer="Gustavo"; item_out="PlayStation 5"; item_in="Notebook Dell"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_004" "troca_seca" "Passei meu Celta no Gol G4 do Robson sem volta nenhuma pra nenhum dos lados." `
    @{ existing_customers = @(@{ id="c93"; name="Robson" }); existing_items = @(@{ id="i93"; name="Celta 2008"; cost=12000; status="disponivel" }) } `
    "create_trade" @{ customer="Robson"; item_out="Celta 2008"; item_in="Gol G4 2008"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_005" "troca_seca" "Troquei minha betoneira pelo compressor de ar do Leandro mano a mano." `
    @{ existing_customers = @(@{ id="c94"; name="Leandro" }); existing_items = @(@{ id="i94"; name="Betoneira 400L"; cost=1500; status="disponivel" }) } `
    "create_trade" @{ customer="Leandro"; item_out="Betoneira 400L"; item_in="Compressor de Ar"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_006" "troca_seca" "Troquei o Apple Watch Ultra pelo drone DJI do Alan pau a pau." `
    @{ existing_customers = @(@{ id="c95"; name="Alan" }); existing_items = @(@{ id="i95"; name="Apple Watch Ultra"; cost=3500; status="disponivel" }) } `
    "create_trade" @{ customer="Alan"; item_out="Apple Watch Ultra"; item_in="Drone DJI"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_007" "troca_seca" "Passei meu gerador pela máquina de solda inversora do Maurício sem mexer em dinheiro." `
    @{ existing_customers = @(@{ id="c96"; name="Maurício" }); existing_items = @(@{ id="i96"; name="Gerador 3500W"; cost=1800; status="disponivel" }) } `
    "create_trade" @{ customer="Maurício"; item_out="Gerador 3500W"; item_in="Máquina Solda Inversora"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_008" "troca_seca" "Troquei o iPad Pro pelo MacBook Air do Vítor mano a mano." `
    @{ existing_customers = @(@{ id="c97"; name="Vítor" }); existing_items = @(@{ id="i97"; name="iPad Pro M1"; cost=4200; status="disponivel" }) } `
    "create_trade" @{ customer="Vítor"; item_out="iPad Pro M1"; item_in="MacBook Air M1"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_009" "troca_seca" "Troquei a Biz 125 pela Pop 110 do Danilo pau a pau." `
    @{ existing_customers = @(@{ id="c98"; name="Danilo" }); existing_items = @(@{ id="i98"; name="Biz 125 2016"; cost=6800; status="disponivel" }) } `
    "create_trade" @{ customer="Danilo"; item_out="Biz 125 2016"; item_in="Pop 110 2021"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_010" "troca_seca" "Fiz chave na chave na carretinha pelo reboque fechado do Osmar." `
    @{ existing_customers = @(@{ id="c99"; name="Osmar" }); existing_items = @(@{ id="i99"; name="Carretinha Aberta"; cost=2200; status="disponivel" }) } `
    "create_trade" @{ customer="Osmar"; item_out="Carretinha Aberta"; item_in="Reboque Fechado"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_011" "troca_seca" "Troquei a caixa de som JBL Boombox pelo projetor do Danilo sem volta." `
    @{ existing_customers = @(@{ id="c100"; name="Danilo"; alias="Danilo Projetor" }); existing_items = @(@{ id="i100"; name="JBL Boombox 3"; cost=1800; status="disponivel" }) } `
    "create_trade" @{ customer="Danilo"; item_out="JBL Boombox 3"; item_in="Projetor Wanbo"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_TS_012" "troca_seca" "Passei meu motor de popa pelo caiaque a pedal do Jonas pau a pau." `
    @{ existing_customers = @(@{ id="c101"; name="Jonas" }); existing_items = @(@{ id="i101"; name="Motor Popa 3.3HP"; cost=2500; status="disponivel" }) } `
    "create_trade" @{ customer="Jonas"; item_out="Motor Popa 3.3HP"; item_in="Caiaque a Pedal"; trade_balance=0; direction="even" } `
    $false $null @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }
