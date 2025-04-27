// popup.js - Lógica da Interface do Usuário da Extensão
// Este script gerencia a interação do usuário com a popup (popup.html) e
// se comunica com o background script (background.js) para tarefas pesadas.

// --- Elementos da UI --- 
// Obtém referências para os elementos HTML importantes
const loginBtn = document.getElementById('login-btn');
const loginStatusSpan = document.getElementById('login-status');
const keywordInput = document.getElementById('keyword');
const searchBtn = document.getElementById('search-btn');
const searchStatsSpan = document.getElementById('search-stats');
const dryRunCheckbox = document.getElementById('dry-run-checkbox');
const exclusionListInput = document.getElementById('exclusion-list');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressStatusText = document.getElementById('progress-status-text');
const resultsContainer = document.getElementById('results-container');
const resultsHeader = document.getElementById('results-header');
const commentCountSpan = document.getElementById('comment-count');
const selectAllBtn = document.getElementById('select-all-btn');
const unselectAllBtn = document.getElementById('unselect-all-btn');
const deleteSelectedBtn = document.getElementById('delete-selected-btn');
const deleteWarningSpan = document.getElementById('delete-warning');
const saveResultsBtn = document.getElementById('save-results-btn');
const loadResultsBtn = document.getElementById('load-results-btn');
const loadStatusSpan = document.getElementById('load-status');
const resultsDiv = document.getElementById('results');
const quotaInfoDiv = document.getElementById('quota-info');

// --- Variáveis de Estado do Popup ---
let isLoggedIn = false; // Indica se o usuário está logado
let currentSearchResults = []; // Armazena os resultados da busca atual (lista plana)
let currentGroupedResults = {}; // Armazena os resultados agrupados por vídeo
let operationInProgress = false; // Flag geral para busca ou exclusão

// --- Funções de Atualização da UI ---

/**
 * Atualiza o status visual do login.
 * @param {boolean} loggedIn - True se logado, false caso contrário.
 * @param {string|null} message - Mensagem opcional (ex: erro).
 */
function updateLoginStatusUI(loggedIn, message = null) {
    isLoggedIn = loggedIn;
    if (loggedIn) {
        loginStatusSpan.textContent = 'Conectado';
        loginStatusSpan.className = 'login-status logged-in';
        loginBtn.textContent = 'Logout';
        searchBtn.disabled = false;
        loadResultsBtn.disabled = false; // Habilita carregar após login
    } else {
        loginStatusSpan.textContent = message || 'Desconectado';
        loginStatusSpan.className = 'login-status logged-out';
        loginBtn.textContent = 'Login com Google';
        searchBtn.disabled = true;
        // Desabilita controles de resultados se deslogar
        disableResultControls();
        loadResultsBtn.disabled = true; // Desabilita carregar se não logado
    }
}

/**
 * Atualiza a barra de progresso.
 * @param {number} percentage - Percentual de progresso (0-100).
 * @param {string} text - Texto a ser exibido sobre a barra.
 */
function updateProgressBar(percentage, text) {
    progressContainer.style.display = 'block';
    const clampedPercentage = Math.max(0, Math.min(100, percentage)); // Garante que esteja entre 0 e 100
    progressBar.style.width = `${clampedPercentage}%`;
    // progressBar.textContent = `${Math.round(clampedPercentage)}%`; // Texto dentro da barra (opcional)
    progressStatusText.textContent = text || ''; // Texto sobreposto
}

/**
 * Limpa a área de resultados e reseta controles relacionados.
 */
function clearResults() {
    resultsDiv.innerHTML = '';
    resultsHeader.style.display = 'none';
    commentCountSpan.textContent = '0';
    currentSearchResults = [];
    currentGroupedResults = {};
    disableResultControls();
    loadStatusSpan.textContent = ''; // Limpa status de carregamento
}

/**
 * Desabilita os botões de controle de resultados (selecionar, deletar, salvar).
 */
function disableResultControls() {
    selectAllBtn.disabled = true;
    unselectAllBtn.disabled = true;
    deleteSelectedBtn.disabled = true;
    saveResultsBtn.disabled = true;
}

/**
 * Habilita os botões de controle de resultados.
 */
function enableResultControls() {
    selectAllBtn.disabled = false;
    unselectAllBtn.disabled = false;
    deleteSelectedBtn.disabled = false;
    saveResultsBtn.disabled = false;
}

