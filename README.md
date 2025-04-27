# Gerenciador de Comentários do YouTube

Esta é uma extensão do Chrome desenvolvida para ajudar criadores de conteúdo do YouTube a gerenciar os comentários em seus vídeos. Ela permite buscar comentários por palavra-chave, filtrar por uma lista de exclusão e excluí-los em massa.

## Funcionalidades

*   **Login com Google:** Autentica o usuário usando a conta Google associada ao canal do YouTube.
*   **Busca por Palavra-chave:** Encontra todos os comentários (incluindo respostas) que contêm uma palavra-chave específica em todos os vídeos do canal.
*   **Lista de Exclusão:** Permite definir palavras-chave (separadas por vírgula) que, se presentes no comentário, impedem que ele seja selecionado para exclusão, mesmo que contenha a palavra-chave principal da busca.
*   **Modo "Dry Run" (Simulação):** Permite visualizar quais comentários seriam excluídos sem realmente realizar a exclusão. Útil para testes e verificação.
*   **Exclusão em Massa:** Exclui os comentários selecionados de forma eficiente.
*   **Visualização Organizada:** Exibe os resultados agrupados por vídeo.
*   **Barra de Progresso:** Mostra o progresso durante a busca e a exclusão.
*   **Salvar/Carregar Resultados:** Permite salvar os resultados de uma busca (incluindo a palavra-chave e lista de exclusão usadas) e carregá-los posteriormente para continuar a análise ou exclusão.
*   **Controle de Cota:** Exibe uma estimativa do uso da cota da API do YouTube.

## Instalação

Como esta extensão não está publicada na Chrome Web Store, você precisa carregá-la manualmente:

1.  **Baixe o código-fonte:** Clone ou faça o download deste repositório para o seu computador.
2.  **Abra o Chrome:** Inicie o navegador Google Chrome.
3.  **Acesse as Extensões:** Digite `chrome://extensions` na barra de endereço e pressione Enter.
4.  **Ative o Modo de Desenvolvedor:** No canto superior direito da página de extensões, ative o "Modo de desenvolvedor".
5.  **Carregar sem Compactação:** Clique no botão "Carregar sem compactação".
6.  **Selecione a Pasta:** Navegue até a pasta onde você salvou o código-fonte da extensão e selecione-a.
7.  **Pronto!** A extensão deve aparecer na lista e estar pronta para uso.

## Como Usar

1.  **Clique no Ícone:** Clique no ícone da extensão (que aparecerá na barra de ferramentas do Chrome) para abrir o popup.
2.  **Login:** Clique em "Login com Google" e autorize a extensão a acessar sua conta do YouTube. O status mudará para "Conectado".
3.  **Digite a Palavra-chave:** No campo "Palavra-chave", insira o termo que você deseja buscar nos comentários.
4.  **(Opcional) Lista de Exclusão:** No campo "Lista de Exclusão", insira palavras (separadas por vírgula) que devem *impedir* a seleção de um comentário. Ex: `ótimo,obrigado,parabéns`.
5.  **(Opcional) Dry Run:** Marque a caixa "Dry Run (Apenas Simulação)" se você quiser apenas ver quais comentários seriam selecionados, sem excluí-los.
6.  **Buscar:** Clique em "Buscar Comentários". A extensão percorrerá todos os vídeos do seu canal e seus respectivos comentários. O progresso será exibido.
7.  **Analisar Resultados:** Os comentários encontrados serão exibidos, agrupados por vídeo. O número total de comentários encontrados é mostrado.
8.  **Selecionar:** Marque as caixas de seleção ao lado dos comentários que você deseja excluir. Use os botões "Selecionar Todos" ou "Desmarcar Todos" para facilitar.
9.  **Excluir (ou Simular):**
    *   Se o modo "Dry Run" estiver **desativado**, clicar em "Deletar Selecionados" iniciará o processo de exclusão real. Uma confirmação será solicitada.
    *   Se o modo "Dry Run" estiver **ativado**, clicar em "Deletar Selecionados" apenas mostrará uma mensagem indicando quantos comentários seriam excluídos, sem fazer alterações.
10. **Salvar Resultados:** Se desejar, clique em "Salvar Resultados" para guardar a busca atual (palavra-chave, exclusões e comentários encontrados) para uso futuro.
11. **Carregar Resultados:** Clique em "Carregar Resultados" para restaurar a última busca salva.

## Notas Importantes

*   **Cota da API do YouTube:** A API do YouTube tem limites de uso diários (cota). Operações de busca e, principalmente, exclusão consomem essa cota. A exclusão de um único comentário custa 50 unidades. Use com moderação para evitar exceder o limite diário.
*   **Desempenho:** A busca pode demorar dependendo do número de vídeos e comentários no seu canal.
*   **Permissões:** A extensão solicita permissão para acessar seus dados do YouTube para poder ler e excluir comentários.
*   **Sem Garantias:** Use esta extensão por sua conta e risco. Faça backups ou use o modo "Dry Run" antes de realizar exclusões em massa definitivas.

## Estrutura do Código

*   `manifest.json`: Define as configurações, permissões e metadados da extensão.
*   `popup.html`: Estrutura da interface do usuário (o popup da extensão).
*   `popup.css`: Estilos visuais para a interface.
*   `popup.js`: Lógica da interface do usuário, manipulação de eventos e comunicação com o background script.
*   `background.js`: Service worker que executa as tarefas pesadas em segundo plano (chamadas de API, processamento de dados).
