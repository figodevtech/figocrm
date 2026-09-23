# Benchmark Oficial da IA — FigoCRM (Fase 35)

Suíte de avaliação contínua e objetiva da inteligência conversacional do FigoCRM contra centenas de casos de teste canônicos, adversariais e dialetos reais de revendedores e vendedores independentes.

---

## Estrutura do Benchmark

```text
tests/voice-benchmark/
  cases.json       # 400 cenários rotulados (vendas, trocas, parcelas, abatimentos, ambiguidades)
  runner.ts        # Benchmark do parser determinístico (guardrail/fallback)
  runner-llm.ts    # Benchmark do interpretador de produção com LLM real
  scoring.ts       # Comparação de campos críticos e métricas (compartilhado)
  reports/         # Relatórios JSON do benchmark LLM (ignorado pelo git)
  README.md        # Esta documentação
```

---

## Distribuição dos 400 Cenários

| Categoria | Quantidade | Foco de Validação |
| :--- | :---: | :--- |
| `venda_a_vista` | 40 | Pix, dinheiro vivo, transferência, baixa imediata |
| `venda_parcelada` | 50 | Entrada + parcelas, promissória, dia fixo |
| `recebimento` | 50 | Pagamentos parciais, quitação, adiantamento |
| `troca_seca` | 50 | Permuta pau a pau sem movimentação financeira |
| `troca_com_volta` | 50 | Volta recebida vs volta paga vs parcelada |
| `abatimento` | 40 | Entrada de item como abatimento ou serviço |
| `renegociacao` | 40 | Prorrogação de vencimento e consolidação |
| `ambiguidade` | 40 | Casos adversariais ("me deu dois", "apaga tudo") |
| `consulta` | 40 | Saldos na rua, atrasados, lucratividade |

---

## Metas Oficiais e Critérios de Aceite

| Métrica | Meta Mínima | Objetivo |
| :--- | :---: | :--- |
| **Unsafe Execution Rate** | **0.0%** | **Tolerância Zero**: Nenhuma ação de risco deve rodar sem confirmação |
| **Intent Accuracy** | >= 97.0% | Identificação correta da intenção de negócio |
| **Direction Accuracy** | >= 99.0% | Reconhecimento infalível de quem recebe ou paga na permuta |
| **Ambiguity Detection** | >= 95.0% | Detecção de fala incompleta ou ambígua antes de gravar |
| **Full Scenario Accuracy**| >= 90.0% | Fechamento integral do cenário ponta a ponta |

---

## Como Executar

```bash
# Parser determinístico (sem custo, roda no `npm run test`)
npm run test:benchmark:rules

# Interpretador de produção com LLM real (requer OPENAI_API_KEY ou GEMINI_API_KEY)
npm run test:benchmark:llm -- --limit=50
npm run test:benchmark:llm -- --category=troca_com_volta --limit=10
npm run test:benchmark:llm -- --sample=40 --seed=7 --concurrency=4
```

O interpretador nunca recebe `category` nem `expected`: eles só são usados na pontuação.
Um cenário só conta como correto se **todos** os campos críticos presentes no dataset baterem
(intent, cliente, itens, valores, direção, parcelas, confirmação, ambiguidade).
**Execução insegura** = o comando executaria quando deveria perguntar, ou executaria com
intenção, cliente ou valor divergente. Meta obrigatória: 0%.

> Limitação conhecida: o dataset é gerado a partir de poucos modelos de frase por categoria
> (ex.: 2 modelos em `recebimento`). 100% no benchmark de regras mede cobertura desses modelos,
> não generalização. Novos cenários com fala real devem ser adicionados antes de usar o número
> como indicador de qualidade da LLM.