/**
 * Renderiza os comentários encontrados na UI, agrupados por vídeo.
 * @param {object} groupedComments - Objeto com comentários agrupados por videoId.
 * @param {boolean} isLoadedData - Indica se os dados foram carregados do storage.
 */
function renderComments(groupedComments, isLoadedData = false) {
    clearResults(); // Limpa resultados anteriores
    currentGroupedResults = groupedComments; // Armazena os dados brutos
    let totalComments = 0;
    let videoIndex = 0;

    resultsDiv.innerHTML = ''; // Garante que está limpo

    // Converte para lista plana para facilitar contagem e manipulação
    currentSearchResults = Object.values(groupedComments).flatMap(videoData => videoData.comments);
    totalComments = currentSearchResults.length;

    if (totalComments === 0) {
        resultsDiv.innerHTML = '<p>Nenhum comentário encontrado com a palavra-chave especificada.</p>';
        resultsHeader.style.display = 'none'; // Esconde cabeçalho se não houver resultados
        return;
    }

    resultsHeader.style.display = 'block'; // Mostra o cabeçalho dos resultados
    commentCountSpan.textContent = totalComments;

    // Cria elementos HTML para cada vídeo e seus comentários
    for (const videoId in groupedComments) {
        videoIndex++;
        const { videoTitle, comments } = groupedComments[videoId];
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-comment-group';
        videoContainer.style.marginBottom = '15px';
        videoContainer.style.borderTop = videoIndex > 1 ? '1px solid #ccc' : 'none';
        videoContainer.style.paddingTop = videoIndex > 1 ? '10px' : '0';

        const videoHeader = document.createElement('h4');
        videoHeader.textContent = `${videoTitle} (${comments.length} ocorrência${comments.length > 1 ? 's' : ''})`;
        videoHeader.style.marginTop = '5px';
        videoHeader.style.marginBottom = '8px';
        videoContainer.appendChild(videoHeader);

        // Adiciona comentários e respostas ao container do vídeo
        comments.forEach(comment => {
            const commentElement = createCommentElement(comment);
            videoContainer.appendChild(commentElement);
        });

        resultsDiv.appendChild(videoContainer);
    }

    // Habilita controles após renderizar
    if (totalComments > 0) {
        enableResultControls();
    }

    // Atualiza o aviso de modo de exclusão baseado no checkbox Dry Run
    updateDeleteWarning();
}

/**
 * Cria o elemento HTML para um único comentário (ou resposta).
 * @param {object} comment - Objeto do comentário.
 * @returns {HTMLElement} O elemento div do comentário.
 */
function createCommentElement(comment) {
    const div = document.createElement('div');
    div.className = `comment ${comment.isReply ? 'reply-comment' : ''}`;
    div.dataset.commentId = comment.id; // Armazena o ID no elemento

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'comment-checkbox';
    checkbox.dataset.commentId = comment.id;
    checkbox.style.marginRight = '10px';

    const header = document.createElement('div');
    header.className = 'comment-header';
    const authorSpan = document.createElement('strong');
    authorSpan.textContent = comment.author || 'Autor Desconhecido';
    const dateSpan = document.createElement('span');
    dateSpan.textContent = ` - ${new Date(comment.publishedAt).toLocaleString('pt-BR')}`;
    dateSpan.style.fontSize = '11px';
    dateSpan.style.color = '#777';
    header.appendChild(checkbox); // Checkbox vem primeiro
    header.appendChild(authorSpan);
    header.appendChild(dateSpan);

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = comment.text; // Usar textContent para evitar injeção de HTML

    div.appendChild(header);
    div.appendChild(text);

    return div;
}

/**
 * Atualiza o aviso de 'Modo Exclusão Real Ativo' baseado no checkbox 'Dry Run'.
 */
function updateDeleteWarning() {
    if (isLoggedIn && currentSearchResults.length > 0) {
        deleteWarningSpan.style.display = dryRunCheckbox.checked ? 'none' : 'inline-block';
        deleteSelectedBtn.disabled = false; // Habilita o botão se houver resultados
    } else {
        deleteWarningSpan.style.display = 'none';
        deleteSelectedBtn.disabled = true; // Desabilita se não houver resultados ou não logado
    }
}

/**
 * Mostra uma mensagem de erro genérica na UI.
 * @param {string} message - A mensagem de erro a ser exibida.
 */
function showError(message) {
    // Poderia ser um div específico para erros, por agora usamos o searchStats
    searchStatsSpan.textContent = `Erro: ${message}`;
    searchStatsSpan.style.color = 'red';
    console.error("Erro exibido na UI:", message);
    // Oculta progresso se houver erro
    progressContainer.style.display = 'none'; 
    operationInProgress = false; // Libera flag de operação
    // Reabilita botões principais se aplicável
    if (isLoggedIn) {
        searchBtn.disabled = false;
    }
}

