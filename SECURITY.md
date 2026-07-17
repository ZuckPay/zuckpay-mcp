# Política de Segurança

## Reportando vulnerabilidades

Encontrou uma vulnerabilidade no zuckpay-mcp ou na API ZuckPay?

- **NÃO** abra issue pública com detalhes exploráveis.
- Envie os detalhes para o suporte oficial da ZuckPay pelo painel (chat/ticket), marcando como "segurança".
- Inclua: versão do pacote, passos de reprodução e impacto estimado.

Responderemos o mais rápido possível e daremos crédito na correção, se desejado.

## Garantias de projeto

Este servidor foi desenhado com as seguintes invariantes — qualquer quebra delas é considerada vulnerabilidade:

1. Credenciais nunca aparecem em: argumentos de processo, stdout/stderr, resultados de tool, mensagens de erro ou repositório.
2. Toda string que sai do processo passa por máscara de segredos (client_id, client_secret e suas formas base64).
3. Nenhum campo fornecido pelo modelo chega à API sem validação zod estrita; o corpo é montado por allowlist.
4. Requisições POST (que movimentam dinheiro) jamais são repetidas automaticamente.
5. A tool de saque não existe sem opt-in explícito via variável de ambiente.
6. Dados de cartão (PAN/CVV) não trafegam por este servidor em hipótese alguma.
7. O processo não usa `eval`, `child_process`, nem escreve em disco; é 100% stateless.

## Escopo

Este repositório cobre apenas o cliente MCP. Vulnerabilidades do gateway/API ZuckPay em si devem ser reportadas pelo mesmo canal, mas são tratadas pela equipe da plataforma.
