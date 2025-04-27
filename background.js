// background.js - Service Worker da Extensão
// Este script roda em segundo plano, independente da janela popup.
// Ele é responsável pelas tarefas de longa duração como chamadas de API e processamento de dados.

// --- Variáveis Globais (Estado do Background Script) ---
let currentToken = null; // Armazena o token OAuth atual
let searchInProgress = false; // Flag para indicar se uma busca está ativa
let deletionInProgress = false; // Flag para indicar se uma exclusão está ativa
let apiQuotaUsed = 0; // Contador para o uso estimado da cota da API
let foundCommentsData = {}; // Armazena os comentários encontrados { videoId: { videoTitle: '...', comments: [...] } }

// --- Constantes ---
const YOUTUBE_API_KEY = null; // Chave de API pode ser útil para algumas chamadas não autenticadas (se aplicável)
const MAX_RESULTS_PER_PAGE = 50; // Máximo de resultados por página da API do YouTube
const RETRY_DELAY = 5000; // Delay para tentar novamente chamadas de API falhas (5 segundos)
const MAX_RETRIES = 3; // Máximo de tentativas para chamadas de API

// --- Funções Utilitárias ---

/**
 * Função auxiliar para realizar chamadas à API do YouTube com tratamento de erros e retentativas.
 * @param {string} url URL da API
 * @param {object} options Opções para fetch (method, headers, body)
 * @param {number} attempt Tentativa atual (para retentativas)
 * @returns {Promise<object>} Resposta da API em JSON
 */
async function makeApiCall(url, options, attempt = 1) {
    if (!currentToken) {
        console.error("Erro: Token de autenticação não encontrado para chamada API.");
        throw new Error("Não autenticado");
    }

    options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${currentToken}`,
        'Accept': 'application/json',
    };

    try {
        console.log(`API Call (Tentativa ${attempt}): ${options.method || 'GET'} ${url}`);
        const response = await fetch(url, options);
        
        // Estimar uso de cota (simplificado)
        if (url.includes('youtube/v3/search')) apiQuotaUsed += 100;
        else if (url.includes('youtube/v3/commentThreads')) apiQuotaUsed += 1;
        else if (url.includes('youtube/v3/comments') && options.method === 'DELETE') apiQuotaUsed += 50;
        else if (url.includes('youtube/v3/comments') && options.method === 'list') apiQuotaUsed += 1; // Para buscar respostas
        else if (url.includes('youtube/v3/playlistItems')) apiQuotaUsed += 1;
        else if (url.includes('youtube/v3/channels')) apiQuotaUsed += 1;

        // Atualiza a popup com a cota usada
        chrome.runtime.sendMessage({ action: "updateQuota", quota: apiQuotaUsed });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Erro na API:", response.status, errorData);
            // Tratamento específico para Quota Exceeded
            if (response.status === 403 && errorData.error?.errors?.[0]?.reason === 'quotaExceeded') {
                throw new Error("QuotaExceeded"); 
            }
            // Tratamento para retentativas em erros de servidor (5xx)
            if (response.status >= 500 && attempt < MAX_RETRIES) {
                console.warn(`Erro ${response.status}, tentando novamente em ${RETRY_DELAY / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return makeApiCall(url, options, attempt + 1);
            }
            throw new Error(`API Error ${response.status}: ${errorData.error?.message || 'Erro desconhecido'}`);
        }

        // Se a resposta for 204 No Content (ex: DELETE bem-sucedido), retorna um objeto vazio
        if (response.status === 204) {
            return {};
        }

        return await response.json();
    } catch (error) {
        console.error("Falha na chamada fetch:", error);
        // Se for erro de rede e ainda houver tentativas
        if (error instanceof TypeError && attempt < MAX_RETRIES) { // TypeError pode indicar problema de rede
             console.warn(`Erro de rede, tentando novamente em ${RETRY_DELAY / 1000}s...`);
             await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
             return makeApiCall(url, options, attempt + 1);
        }
        throw error; // Relança o erro se não for tratado ou se acabaram as tentativas
    }
}

// --- Funções Principais (Lógica movida do popup.js) ---

/**
 * Obtém o token de autenticação do usuário.
 * @returns {Promise<string>} O token de acesso.
 */
async function getAuthToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error("Erro ao obter token:", chrome.runtime.lastError?.message);
                currentToken = null;
                reject(new Error(chrome.runtime.lastError?.message || "Falha ao obter token"));
            } else {
                console.log("Token obtido com sucesso.");
                currentToken = token;
                resolve(token);
            }
        });
    });
}