// --- Lógica de Manipulação de Eventos ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Verifica o estado inicial de login (silenciosamente)
    chrome.runtime.sendMessage({ action: 'getToken' }, (response) => {
        if (response && response.token) {
            console.log("Token encontrado no background, considerando logado.");
            updateLoginStatusUI(true);
        } else {
            console.log("Nenhum token ativo encontrado no background.");
            updateLoginStatusUI(false);
        }
        // Verifica se há resultados salvos ao iniciar
        checkSavedResults(); 
    });

    // 2. Listener para o botão de Login/Logout
    loginBtn.addEventListener('click', () => {
        if (isLoggedIn) {
            // Solicita Logout ao background script
            loginBtn.disabled = true; // Desabilita durante o processo
            chrome.runtime.sendMessage({ action: 'logout' }, (response) => {
                loginBtn.disabled = false;
                if (response && response.success) {
                    updateLoginStatusUI(false);
                    clearResults(); // Limpa resultados ao deslogar
                    updateProgressBar(0, '');
                    progressContainer.style.display = 'none';
                    quotaInfoDiv.textContent = 'Uso de cota da API: 0 unidades.';
                    console.log("Logout concluído.");
                } else {
                    showError("Falha ao fazer logout.");
                }
            });
        } else {
            // Solicita Login ao background script
            loginBtn.disabled = true;
            updateLoginStatusUI(false, 'Autenticando...'); // Mostra status intermediário
            chrome.runtime.sendMessage({ action: 'startLogin' }, (response) => {
                loginBtn.disabled = false;
                // A atualização final do status virá por outra mensagem ('loginSuccess' ou 'loginFailure')
                if (response && !response.success) {
                    // Se a resposta imediata for erro (ex: popup fechado antes da auth)
                    updateLoginStatusUI(false, response.error || 'Falha no login');
                }
            });
        }
    });

    // 3. Listener para o botão de Busca
    searchBtn.addEventListener('click', () => {
        const keyword = keywordInput.value.trim();
        const exclusionListRaw = exclusionListInput.value.trim();
        const exclusionList = exclusionListRaw ? exclusionListRaw.split(',').map(s => s.trim()).filter(s => s) : [];

        if (!keyword) {
            showError("Por favor, insira uma palavra-chave para buscar.");
            return;
        }
        if (operationInProgress) {
            showError("Aguarde a operação atual terminar.");
            return;
        }

        operationInProgress = true;
        searchBtn.disabled = true;
        clearResults();
        searchStatsSpan.textContent = 'Iniciando busca...';
        searchStatsSpan.style.color = '#666'; // Reseta cor
        updateProgressBar(0, 'Preparando para buscar...');
        quotaInfoDiv.textContent = 'Uso de cota da API: 0 unidades.'; // Reseta cota

        // Envia pedido de busca para o background
        chrome.runtime.sendMessage({
            action: 'startSearch',
            keyword: keyword,
            exclusionList: exclusionList
        });
    });

    // 4. Listener para o checkbox 'Dry Run'
    dryRunCheckbox.addEventListener('change', updateDeleteWarning);

    // 5. Listener para o botão 'Selecionar Todos'
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = resultsDiv.querySelectorAll('.comment-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
    });

    // 6. Listener para o botão 'Desmarcar Todos'
    unselectAllBtn.addEventListener('click', () => {
        const checkboxes = resultsDiv.querySelectorAll('.comment-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
    });

    // 7. Listener para o botão 'Deletar Selecionados'
    deleteSelectedBtn.addEventListener('click', () => {
        const checkboxes = resultsDiv.querySelectorAll('.comment-checkbox:checked');
        const commentIdsToDelete = Array.from(checkboxes).map(cb => cb.dataset.commentId);

        if (commentIdsToDelete.length === 0) {
            showError("Nenhum comentário selecionado para exclusão.");
            return;
        }

        if (operationInProgress) {
            showError("Aguarde a operação atual terminar.");
            return;
        }

        const isDryRun = dryRunCheckbox.checked;

        if (isDryRun) {
            searchStatsSpan.textContent = `Modo Simulação: ${commentIdsToDelete.length} comentários seriam excluídos. Nenhuma exclusão real será feita.`;
            searchStatsSpan.style.color = 'blue';
            // Talvez desmarcar os selecionados após a simulação?
             checkboxes.forEach(cb => cb.checked = false);
            return; // Não envia para o background em dry run
        }
        
        // Confirmação antes de deletar de verdade
        if (!confirm(`Tem certeza que deseja excluir ${commentIdsToDelete.length} comentário(s)? Esta ação não pode ser desfeita.`)) {
            return;
        }

        operationInProgress = true;
        disableResultControls(); // Desabilita controles durante a exclusão
        searchBtn.disabled = true; // Desabilita nova busca
        updateProgressBar(0, `Iniciando exclusão de ${commentIdsToDelete.length} comentários...`);

        // Envia pedido de exclusão para o background
        chrome.runtime.sendMessage({
            action: 'startDelete',
            commentIds: commentIdsToDelete
        });
    });

    // 8. Listener para o botão 'Salvar Resultados'
    saveResultsBtn.addEventListener('click', () => {
        if (currentSearchResults.length === 0) {
            showError("Não há resultados para salvar.");
            return;
        }
        
        const dataToSave = {
            keyword: keywordInput.value.trim(),
            exclusionList: exclusionListInput.value.trim(),
            groupedResults: currentGroupedResults, // Salva os dados agrupados
            timestamp: new Date().toISOString()
        };

        chrome.storage.local.set({ savedCommentsData: dataToSave }, () => {
            if (chrome.runtime.lastError) {
                showError(`Erro ao salvar resultados: ${chrome.runtime.lastError.message}`);
            } else {
                loadStatusSpan.textContent = `Resultados salvos em ${new Date(dataToSave.timestamp).toLocaleString('pt-BR')}.`;
                console.log("Resultados salvos com sucesso.");
            }
        });
    });

    // 9. Listener para o botão 'Carregar Resultados'
    loadResultsBtn.addEventListener('click', () => {
        loadSavedResults();
    });

});

