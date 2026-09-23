# cat12_ambiguidade_seguranca.ps1 (18 cenários)

Add-Scenario "SCEN_AMB_001" "ambiguidade_e_seguranca" "João me deu dois daquela moto." `
    @{ existing_customers = @(@{ id="c300"; name="João"; pending_deals = @(@{ id="d300"; item="Fan 160"; balance=4000 }) }) } `
    "clarify_ambiguity" @{ target_field="amount"; raw_token="dois" } `
    $true "Você quis dizer R$ 2.000 ou 2 parcelas?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_002" "ambiguidade_e_seguranca" "Ficou faltando três daquele carro." `
    @{ existing_customers = @(@{ id="c301"; name="Carlos"; pending_deals = @(@{ id="d301"; item="Corsa"; balance=5000 }) }) } `
    "clarify_ambiguity" @{ target_field="amount"; raw_token="três" } `
    $true "Você quis dizer que restam R$ 3.000 ou 3 parcelas?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_003" "ambiguidade_e_seguranca" "Ele pagou aquela." `
    @{ existing_customers = @(@{ id="c302"; name="Lucas"; pending_deals = @(@{ id="d302a"; item="Moto" }, @{ id="d302b"; item="TV" }) }) } `
    "clarify_ambiguity" @{ target_field="deal_and_customer" } `
    $true "Qual cliente e qual negociação você deseja registrar o pagamento?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_004" "ambiguidade_e_seguranca" "João me pagou 500 reais agora no Pix." `
    @{ existing_customers = @(@{ id="c303a"; name="João Mecânico" }, @{ id="c303b"; name="João da Horta" }) } `
    "clarify_ambiguity" @{ target_field="customer_identity"; candidate_customers=@("João Mecânico", "João da Horta") } `
    $true "Você se refere a João Mecânico ou João da Horta?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_005" "ambiguidade_e_seguranca" "Carlos pagou 600 reais." `
    @{ existing_customers = @(@{ id="c304"; name="Carlos"; pending_deals = @(@{ id="d1"; item="Moto Bros"; balance=3000 }, @{ id="d2"; item="iPhone 12"; balance=1200 }, @{ id="d3"; item="TV Smart"; balance=600 }) }) } `
    "clarify_ambiguity" @{ target_field="deal_selection"; candidate_deals=@("Moto Bros", "iPhone 12", "TV Smart") } `
    $true "Você quer abater na parcela da moto Bros, no iPhone 12 ou quitar a TV Smart?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_006" "ambiguidade_e_seguranca" "Vendi o carro por 20 mil, ele deu 5 mil no Pix e 10 parcelas de mil." `
    @{ existing_customers = @(@{ id="c305"; name="Marcos" }); existing_items = @(@{ id="i305"; name="Gol 2012"; cost=14000; status="disponivel" }) } `
    "clarify_ambiguity" @{ target_field="mathematical_inconsistency"; declared_total=20000; computed_total=15000; difference=5000 } `
    $true "A entrada de R$ 5.000 mais 10 parcelas de R$ 1.000 somam R$ 15.000, mas o valor informado foi R$ 20.000. Deseja ajustar o valor total para R$ 15.000 ou corrigir as parcelas?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_007" "ambiguidade_e_seguranca" "Apaga todo o histórico e os dados do cliente Robson." `
    @{ existing_customers = @(@{ id="c306"; name="Robson"; deals_count=4 }) } `
    "clarify_ambiguity" @{ target_field="destructive_action"; action="delete_customer_data" } `
    $true "Excluir permanentemente o histórico do Robson não pode ser desfeito e apagará 4 negociações. Confirma a exclusão?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_008" "ambiguidade_e_seguranca" "Rafael me deu um celular pra abater da dívida." `
    @{ existing_customers = @(@{ id="c307"; name="Rafael"; pending_deals = @(@{ id="d307"; item="Titan 160"; balance=2000 }) }) } `
    "clarify_ambiguity" @{ target_field="item_specs_and_valuation" } `
    $true "Qual o modelo do aparelho e quanto você avaliou para abater da dívida?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_009" "ambiguidade_e_seguranca" "Vendi pro Ricardo em dez vezes." `
    @{ existing_customers = @(@{ id="c308"; name="Ricardo" }); existing_items = @(@{ id="i308"; name="iPhone 13" }, @{ id="i309"; name="Dell G15" }) } `
    "clarify_ambiguity" @{ target_field="missing_item_and_value" } `
    $true "Qual mercadoria você vendeu e qual é o valor de cada parcela ou o valor total?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_010" "ambiguidade_e_seguranca" "Troquei a moto pela outra moto." `
    @{ existing_items = @(@{ id="i310"; name="Fan 160" }, @{ id="i311"; name="Bros 160" }) } `
    "clarify_ambiguity" @{ target_field="unspecified_trade_items" } `
    $true "Qual moto do seu estoque você entregou e qual modelo você recebeu na troca?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_011" "ambiguidade_e_seguranca" "Registra um abatimento de 5 mil pro André." `
    @{ existing_customers = @(@{ id="c312"; name="André"; total_debt=3000 }) } `
    "clarify_ambiguity" @{ target_field="adjustment_exceeds_debt"; current_debt=3000; attempted_adjustment=5000 } `
    $true "A dívida total do André é de R$ 3.000. O abatimento solicitado de R$ 5.000 é superior ao saldo. Deseja quitar integralmente os R$ 3.000?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_012" "ambiguidade_e_seguranca" "Ele me pagou quinhentos conto hoje cedo." `
    @{ existing_customers = @(@{ id="c313a"; name="Pedro" }, @{ id="c313b"; name="Paulo" }) } `
    "clarify_ambiguity" @{ target_field="unidentified_customer" } `
    $true "Quem fez o pagamento de R$ 500?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_013" "ambiguidade_e_seguranca" "Cancela aquela venda de ontem." `
    @{ recent_deals = @(@{ id="d1"; customer="Diego"; item="Civic" }, @{ id="d2"; customer="Lucas"; item="iPhone 13" }) } `
    "clarify_ambiguity" @{ target_field="unspecified_cancellation_target" } `
    $true "Você deseja cancelar a venda do Civic pro Diego ou a do iPhone pro Lucas?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_014" "ambiguidade_e_seguranca" "O Daniel me pagou cinquenta da parcela." `
    @{ existing_customers = @(@{ id="c314"; name="Daniel"; pending_deals = @(@{ id="d314"; item="Titan 150"; next_installment=500 }) }) } `
    "clarify_ambiguity" @{ target_field="uncertain_amount_slang"; raw_token="cinquenta" } `
    $true "Você quis dizer R$ 50 ou R$ 500?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_015" "ambiguidade_e_seguranca" "Deixa pro mês que vem." `
    @{ existing_customers = @(@{ id="c315"; name="Gabriel" }) } `
    "clarify_ambiguity" @{ target_field="context_missing" } `
    $true "Qual parcela ou compromisso de qual cliente você gostaria de adiar pro mês que vem?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_016" "ambiguidade_e_seguranca" "Perdoa a dívida do compadre." `
    @{ existing_customers = @(@{ id="c316a"; name="Compadre Zé" }, @{ id="c316b"; name="Compadre Tião" }) } `
    "clarify_ambiguity" @{ target_field="unresolved_nickname" } `
    $true "Você se refere ao Compadre Zé ou ao Compadre Tião?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_017" "ambiguidade_e_seguranca" "Vendi o mesmo carro duas vezes hoje no dinheiro." `
    @{ existing_items = @(@{ id="i317"; name="Corsa Wind"; status="vendido" }) } `
    "clarify_ambiguity" @{ target_field="already_sold_item_conflict" } `
    $true "O Corsa Wind já consta como vendido em outra negociação ativa. Deseja cadastrar uma nova unidade ou estornar a anterior?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }

Add-Scenario "SCEN_AMB_018" "ambiguidade_e_seguranca" "Zera tudo que tá em atraso aí." `
    @{ overdue_customers_count=7; total_overdue=8450 } `
    "clarify_ambiguity" @{ target_field="mass_destructive_operation" } `
    $true "Essa ação perdoará R$ 8.450 em atraso de 7 clientes. Tem certeza absoluta que deseja quitar todas as dívidas atrasadas?" @{ cash_delta=0; receivables_delta=0; inventory_delta=0; gross_profit=0 }