/**
 * Busca o ID do canal do usuário autenticado.
 * @returns {Promise<string>} ID do canal.
 */
async function getChannelId() {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&mine=true`;
    const data = await makeApiCall(url, { method: 'GET' });
    if (data.items && data.items.length > 0) {
        return data.items[0].id;
    }
    throw new Error("Não foi possível encontrar o ID do canal.");
}

/**
 * Busca o ID da playlist 'uploads' do canal.
 * @param {string} channelId ID do Canal.
 * @returns {Promise<string>} ID da playlist de uploads.
 */
async function getUploadsPlaylistId(channelId) {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`;
    const data = await makeApiCall(url, { method: 'GET' });
    if (data.items && data.items.length > 0) {
        return data.items[0].contentDetails.relatedPlaylists.uploads;
    }
    throw new Error("Não foi possível encontrar a playlist de uploads.");
}

/**
 * Busca vídeos de uma playlist, tratando paginação.
 * @param {string} playlistId ID da Playlist.
 * @param {string|null} pageToken Token da página para buscar.
 * @returns {Promise<{videos: Array<object>, nextPageToken: string|null}>} Lista de vídeos e token da próxima página.
 */
async function fetchVideos(playlistId, pageToken = null) {
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${MAX_RESULTS_PER_PAGE}`;
    if (pageToken) {
        url += `&pageToken=${pageToken}`;
    }
    const data = await makeApiCall(url, { method: 'GET' });
    const videos = data.items ? data.items.map(item => ({ 
        id: item.contentDetails.videoId, 
        title: item.snippet.title 
    })) : [];
    return { videos, nextPageToken: data.nextPageToken || null };
}

/**
 * Busca comentários de nível superior de um vídeo, tratando paginação.
 * @param {string} videoId ID do Vídeo.
 * @param {string|null} pageToken Token da página para buscar.
 * @returns {Promise<{comments: Array<object>, nextPageToken: string|null}>} Lista de comentários e token da próxima página.
 */
async function fetchTopLevelComments(videoId, pageToken = null) {
    let url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&maxResults=${MAX_RESULTS_PER_PAGE}&textFormat=plainText`;
    if (pageToken) {
        url += `&pageToken=${pageToken}`;
    }
    const data = await makeApiCall(url, { method: 'GET' });
    const comments = data.items ? data.items.map(item => ({
        id: item.snippet.topLevelComment.id,
        text: item.snippet.topLevelComment.snippet.textDisplay,
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
        replyCount: item.snippet.totalReplyCount,
        replies: [] // Placeholder para respostas
    })) : [];
    return { comments, nextPageToken: data.nextPageToken || null };
}

/**
 * Busca respostas (replies) de um comentário, tratando paginação.
 * @param {string} commentId ID do Comentário Pai.
 * @param {string|null} pageToken Token da página para buscar.
 * @returns {Promise<{replies: Array<object>, nextPageToken: string|null}>} Lista de respostas e token da próxima página.
 */
async function fetchReplies(commentId, pageToken = null) {
    let url = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${commentId}&maxResults=${MAX_RESULTS_PER_PAGE}&textFormat=plainText`;
    if (pageToken) {
        url += `&pageToken=${pageToken}`;
    }
    const data = await makeApiCall(url, { method: 'GET' });
    // Respostas vêm em ordem inversa (mais antiga primeiro), invertemos para consistência?
    const replies = data.items ? data.items.map(item => ({
        id: item.id,
        text: item.snippet.textDisplay,
        author: item.snippet.authorDisplayName,
        publishedAt: item.snippet.publishedAt
    }))/*.reverse()*/ : []; 
    return { replies, nextPageToken: data.nextPageToken || null };
}

/**
 * Exclui um comentário específico.
 * @param {string} commentId ID do comentário a ser excluído.
 * @returns {Promise<void>}
 */
async function deleteComment(commentId) {
    const url = `https://www.googleapis.com/youtube/v3/comments?id=${commentId}`;
    await makeApiCall(url, { method: 'DELETE' });
    console.log(`Comentário ${commentId} excluído com sucesso.`);
    // Atualiza o popup informando que um comentário foi excluído
    chrome.runtime.sendMessage({ action: "commentDeleted", commentId: commentId });
}