// --- Listener de Mensagens do Background Script ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Mensagem recebida do background:", message);

    switch (message.action) {
        case 'loginSuccess':
            updateLoginStatusUI(true);
            break;
        case 'loginFailure':
            updateLoginStatusUI(false, `Falha no login: ${message.error}`);
            break;
        case 'logoutComplete':
             // A UI já foi atualizada pelo callback do sendMessage no popup
            console.log("Logout confirmado pelo background.");
            break;
        case 'searchStarted':
            operationInProgress = true;
            searchStatsSpan.textContent = 'Busca em andamento...';
            disableResultControls();
            searchBtn.disabled = true;
            break;
        case 'updateStatus':
            if (operationInProgress) {
                searchStatsSpan.textContent = message.text;
            }
            break;
        case 'updateProgress':
            if (operationInProgress) {
                updateProgressBar(message.progress, message.text);
            }
            break;
        case 'updateQuota':
            quotaInfoDiv.textContent = `Uso de cota da API: ${message.quota} unidades (Estimado).`;
            break;
        case 'searchComplete':
            operationInProgress = false;
            searchBtn.disabled = false; // Reabilita busca
            progressContainer.style.display = 'none'; // Esconde progresso
            if (message.groupedResults && Object.keys(message.groupedResults).length > 0) {
                renderComments(message.groupedResults);
                searchStatsSpan.textContent = `Busca concluída. ${currentSearchResults.length} comentários encontrados.`;
            } else {
                searchStatsSpan.textContent = 'Busca concluída. Nenhum comentário encontrado.';
                clearResults(); // Garante que a área de resultados esteja limpa e o header escondido
            }
            break;
        case 'searchFailed':
            operationInProgress = false;
            showError(message.error || 'Ocorreu um erro desconhecido durante a busca.');
            searchBtn.disabled = false; // Reabilita busca
            progressContainer.style.display = 'none';
            break;
        case 'deletionStarted':
            operationInProgress = true;
            searchStatsSpan.textContent = `Excluindo ${message.total} comentários...`;
            break;
        case 'updateDeletionProgress':
            if (operationInProgress) {
                const progress = (message.deletedCount / message.totalCount) * 100;
                let statusText = `Excluindo ${message.deletedCount}/${message.totalCount}...`;
                if(message.errorCommentId) {
                    statusText += ` (Erro ao excluir ${message.errorCommentId})`;
                     // Marcar o comentário com erro na UI?
                    const failedElement = resultsDiv.querySelector(`.comment[data-comment-id="${message.errorCommentId}"]`);
                    if (failedElement) {
                        failedElement.style.border = '2px solid red';
                        failedElement.style.opacity = '0.7';
                    }
                }
                updateProgressBar(progress, statusText);
            }
            break;
        case 'commentDeleted':
             // Marca visualmente o comentário como excluído na UI
            const element = resultsDiv.querySelector(`.comment[data-comment-id="${message.commentId}"]`);
            if (element) {
                element.classList.add('deleted');
                // element.style.opacity = '0.4';
                // element.style.textDecoration = 'line-through'; // Pode ser muito forte
                const checkbox = element.querySelector('.comment-checkbox');
                if (checkbox) checkbox.disabled = true; // Desabilita checkbox após exclusão
            }
            break;
        case 'deletionComplete':
            operationInProgress = false;
            progressContainer.style.display = 'none';
            searchBtn.disabled = false; // Reabilita busca
            let summary = `Exclusão concluída. ${message.successfulCount} sucesso(s).`;
            if (message.failedCount > 0) {
                summary += ` ${message.failedCount} falha(s).`;
                showError(`Falha ao excluir ${message.failedCount} comentário(s). Verifique o console do background para detalhes.`);
                console.error("Detalhes das falhas na exclusão:", message.failures);
            }
            searchStatsSpan.textContent = summary;
            // Desmarcar todos e reabilitar controles (exceto para já deletados)
            const checkboxes = resultsDiv.querySelectorAll('.comment-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = false;
                // Reabilita checkbox apenas se não foi deletado com sucesso
                const commentDiv = cb.closest('.comment');
                if (!commentDiv || !commentDiv.classList.contains('deleted')) {
                    cb.disabled = false;
                }
            });
            if (currentSearchResults.length > 0) {
                enableResultControls(); // Reabilita se ainda houver comentários (mesmo que alguns tenham falhado)
            }
             // Atualiza a contagem de comentários exibidos (opcional, pode confundir)
            // commentCountSpan.textContent = resultsDiv.querySelectorAll('.comment:not(.deleted)').length;
            break;
        case 'error': // Erro genérico do background
            showError(message.message || 'Erro desconhecido no background script.');
            operationInProgress = false;
            searchBtn.disabled = isLoggedIn; // Reabilita se logado
            progressContainer.style.display = 'none';
            break;
    }

    // Retorna true se for tratar a resposta de forma assíncrona (não usado aqui, mas boa prática)
    // return true;
});

