# ⚖️ IA Jurídica

Assistente jurídico que roda **100% no seu computador**: IA local via [Ollama](https://ollama.com), base com toda a legislação brasileira do repositório [ctresb/leis](https://github.com/ctresb/leis), suas próprias anotações e documentos, e pesquisa na internet quando necessário. Sem mensalidade e sem enviar suas perguntas para serviços pagos.

## Como usar

1. Baixe o `IAJuridica.exe` da [última release](../../releases/latest) e execute.
2. Na primeira execução ele:
   - instala o Ollama, se ainda não estiver instalado;
   - baixa a versão mais recente do app e o catálogo de leis;
   - abre o navegador em `http://localhost:5178`.
3. Na aba **Modelos**, baixe um modelo de chat (ex.: `qwen3:4b`) e o de embeddings (`embeddinggemma`).

Toda vez que o `.exe` é aberto, ele verifica se há uma nova versão no GitHub e se atualiza sozinho. Os dados ficam em `%LOCALAPPDATA%\IAJuridica`.

> O Windows pode exibir um aviso do SmartScreen porque o executável não é assinado. Clique em "Mais informações" → "Executar assim mesmo".

## Funcionalidades

- **Chat com citações**: cada resposta mostra os trechos usados (lei, artigo e texto), com links para o original.
- **Base completa de leis**: catálogo pesquisável com cerca de 324 mil normas federais, estaduais e municipais. A Constituição e os principais códigos (CC, CPC, CP, CPP, CLT, CDC, CTN, ECA, LGPD…) são indexados na instalação, e as demais normas são baixadas e indexadas sob demanda quando a IA precisa delas.
- **Listar leis**: peça "liste as leis sobre X" ou use a aba **Leis**, que tem filtros por esfera, tipo, UF e ano.
- **Internet**: pesquisa automática para notícias, jurisprudência e alterações recentes. Pode ser ligada ou desligada a qualquer momento.
- **Sua base**: envie PDF, DOCX, TXT, MD ou HTML, cole textos ou salve páginas da web.
- **Modelos**: veja os modelos instalados com seus tamanhos, baixe modelos sugeridos com barra de progresso ou remova os que não usa mais.

## Arquitetura

```
IAJuridica.exe (launcher, Node SEA)
 ├─ instala/inicia Ollama
 ├─ baixa app-<versão>.zip da release mais recente
 └─ inicia server.cjs ──► http://localhost:5178
      ├─ Hono (API) + front React (Vite build)
      ├─ SQLite nativo do Node (node:sqlite)
      │    ├─ catalog.db  – índice FTS5 de todas as normas (release "catalog", atualizado semanalmente)
      │    └─ iajuridica.db – documentos, trechos, embeddings, conversas
      ├─ busca híbrida: FTS5 (palavras) + vetores em memória (semântica) + RRF
      └─ Ollama: chat, embeddings, download de modelos
```

O fluxo de uma pergunta tem estas etapas:

1. O modelo planeja a busca (intenção, termos, se precisa da web).
2. As leis citadas explicitamente ("art. 49 do CDC", "Lei 13.709/2018") são localizadas no catálogo e indexadas, se ainda não estiverem.
3. A busca híbrida reúne os trechos mais relevantes.
4. Se necessário, o app pesquisa na internet.
5. O modelo responde citando as fontes como [1], [2]…

## Desenvolvimento

Requer Node.js 24+.

```bash
npm install
npm run dev          # API em :5178 + Vite em :5173
npm run build        # dist/IAJuridica.exe + dist/app-<versão>.zip
```

Para testar o catálogo localmente, gere um a partir de um clone (parcial) de `ctresb/leis` e copie para `.data/`:

```bash
node scripts/build-catalog.mjs ../leis dist-catalog
```

### Publicar versão

```bash
npm version patch    # ou minor/major
git push --follow-tags
```

O workflow **Release** gera o `.exe` e o pacote do app. O workflow **Catálogo de leis** roda toda segunda-feira, ou manualmente em Actions.

## Aviso

As respostas têm caráter informativo e não substituem a orientação de um advogado. Os textos legais vêm de [ctresb/leis](https://github.com/ctresb/leis) e podem conter erros de OCR. Confira sempre a publicação oficial.