/**
 * Verifica se um texto contém a palavra-chave principal e não contém nenhuma palavra da lista de exclusão.
 * @param {string} text Texto do comentário.
 * @param {string} keyword Palavra-chave principal (case-insensitive).
 * @param {string[]} exclusionList Lista de palavras a serem excluídas (case-insensitive).
 * @returns {boolean} True se o comentário deve ser marcado, False caso contrário.
 */
function checkCommentText(text, keyword, exclusionList) {
    if (!text || !keyword) return false;
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const lowerExclusionList = exclusionList.map(ex => ex.toLowerCase());

    if (lowerText.includes(lowerKeyword)) {
        // Verifica se alguma palavra de exclusão está presente
        for (const exclusionWord of lowerExclusionList) {
            if (exclusionWord && lowerText.includes(exclusionWord)) {
                return false; // Encontrou palavra de exclusão, não marcar
            }
        }
        return true; // Contém a keyword principal e nenhuma palavra de exclusão
    }
    return false;
}

/**
 * Processa um único vídeo: busca comentários e respostas, filtra por palavra-chave.
 * @param {string} videoId ID do vídeo.
 * @param {string} videoTitle Título do vídeo.
 * @param {string} keyword Palavra-chave.
 * @param {string[]} exclusionList Lista de exclusão.
 * @returns {Promise<Array<object>>} Lista de comentários encontrados neste vídeo.
 */
async function processVideo(videoId, videoTitle, keyword, exclusionList) {
    let commentsFoundInVideo = [];
    let commentPageToken = null;
    let commentPageCount = 0;

    console.log(`Processando vídeo: ${videoTitle} (${videoId})`);

    do {
        commentPageCount++;
        console.log(`Buscando página ${commentPageCount} de comentários para vídeo ${videoId}`);
        chrome.runtime.sendMessage({ 
            action: "updateStatus", 
            text: `Buscando comentários do vídeo '${videoTitle}' (Página ${commentPageCount})...` 
        });

        const { comments: commentPage, nextPageToken: nextCommentPageToken } = await fetchTopLevelComments(videoId, commentPageToken);
        commentPageToken = nextCommentPageToken;

        for (const comment of commentPage) {
            let commentAdded = false;
            // Verifica comentário principal
            if (checkCommentText(comment.text, keyword, exclusionList)) {
                commentsFoundInVideo.push({ ...comment, videoId, videoTitle, isReply: false });
                commentAdded = true;
                console.log(`   [FOUND TOP] ${comment.id}: ${comment.text.substring(0, 50)}...`);
            }

            // Busca e verifica respostas se houver
            if (comment.replyCount > 0) {
                let replyPageToken = null;
                let replyPageCount = 0;
                do {
                    replyPageCount++;
                    console.log(`   Buscando página ${replyPageCount} de respostas para comentário ${comment.id}`);
                    const { replies: replyPage, nextPageToken: nextReplyPageToken } = await fetchReplies(comment.id, replyPageToken);
                    replyPageToken = nextReplyPageToken;

                    for (const reply of replyPage) {
                        if (checkCommentText(reply.text, keyword, exclusionList)) {
                            const replyData = { ...reply, videoId, videoTitle, parentId: comment.id, isReply: true };
                            // Evita adicionar a resposta se o comentário pai já foi adicionado?
                            // Não, queremos listar todas as ocorrências
                            commentsFoundInVideo.push(replyData);
                            console.log(`      [FOUND REPLY] ${reply.id}: ${reply.text.substring(0, 50)}...`);
                        }
                    }
                } while (replyPageToken);
            }
        }
    } while (commentPageToken);

    return commentsFoundInVideo;
}