// --- Funções de Persistência (Save/Load) ---

/**
 * Carrega os resultados salvos do chrome.storage.local.
 */
function loadSavedResults() {
    loadStatusSpan.textContent = 'Carregando...';
    chrome.storage.local.get('savedCommentsData', (result) => {
        if (chrome.runtime.lastError) {
            showError(`Erro ao carregar dados: ${chrome.runtime.lastError.message}`);
            loadStatusSpan.textContent = 'Falha ao carregar.';
        } else if (result.savedCommentsData && result.savedCommentsData.groupedResults) {
            const savedData = result.savedCommentsData;
            console.log("Dados carregados:", savedData);
            
            // Restaura campos de busca
            keywordInput.value = savedData.keyword || '';
            exclusionListInput.value = savedData.exclusionList || '';
            
            // Renderiza os comentários carregados
            renderComments(savedData.groupedResults, true);
            
            const saveDate = new Date(savedData.timestamp).toLocaleString('pt-BR');
            loadStatusSpan.textContent = `Resultados de '${savedData.keyword}' carregados (Salvos em ${saveDate}).`;
            searchStatsSpan.textContent = `Resultados carregados. ${currentSearchResults.length} comentários.`;
        } else {
            loadStatusSpan.textContent = 'Nenhum resultado salvo encontrado.';
            clearResults();
        }
    });
}

/**
 * Verifica se existem resultados salvos e atualiza o status.
 */
function checkSavedResults() {
     chrome.storage.local.get('savedCommentsData', (result) => {
         if (!chrome.runtime.lastError && result.savedCommentsData && result.savedCommentsData.timestamp) {
             const saveDate = new Date(result.savedCommentsData.timestamp).toLocaleString('pt-BR');
             loadStatusSpan.textContent = `Resultados anteriores salvos em ${saveDate}.`;
             loadResultsBtn.disabled = !isLoggedIn; // Habilita se logado
         } else {
             loadStatusSpan.textContent = 'Nenhum resultado salvo.';
             loadResultsBtn.disabled = true; // Desabilita se não houver dados
         }
     });
}

// --- Inicialização --- 
// (A verificação de login já ocorre no DOMContentLoaded)
