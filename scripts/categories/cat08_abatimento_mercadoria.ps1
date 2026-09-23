# cat08_abatimento_mercadoria.ps1 (12 cenários)

Add-Scenario "SCEN_AM_001" "abatimento_mercadoria" "Rafael me deu uma caixa de som de 400 reais para abater da dívida da moto." `
    @{ existing_customers = @(@{ id="c150"; name="Rafael"; pending_deals = @(@{ id="d150"; item="Bros 160"; balance=3000 }) }) } `
    "register_adjustment" @{ customer="Rafael"; deal_reference="Bros 160"; adjustment_type="item_trade_in"; item_in="Caixa de Som JBL"; item_evaluated_value=400; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-400; inventory_delta=400; gross_profit=0 }

Add-Scenario "SCEN_AM_002" "abatimento_mercadoria" "O Marcos me deu um iPhone 11 avaliado em 1.500 pra abater na conta do carro." `
    @{ existing_customers = @(@{ id="c151"; name="Marcos"; pending_deals = @(@{ id="d151"; item="Corsa Sedan"; balance=6000 }) }) } `
    "register_adjustment" @{ customer="Marcos"; deal_reference="Corsa Sedan"; adjustment_type="item_trade_in"; item_in="iPhone 11 64GB"; item_evaluated_value=1500; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-1500; inventory_delta=1500; gross_profit=0 }

Add-Scenario "SCEN_AM_003" "abatimento_mercadoria" "Pedrão me entregou uma furadeira de impacto de 300 reais pra abater do fiado." `
    @{ existing_customers = @(@{ id="c152"; name="Pedrão"; total_debt=700 }) } `
    "register_adjustment" @{ customer="Pedrão"; deal_reference=$null; adjustment_type="item_trade_in"; item_in="Furadeira Impacto Bosch"; item_evaluated_value=300; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-300; inventory_delta=300; gross_profit=0 }

Add-Scenario "SCEN_AM_004" "abatimento_mercadoria" "Lucas me deu um Apple Watch de 800 contos pra amortizar a parcela do notebook." `
    @{ existing_customers = @(@{ id="c153"; name="Lucas"; pending_deals = @(@{ id="d153"; item="Dell G15"; balance=1800 }) }) } `
    "register_adjustment" @{ customer="Lucas"; deal_reference="Dell G15"; adjustment_type="item_trade_in"; item_in="Apple Watch Series 6"; item_evaluated_value=800; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-800; inventory_delta=800; gross_profit=0 }

Add-Scenario "SCEN_AM_005" "abatimento_mercadoria" "Valdir me entregou um compressor de ar por 600 reais pra abater na dívida da betoneira." `
    @{ existing_customers = @(@{ id="c154"; name="Valdir"; pending_deals = @(@{ id="d154"; item="Betoneira"; balance=1200 }) }) } `
    "register_adjustment" @{ customer="Valdir"; deal_reference="Betoneira"; adjustment_type="item_trade_in"; item_in="Compressor Ar Direto"; item_evaluated_value=600; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-600; inventory_delta=600; gross_profit=0 }

Add-Scenario "SCEN_AM_006" "abatimento_mercadoria" "Tiago me passou um jogo de rodas aro 15 avaliado em 800 pra diminuir o saldo da moto." `
    @{ existing_customers = @(@{ id="c155"; name="Tiago"; pending_deals = @(@{ id="d155"; item="Titan 160"; balance=4000 }) }) } `
    "register_adjustment" @{ customer="Tiago"; deal_reference="Titan 160"; adjustment_type="item_trade_in"; item_in="Jogo Rodas Aro 15"; item_evaluated_value=800; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-800; inventory_delta=800; gross_profit=0 }

Add-Scenario "SCEN_AM_007" "abatimento_mercadoria" "Ricardo me deu uma TV de 32 polegadas por 500 reais pra abater da dívida da TV grande." `
    @{ existing_customers = @(@{ id="c156"; name="Ricardo"; pending_deals = @(@{ id="d156"; item="Smart TV 50"; balance=1000 }) }) } `
    "register_adjustment" @{ customer="Ricardo"; deal_reference="Smart TV 50"; adjustment_type="item_trade_in"; item_in="TV 32 Samsung"; item_evaluated_value=500; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-500; inventory_delta=500; gross_profit=0 }

Add-Scenario "SCEN_AM_008" "abatimento_mercadoria" "O Seu Jorge me entregou uma bicicleta aro 29 por 700 reais pra abater no Celta." `
    @{ existing_customers = @(@{ id="c157"; name="Seu Jorge"; pending_deals = @(@{ id="d157"; item="Celta 2010"; balance=4000 }) }) } `
    "register_adjustment" @{ customer="Seu Jorge"; deal_reference="Celta 2010"; adjustment_type="item_trade_in"; item_in="Bicicleta Aro 29 KSW"; item_evaluated_value=700; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-700; inventory_delta=700; gross_profit=0 }

Add-Scenario "SCEN_AM_009" "abatimento_mercadoria" "Wesley me passou um PlayStation 4 por mil reais pra abater duas parcelas da Titan." `
    @{ existing_customers = @(@{ id="c158"; name="Wesley"; pending_deals = @(@{ id="d158"; item="Titan 160"; balance=5000 }) }) } `
    "register_adjustment" @{ customer="Wesley"; deal_reference="Titan 160"; adjustment_type="item_trade_in"; item_in="PlayStation 4 Fat"; item_evaluated_value=1000; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-1000; inventory_delta=1000; gross_profit=0 }

Add-Scenario "SCEN_AM_010" "abatimento_mercadoria" "O Mestre Cícero me deu uma serra mármore Makita avaliada em 350 pra abater do saldo da betoneira." `
    @{ existing_customers = @(@{ id="c159"; name="Mestre Cícero"; pending_deals = @(@{ id="d159"; item="Betoneira"; balance=800 }) }) } `
    "register_adjustment" @{ customer="Mestre Cícero"; deal_reference="Betoneira"; adjustment_type="item_trade_in"; item_in="Serra Mármore Makita"; item_evaluated_value=350; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-350; inventory_delta=350; gross_profit=0 }

Add-Scenario "SCEN_AM_011" "abatimento_mercadoria" "Gilmar me deu um jogo de pneus meia vida por 400 contos pra abater da promissória do Uno." `
    @{ existing_customers = @(@{ id="c160"; name="Gilmar"; pending_deals = @(@{ id="d160"; item="Uno Mille"; balance=3000 }) }) } `
    "register_adjustment" @{ customer="Gilmar"; deal_reference="Uno Mille"; adjustment_type="item_trade_in"; item_in="4 Pneus Meia Vida 175/70"; item_evaluated_value=400; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-400; inventory_delta=400; gross_profit=0 }

Add-Scenario "SCEN_AM_012" "abatimento_mercadoria" "Patrick me entregou um frigobar de 500 reais pra abater da dívida do ar condicionado." `
    @{ existing_customers = @(@{ id="c161"; name="Patrick"; pending_deals = @(@{ id="d161"; item="Split Elgin"; balance=900 }) }) } `
    "register_adjustment" @{ customer="Patrick"; deal_reference="Split Elgin"; adjustment_type="item_trade_in"; item_in="Frigobar Consul"; item_evaluated_value=500; cash_movement=0 } `
    $false $null @{ cash_delta=0; receivables_delta=-500; inventory_delta=500; gross_profit=0 }
