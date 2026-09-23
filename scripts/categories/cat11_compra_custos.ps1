# cat11_compra_custos.ps1 (16 cenários)

Add-Scenario "SCEN_CP_001" "compra_e_custos_adicionais" "Comprei um Gol 2012 por 18 mil no Pix do Seu Osvaldo." `
    @{ existing_customers = @(@{ id="c210"; name="Seu Osvaldo" }) } `
    "create_purchase" @{ supplier="Seu Osvaldo"; item_name="Gol 2012"; cost=18000; payment_method="pix"; cash_outflow=18000; payable=$null } `
    $false $null @{ cash_delta=-18000; receivables_delta=0; inventory_delta=18000; gross_profit=0 }

Add-Scenario "SCEN_CP_002" "compra_e_custos_adicionais" "Gastei 250 reais na troca de bateria do iPhone 12 que comprei ontem." `
    @{ existing_items = @(@{ id="i210"; name="iPhone 12 128GB"; cost=1900; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="iPhone 12 128GB"; cost_category="reparo"; description="Troca de bateria"; amount=250; payment_method="cash" } `
    $false $null @{ cash_delta=-250; receivables_delta=0; inventory_delta=250; gross_profit=0 }

Add-Scenario "SCEN_CP_003" "compra_e_custos_adicionais" "Paguei 400 de funilaria na Titan 160 do Zé no dinheiro." `
    @{ existing_items = @(@{ id="i211"; name="Titan 160"; cost=9000; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Titan 160"; cost_category="estetica"; description="Funilaria do tanque"; amount=400; payment_method="cash" } `
    $false $null @{ cash_delta=-400; receivables_delta=0; inventory_delta=400; gross_profit=0 }

Add-Scenario "SCEN_CP_004" "compra_e_custos_adicionais" "Comprei uma Fan 160 batida por 5 mil no dinheiro pra arrumar." `
    @{ existing_customers = @(@{ id="c211"; name="Carlão do Ferro Velho" }) } `
    "create_purchase" @{ supplier="Carlão do Ferro Velho"; item_name="Fan 160 Batida"; cost=5000; payment_method="cash"; cash_outflow=5000; payable=$null } `
    $false $null @{ cash_delta=-5000; receivables_delta=0; inventory_delta=5000; gross_profit=0 }

Add-Scenario "SCEN_CP_005" "compra_e_custos_adicionais" "Gastei 180 reais de laudo cautelar no Celta." `
    @{ existing_items = @(@{ id="i212"; name="Celta 2010"; cost=13000; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Celta 2010"; cost_category="documentacao"; description="Laudo cautelar veicular"; amount=180; payment_method="pix" } `
    $false $null @{ cash_delta=-180; receivables_delta=0; inventory_delta=180; gross_profit=0 }

Add-Scenario "SCEN_CP_006" "compra_e_custos_adicionais" "Paguei 350 reais no guincho pra trazer a Saveiro quebrada até a oficina." `
    @{ existing_items = @(@{ id="i213"; name="Saveiro Cross"; cost=25000; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Saveiro Cross"; cost_category="transporte"; description="Guincho mecânico"; amount=350; payment_method="pix" } `
    $false $null @{ cash_delta=-350; receivables_delta=0; inventory_delta=350; gross_profit=0 }

Add-Scenario "SCEN_CP_007" "compra_e_custos_adicionais" "Comprei um lote de 4 celulares quebrados por 1.200 reais no Pix pro desmanche de peças." `
    @{ existing_customers = @(@{ id="c212"; name="Mauricinho" }) } `
    "create_purchase" @{ supplier="Mauricinho"; item_name="Lote 4 Celulares Sucata"; cost=1200; payment_method="pix"; cash_outflow=1200; payable=$null } `
    $false $null @{ cash_delta=-1200; receivables_delta=0; inventory_delta=1200; gross_profit=0 }

Add-Scenario "SCEN_CP_008" "compra_e_custos_adicionais" "Gastei 600 reais de pneu novo dianteiro e traseiro na Bros 160." `
    @{ existing_items = @(@{ id="i214"; name="Bros 160"; cost=11500; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Bros 160"; cost_category="pecas"; description="Par de pneus novos Levorin"; amount=600; payment_method="pix" } `
    $false $null @{ cash_delta=-600; receivables_delta=0; inventory_delta=600; gross_profit=0 }

Add-Scenario "SCEN_CP_009" "compra_e_custos_adicionais" "Paguei 450 de taxa de transferência e despachante pro Palio." `
    @{ existing_items = @(@{ id="i215"; name="Palio Fire"; cost=12800; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Palio Fire"; cost_category="documentacao"; description="Taxa de transferência Detran"; amount=450; payment_method="pix" } `
    $false $null @{ cash_delta=-450; receivables_delta=0; inventory_delta=450; gross_profit=0 }

Add-Scenario "SCEN_CP_010" "compra_e_custos_adicionais" "Comprei um PlayStation 4 com leitor ruim por 800 conto do Lucas." `
    @{ existing_customers = @(@{ id="c213"; name="Lucas" }) } `
    "create_purchase" @{ supplier="Lucas"; item_name="PlayStation 4 Defeito"; cost=800; payment_method="cash"; cash_outflow=800; payable=$null } `
    $false $null @{ cash_delta=-800; receivables_delta=0; inventory_delta=800; gross_profit=0 }

Add-Scenario "SCEN_CP_011" "compra_e_custos_adicionais" "Gastei 120 reais no leitor ótico novo pro PS4." `
    @{ existing_items = @(@{ id="i216"; name="PlayStation 4 Defeito"; cost=800; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="PlayStation 4 Defeito"; cost_category="pecas"; description="Leitor ótico KEM-490"; amount=120; payment_method="pix" } `
    $false $null @{ cash_delta=-120; receivables_delta=0; inventory_delta=120; gross_profit=0 }

Add-Scenario "SCEN_CP_012" "compra_e_custos_adicionais" "Paguei 300 reais na revisão e troca de óleo do compressor Chiaperini." `
    @{ existing_items = @(@{ id="i217"; name="Compressor Chiaperini"; cost=1400; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Compressor Chiaperini"; cost_category="reparo"; description="Troca de óleo e revisão geral"; amount=300; payment_method="cash" } `
    $false $null @{ cash_delta=-300; receivables_delta=0; inventory_delta=300; gross_profit=0 }

Add-Scenario "SCEN_CP_013" "compra_e_custos_adicionais" "Comprei uma roçadeira Stihl usada por 450 no dinheiro." `
    @{ existing_customers = @(@{ id="c214"; name="Seu Dito" }) } `
    "create_purchase" @{ supplier="Seu Dito"; item_name="Roçadeira Stihl Usada"; cost=450; payment_method="cash"; cash_outflow=450; payable=$null } `
    $false $null @{ cash_delta=-450; receivables_delta=0; inventory_delta=450; gross_profit=0 }

Add-Scenario "SCEN_CP_014" "compra_e_custos_adicionais" "Gastei 80 reais na lâmina nova e no carretel de nylon pra roçadeira." `
    @{ existing_items = @(@{ id="i218"; name="Roçadeira Stihl Usada"; cost=450; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Roçadeira Stihl Usada"; cost_category="pecas"; description="Lâmina de 3 pontas e carretel nylon"; amount=80; payment_method="pix" } `
    $false $null @{ cash_delta=-80; receivables_delta=0; inventory_delta=80; gross_profit=0 }

Add-Scenario "SCEN_CP_015" "compra_e_custos_adicionais" "Paguei 250 de polimento comercial e higienização interna no Uno Mille." `
    @{ existing_items = @(@{ id="i219"; name="Uno Mille"; cost=8500; status="em_preparacao" }) } `
    "add_item_cost" @{ item_name="Uno Mille"; cost_category="estetica"; description="Polimento técnico e higienização"; amount=250; payment_method="cash" } `
    $false $null @{ cash_delta=-250; receivables_delta=0; inventory_delta=250; gross_profit=0 }

Add-Scenario "SCEN_CP_016" "compra_e_custos_adicionais" "Comprei um gerador Toyama 3000 por 1.400 reais no Pix do Juliano." `
    @{ existing_customers = @(@{ id="c215"; name="Juliano" }) } `
    "create_purchase" @{ supplier="Juliano"; item_name="Gerador Toyama 3000"; cost=1400; payment_method="pix"; cash_outflow=1400; payable=$null } `
    $false $null @{ cash_delta=-1400; receivables_delta=0; inventory_delta=1400; gross_profit=0 }