// --- Listener Principal de Mensagens (Vindo do Popup) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Mensagem recebida do popup:", message);

    // Flag para indicar que a resposta será enviada assincronamente
    let willRespondAsync = false;

    if (message.action === "startLogin") {
        willRespondAsync = true; // A resposta depende do fluxo de autenticação
        getAuthToken()
            .then(token => {
                currentToken = token;
                // Tenta buscar o channel ID para confirmar que o token funciona
                return getChannelId(); 
            })
            .then(channelId => {
                console.log("Login bem-sucedido, Channel ID:", channelId);
                sendResponse({ success: true, token: currentToken });
                // Informa o popup que o login foi bem-sucedido
                chrome.runtime.sendMessage({ action: "loginSuccess" });
            })
            .catch(error => {
                console.error("Falha no processo de login:", error);
                currentToken = null;
                sendResponse({ success: false, error: error.message || "Erro desconhecido no login" });
                // Informa o popup sobre a falha
                chrome.runtime.sendMessage({ action: "loginFailure", error: error.message });
            });

    } else if (message.action === "startSearch") {
        if (searchInProgress) {
            console.warn("Busca já está em andamento.");
            sendResponse({ success: false, error: "Busca já em andamento." });
            return false; // Não responde assincronamente
        }
        searchInProgress = true;
        willRespondAsync = true; // A busca é longa
        apiQuotaUsed = 0; // Reseta a cota para a nova busca
        foundCommentsData = {}; // Limpa resultados anteriores
        chrome.runtime.sendMessage({ action: "searchStarted" });

        const { keyword, exclusionList } = message;
        console.log(`Iniciando busca por '${keyword}', excluindo: [${exclusionList.join(', ')}]`);

        // Cadeia de Promises para buscar tudo
        getAuthToken() // Garante que temos um token válido
            .then(token => getChannelId()) // Pega o ID do canal
            .then(channelId => getUploadsPlaylistId(channelId)) // Pega a playlist de uploads
            .then(async (uploadsPlaylistId) => {
                let allFoundComments = [];
                let videoPageToken = null;
                let totalVideosProcessed = 0;
                let videoPageCount = 0;
                
                // Loop para buscar vídeos paginados
                do {
                    videoPageCount++;
                    chrome.runtime.sendMessage({ action: "updateStatus", text: `Buscando página ${videoPageCount} de vídeos...` });
                    const { videos: videoPage, nextPageToken: nextVideoPageToken } = await fetchVideos(uploadsPlaylistId, videoPageToken);
                    videoPageToken = nextVideoPageToken;
                    totalVideosProcessed += videoPage.length;
                    console.log(`Encontrados ${videoPage.length} vídeos na página ${videoPageCount}. Total processado: ${totalVideosProcessed}`);

                    // Processa cada vídeo da página
                    for (let i = 0; i < videoPage.length; i++) {
                        const video = videoPage[i];
                        const progress = ((totalVideosProcessed - videoPage.length + i + 1) / totalVideosProcessed) * 100; // Estimativa de progresso
                        chrome.runtime.sendMessage({ 
                            action: "updateProgress", 
                            progress: progress, 
                            text: `Processando vídeo ${i + 1}/${videoPage.length}: '${video.title}'` 
                        });
                        try {
                            const commentsFromVideo = await processVideo(video.id, video.title, keyword, exclusionList);
                            if (commentsFromVideo.length > 0) {
                                if (!foundCommentsData[video.id]) {
                                     foundCommentsData[video.id] = { videoTitle: video.title, comments: [] };
                                }
                                foundCommentsData[video.id].comments.push(...commentsFromVideo);
                                allFoundComments.push(...commentsFromVideo);
                            }
                        } catch (videoError) {
                             console.error(`Erro ao processar vídeo ${video.id} (${video.title}):`, videoError);
                             // Envia erro específico para o popup
                             chrome.runtime.sendMessage({ action: "error", message: `Erro ao processar vídeo '${video.title}': ${videoError.message}` });
                             if (videoError.message === 'QuotaExceeded') {
                                 throw videoError; // Interrompe a busca se a cota acabar
                             }
                             // Continua para o próximo vídeo em caso de outros erros?
                             // Poderia adicionar uma opção para parar ou continuar.
                        }
                    }
                    // TODO: Adicionar uma estimativa melhor de progresso total se possível (precisaria do total de vídeos primeiro)

                } while (videoPageToken);

                return allFoundComments;
            })
            .then(allFoundComments => {
                console.log(`Busca concluída. Total de comentários encontrados: ${allFoundComments.length}`);
                searchInProgress = false;
                sendResponse({ success: true, comments: allFoundComments, groupedComments: foundCommentsData });
                // Envia resultados para o popup
                chrome.runtime.sendMessage({ action: "searchComplete", results: allFoundComments, groupedResults: foundCommentsData });
            })
            .catch(error => {
                console.error("Erro durante a busca:", error);
                searchInProgress = false;
                const errorMessage = error.message === 'QuotaExceeded' ? "Cota da API do YouTube excedida." : `Erro na busca: ${error.message}`;
                sendResponse({ success: false, error: errorMessage });
                // Envia erro para o popup
                chrome.runtime.sendMessage({ action: "searchFailed", error: errorMessage });
            });

    } else if (message.action === "startDelete") {
        if (deletionInProgress) {
            console.warn("Exclusão já está em andamento.");
            sendResponse({ success: false, error: "Exclusão já em andamento." });
            return false;
        }
        if (searchInProgress) {
             console.warn("Aguarde a busca terminar antes de excluir.");
             sendResponse({ success: false, error: "Busca em andamento." });
             return false;
        }
        
        const { commentIds } = message;
        if (!commentIds || commentIds.length === 0) {
            sendResponse({ success: false, error: "Nenhum comentário selecionado para exclusão." });
            return false;
        }

        deletionInProgress = true;
        willRespondAsync = true; // Exclusão pode demorar
        chrome.runtime.sendMessage({ action: "deletionStarted", total: commentIds.length });
        console.log(`Iniciando exclusão de ${commentIds.length} comentários.`);

        // Usar Promise.allSettled para tentar excluir todos e coletar resultados
        const deletePromises = commentIds.map((id, index) => 
            deleteComment(id)
                .then(() => {
                    // Envia progresso após cada exclusão bem-sucedida
                    chrome.runtime.sendMessage({ action: "updateDeletionProgress", deletedCount: index + 1, totalCount: commentIds.length });
                    return { status: 'fulfilled', id: id };
                })
                .catch(error => {
                     // Envia progresso mesmo em caso de falha
                    chrome.runtime.sendMessage({ action: "updateDeletionProgress", deletedCount: index + 1, totalCount: commentIds.length, errorCommentId: id });
                    console.error(`Falha ao excluir comentário ${id}:`, error);
                    return { status: 'rejected', id: id, reason: error.message };
                })
        );

        Promise.allSettled(deletePromises)
            .then(results => {
                deletionInProgress = false;
                const successfulDeletes = results.filter(r => r.status === 'fulfilled').length;
                const failedDeletes = results.filter(r => r.status === 'rejected');
                console.log(`Exclusão concluída. Sucesso: ${successfulDeletes}, Falhas: ${failedDeletes.length}`);
                sendResponse({ success: true, successful: successfulDeletes, failed: failedDeletes.length });
                // Envia resultado final para o popup
                chrome.runtime.sendMessage({ 
                    action: "deletionComplete", 
                    successfulCount: successfulDeletes, 
                    failedCount: failedDeletes.length, 
                    failures: failedDeletes // Envia detalhes das falhas
                });
            }); // Não há .catch aqui, pois allSettled sempre resolve

    } else if (message.action === "getToken") {
        // Popup pode pedir o token atual para verificar o estado
        if (currentToken) {
            sendResponse({ token: currentToken });
        } else {
            // Tenta obter um token silenciosamente primeiro
            willRespondAsync = true;
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
                 if (chrome.runtime.lastError || !token) {
                     console.log("Tentativa silenciosa de obter token falhou.", chrome.runtime.lastError?.message);
                     currentToken = null;
                     sendResponse({ token: null });
                 } else {
                     console.log("Token obtido silenciosamente.");
                     currentToken = token;
                     sendResponse({ token: token });
                 }
             });
        }
    } else if (message.action === "logout") {
         willRespondAsync = true;
         if (currentToken) {
             const tokenToRemove = currentToken;
             currentToken = null; // Limpa localmente primeiro
             chrome.identity.removeCachedAuthToken({ token: tokenToRemove }, () => {
                 console.log("Token removido do cache.");
                 // Idealmente, revogar o token na API do Google também, mas removeCachedAuthToken é o principal para a extensão
                 chrome.identity.clearAllCachedAuthTokens(() => { // Garante limpeza geral
                     console.log("Todos os tokens em cache removidos.");
                     sendResponse({ success: true });
                     chrome.runtime.sendMessage({ action: "logoutComplete" });
                 });
             });
         } else {
             sendResponse({ success: true }); // Já estava deslogado
             chrome.runtime.sendMessage({ action: "logoutComplete" });
         }
    }

    // Retorna true se sendResponse será chamado de forma assíncrona
    return willRespondAsync;
});

// --- Outros Event Listeners do Ciclo de Vida (Exemplo) ---

chrome.runtime.onInstalled.addListener(() => {
    console.log("Extensão Bulk YouTube Comment Deleter instalada/atualizada.");
    // Pode-se definir valores iniciais no storage aqui, se necessário.
    chrome.storage.local.set({ savedComments: null, saveTimestamp: null });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Navegador iniciado, Service Worker ativo.");
    currentToken = null; // Garante que o token seja revalidado ao iniciar
    apiQuotaUsed = 0; // Reseta contador de cota ao iniciar
    searchInProgress = false;
    deletionInProgress = false;
});

console.log("Service Worker (background.js) iniciado.");
