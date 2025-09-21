(() => {
  const REFRESH_INTERVAL = 12000;
  const MAX_ARGUMENTS = 6;
  const STOPWORDS = new Set([
    'alors', 'ainsi', 'aucun', 'aussi', 'autre', 'autres', 'avec', 'avoir', 'bon', 'car', 'ceci', 'cela', 'celle', 'celles',
    'celui', 'cependant', 'ces', 'cet', 'cette', 'ceux', 'chaque', 'comme', 'comment', 'dans', 'debut', 'dedans', 'dehors',
    'deja', 'depuis', 'des', 'deux', 'devant', 'donc', 'dos', 'du', 'elle', 'elles', 'enfin', 'entre', 'envers', 'est',
    'etais', 'etaient', 'etait', 'etant', 'etc', 'etre', 'eux', 'fait', 'faites', 'fois', 'font', 'hors', 'ici', 'il',
    'ils', 'jamais', 'leur', 'leurs', 'meme', 'memes', 'mes', 'mien', 'mienne', 'miennes', 'miens', 'moins', 'mon', 'ne',
    'notre', 'nous', 'ou', 'par', 'parce', 'parole', 'pas', 'pendant', 'personne', 'peu', 'peut', 'plus', 'plutot', 'point',
    'pour', 'pourquoi', 'quand', 'que', 'quel', 'quelle', 'quelles', 'quels', 'qui', 'sans', 'se', 'sera', 'ses', 'sien',
    'sienne', 'siennes', 'siens', 'sont', 'sous', 'souvent', 'sur', 'tandis', 'tel', 'telle', 'telles', 'tels', 'ton', 'toujours',
    'tous', 'tout', 'toute', 'toutes', 'tres', 'tu', 'une', 'vers', 'voici', 'voila', 'vont', 'votre', 'vous'
  ]);

  const state = {
    data: [],
    autoRefresh: true,
    timerId: null,
    selectedSpeaker: 'all',
    lastUpdate: null
  };

  const elements = {
    lastUpdate: document.getElementById('last-update'),
    statusPill: document.getElementById('status-pill'),
    autoRefreshIndicator: document.getElementById('auto-refresh-indicator'),
    errorPanel: document.getElementById('error-panel'),
    errorMessage: document.getElementById('error-message'),
    latestContent: document.getElementById('latest-content'),
    latestSpeaker: document.getElementById('latest-speaker'),
    latestChannel: document.getElementById('latest-channel'),
    latestTime: document.getElementById('latest-time'),
    responseSuggestion: document.getElementById('response-suggestion'),
    argumentsGrid: document.getElementById('arguments-grid'),
    argumentsEmpty: document.getElementById('arguments-empty'),
    timelineList: document.getElementById('timeline-list'),
    timelineEmpty: document.getElementById('timeline-empty'),
    timelineCount: document.getElementById('timeline-count'),
    speakerFilter: document.getElementById('speaker-filter'),
    refreshButton: document.getElementById('refresh-button'),
    autoRefreshToggle: document.getElementById('auto-refresh-toggle'),
    insightCount: document.getElementById('insight-count'),
    insightSpeakers: document.getElementById('insight-speakers'),
    insightMessages: document.getElementById('insight-messages'),
    insightKeywords: document.getElementById('insight-keywords')
  };

  const STATUS_STYLES = {
    idle: {
      classes: 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium border-slate-700 bg-slate-900 text-slate-300',
      dot: 'h-1.5 w-1.5 rounded-full bg-slate-500',
      label: 'En veille',
      pulse: false
    },
    loading: {
      classes: 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium border-sky-500/60 bg-sky-500/10 text-sky-200',
      dot: 'h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse',
      label: 'Analyse en cours',
      pulse: true
    },
    success: {
      classes: 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium border-emerald-500/60 bg-emerald-500/10 text-emerald-200',
      dot: 'h-1.5 w-1.5 rounded-full bg-emerald-400',
      label: 'Données à jour',
      pulse: false
    },
    error: {
      classes: 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium border-red-500/60 bg-red-500/10 text-red-200',
      dot: 'h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse',
      label: 'Erreur',
      pulse: true
    }
  };

  function setStatus(statusKey, customLabel) {
    const config = STATUS_STYLES[statusKey] || STATUS_STYLES.idle;
    const label = customLabel || config.label;
    elements.statusPill.className = config.classes;
    elements.statusPill.innerHTML = `<span class="${config.dot}"></span>${label}`;
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    const diffMs = Date.now() - date.getTime();
    const absDiff = Math.abs(diffMs);
    if (absDiff < 45 * 1000) {
      const seconds = Math.max(1, Math.round(absDiff / 1000));
      return diffMs >= 0 ? `il y a ${seconds}s` : `dans ${seconds}s`;
    }
    if (absDiff < 45 * 60 * 1000) {
      const minutes = Math.max(1, Math.round(absDiff / (60 * 1000)));
      return diffMs >= 0 ? `il y a ${minutes} min` : `dans ${minutes} min`;
    }
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function truncate(text, length) {
    if (!text || text.length <= length) return text;
    return `${text.slice(0, length - 1)}…`;
  }

  function normaliseWord(rawWord) {
    return rawWord
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9']+/g, '');
  }

  function splitSentences(text) {
    if (!text) return [];
    const matches = text.match(/[^.!?…]+[.!?…]?/g);
    if (!matches) return [text.trim()].filter(Boolean);
    return matches.map(sentence => sentence.trim()).filter(Boolean);
  }

  function sanitizeTranscriptions(rawItems) {
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .filter(item => item && typeof item.transcript === 'string' && item.transcript.trim().length > 0)
      .map(item => ({
        userId: item.userId || 'Intervenant inconnu',
        guildId: item.guildId || null,
        channelId: item.channelId || null,
        transcript: item.transcript.trim(),
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date()
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function buildArgument(keyword, score, sentences) {
    const keywordRegex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const contexts = sentences.filter(item => keywordRegex.test(item.normalized)).slice(0, 2);
    const steps = [];

    if (contexts[0]) {
      steps.push(`Reformule la position de ${contexts[0].userId} : « ${truncate(contexts[0].sentence, 140)} » pour montrer que tu as entendu.`);
    } else {
      steps.push(`Commence par reformuler l'argument centré sur « ${keyword} » afin de créer un terrain d'entente.`);
    }

    steps.push(`Amène un fait solide ou un exemple marquant qui recontextualise « ${keyword} » selon ton cadre.`);

    if (contexts[1]) {
      steps.push(`Projette la discussion vers ta solution : enchaîne avec « ${truncate(contexts[1].sentence, 140)} » en le retournant à ton avantage.`);
    } else {
      steps.push(`Conclue en proposant un plan d'action concret lié à « ${keyword} » pour reprendre le lead.`);
    }

    const supportingQuotes = contexts.map(context => ({
      userId: context.userId,
      sentence: truncate(context.sentence, 160)
    }));

    return {
      keyword,
      score,
      steps,
      supportingQuotes
    };
  }

  function analyzeTranscriptions(items) {
    if (!items.length) {
      return {
        latest: null,
        keywords: [],
        arguments: [],
        strategy: 'En attente de nouveaux échanges pour proposer une réponse sur mesure.',
        insights: {
          speakerCount: 0,
          messageCount: 0,
          keywordsSummary: '—'
        }
      };
    }

    const wordCounts = new Map();
    const sentences = [];

    items.forEach(transcription => {
      const normalizedText = transcription.transcript
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const tokens = normalizedText.match(/[a-z0-9']+/g) || [];
      tokens.forEach(token => {
        const cleanToken = normaliseWord(token);
        if (!cleanToken || cleanToken.length < 4) return;
        if (STOPWORDS.has(cleanToken)) return;
        wordCounts.set(cleanToken, (wordCounts.get(cleanToken) || 0) + 1);
      });

      const fragments = splitSentences(transcription.transcript);
      fragments.forEach(sentence => {
        const normalizedSentence = sentence
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        sentences.push({
          sentence,
          normalized: normalizedSentence,
          userId: transcription.userId,
          createdAt: transcription.createdAt
        });
      });
    });

    const sortedKeywords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ARGUMENTS)
      .map(([keyword, score]) => ({ keyword, score }));

    const argumentsReady = sortedKeywords.map(entry => buildArgument(entry.keyword, entry.score, sentences));

    const keywordsSummary = sortedKeywords.slice(0, 3).map(entry => `#${entry.keyword}`).join(' · ') || '—';

    const latest = items[0];
    const leadingArgument = argumentsReady[0];
    const secondaryArgument = argumentsReady[1];

    const acknowledgement = latest
      ? `Commence par reconnaître le point de ${latest.userId} : « ${truncate(latest.transcript, 150)} ».`
      : "Commence par montrer que tu as compris l'argument adverse.";
    const pivot = leadingArgument
      ? `Enchaîne en recentrant le débat sur ${leadingArgument.keyword} avec un chiffre clé ou une source irréfutable.`
      : 'Enchaîne en imposant ton cadre avec un fait difficilement contestable.';
    const closure = secondaryArgument
      ? `Termine en ouvrant vers ${secondaryArgument.keyword} pour proposer une issue positive et reprendre la dynamique.`
      : 'Termine en proposant une voie d\'action concrète pour clore l\'échange en ta faveur.';

    return {
      latest,
      keywords: sortedKeywords,
      arguments: argumentsReady,
      strategy: `${acknowledgement} ${pivot} ${closure}`,
      insights: {
        speakerCount: new Set(items.map(item => item.userId)).size,
        messageCount: items.length,
        keywordsSummary
      }
    };
  }

  function renderLatest(latest) {
    if (!latest) {
      elements.latestContent.textContent = 'Aucune donnée pour le moment.';
      elements.latestSpeaker.textContent = '—';
      elements.latestTime.textContent = '';
      elements.latestChannel.textContent = '';
      elements.latestChannel.classList.add('hidden');
      return;
    }
    elements.latestContent.textContent = latest.transcript;
    elements.latestSpeaker.textContent = latest.userId;
    elements.latestTime.textContent = formatTimestamp(latest.createdAt);
    if (latest.channelId || latest.guildId) {
      const parts = [];
      if (latest.channelId) parts.push(`#${latest.channelId}`);
      if (latest.guildId) parts.push(latest.guildId);
      elements.latestChannel.textContent = parts.join(' • ');
      elements.latestChannel.classList.remove('hidden');
    } else {
      elements.latestChannel.textContent = '';
      elements.latestChannel.classList.add('hidden');
    }
  }

  function renderArguments(argumentsList) {
    elements.argumentsGrid.innerHTML = '';
    if (!argumentsList.length) {
      elements.argumentsEmpty.classList.remove('hidden');
      return;
    }
    elements.argumentsEmpty.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    argumentsList.forEach(argument => {
      const card = document.createElement('article');
      card.className = 'flex flex-col gap-4 rounded-xl border border-slate-800/70 bg-slate-950/50 p-4 shadow shadow-slate-950/20';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-3';

      const title = document.createElement('h3');
      title.className = 'text-base font-semibold text-white';
      title.textContent = `Exploite « ${argument.keyword} »`;
      header.appendChild(title);

      const badge = document.createElement('span');
      badge.className = 'rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-200';
      badge.textContent = `Impact ${argument.score}`;
      header.appendChild(badge);

      card.appendChild(header);

      const stepsList = document.createElement('ul');
      stepsList.className = 'space-y-2 text-sm text-slate-200';
      argument.steps.forEach(step => {
        const item = document.createElement('li');
        item.className = 'relative pl-4';
        const bullet = document.createElement('span');
        bullet.className = 'absolute left-0 top-2 h-1.5 w-1.5 rounded-full bg-sky-400';
        item.appendChild(bullet);
        const text = document.createElement('span');
        text.textContent = step;
        item.appendChild(text);
        stepsList.appendChild(item);
      });
      card.appendChild(stepsList);

      if (argument.supportingQuotes.length) {
        const quoteWrapper = document.createElement('div');
        quoteWrapper.className = 'rounded-lg border border-slate-800/60 bg-slate-900/60 p-3';
        const quoteTitle = document.createElement('p');
        quoteTitle.className = 'text-xs font-medium uppercase tracking-wider text-slate-400';
        quoteTitle.textContent = 'Citations à exploiter';
        quoteWrapper.appendChild(quoteTitle);

        const quoteList = document.createElement('ul');
        quoteList.className = 'mt-2 space-y-2 text-xs text-slate-300';
        argument.supportingQuotes.forEach(entry => {
          const quoteItem = document.createElement('li');
          quoteItem.className = 'leading-relaxed';
          quoteItem.textContent = `${entry.userId} : « ${entry.sentence} »`;
          quoteList.appendChild(quoteItem);
        });
        quoteWrapper.appendChild(quoteList);
        card.appendChild(quoteWrapper);
      }

      fragment.appendChild(card);
    });
    elements.argumentsGrid.appendChild(fragment);
  }

  function renderTimeline(items) {
    const filtered = state.selectedSpeaker === 'all'
      ? items
      : items.filter(item => item.userId === state.selectedSpeaker);

    elements.timelineList.innerHTML = '';

    if (!filtered.length) {
      elements.timelineEmpty.classList.remove('hidden');
      elements.timelineCount.textContent = '';
      return;
    }

    elements.timelineEmpty.classList.add('hidden');
    elements.timelineCount.textContent = `${filtered.length} intervention${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''}`;

    const fragment = document.createDocumentFragment();
    filtered.forEach(transcription => {
      const item = document.createElement('li');
      item.className = 'rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 transition hover:border-sky-500/40 hover:bg-slate-950/70';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-3';

      const speaker = document.createElement('span');
      speaker.className = 'text-sm font-semibold text-white';
      speaker.textContent = transcription.userId;
      header.appendChild(speaker);

      const timestamp = document.createElement('span');
      timestamp.className = 'text-xs text-slate-400';
      timestamp.textContent = formatTimestamp(transcription.createdAt);
      header.appendChild(timestamp);

      item.appendChild(header);

      const content = document.createElement('p');
      content.className = 'mt-2 text-sm leading-relaxed text-slate-200';
      content.textContent = transcription.transcript;
      item.appendChild(content);

      const meta = document.createElement('div');
      meta.className = 'mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500';
      if (transcription.channelId) {
        const channel = document.createElement('span');
        channel.textContent = `Salon : #${transcription.channelId}`;
        meta.appendChild(channel);
      }
      if (transcription.guildId) {
        const guild = document.createElement('span');
        guild.textContent = `Serveur : ${transcription.guildId}`;
        meta.appendChild(guild);
      }
      if (transcription.confidence !== null) {
        const confidence = document.createElement('span');
        confidence.textContent = `Confiance : ${(transcription.confidence * 100).toFixed(0)}%`;
        meta.appendChild(confidence);
      }
      if (meta.childElementCount > 0) {
        item.appendChild(meta);
      }

      fragment.appendChild(item);
    });

    elements.timelineList.appendChild(fragment);
  }

  function updateSpeakerFilterOptions(items) {
    if (!elements.speakerFilter) return;
    const previousValue = elements.speakerFilter.value;
    const speakers = Array.from(new Set(items.map(item => item.userId))).sort((a, b) => a.localeCompare(b));

    elements.speakerFilter.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = 'all';
    defaultOption.textContent = 'Tous les intervenants';
    elements.speakerFilter.appendChild(defaultOption);

    speakers.forEach(speaker => {
      const option = document.createElement('option');
      option.value = speaker;
      option.textContent = speaker;
      elements.speakerFilter.appendChild(option);
    });

    if (speakers.includes(previousValue)) {
      elements.speakerFilter.value = previousValue;
      state.selectedSpeaker = previousValue;
    } else {
      elements.speakerFilter.value = 'all';
      state.selectedSpeaker = 'all';
    }
  }

  function updateInsights(insights) {
    elements.insightSpeakers.textContent = insights.speakerCount;
    elements.insightMessages.textContent = insights.messageCount;
    elements.insightKeywords.textContent = insights.keywordsSummary;
    elements.insightCount.textContent = insights.messageCount
      ? `Analyse basée sur ${insights.messageCount} échange${insights.messageCount > 1 ? 's' : ''}`
      : '';
  }

  function hideError() {
    elements.errorPanel.classList.add('hidden');
    elements.errorMessage.textContent = '';
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorPanel.classList.remove('hidden');
  }

  function setLastUpdate(date) {
    if (!date) {
      elements.lastUpdate.textContent = 'En attente...';
      return;
    }
    elements.lastUpdate.textContent = date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  async function fetchTranscriptions() {
    setStatus('loading');
    hideError();
    try {
      const response = await fetch('/api/transcriptions?limit=80', { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        let errorMessage = `Statut ${response.status}`;
        try {
          const body = await response.json();
          if (body && body.error) {
            errorMessage = body.error;
          }
        } catch (_) {
          // ignore JSON parse error
        }
        throw new Error(errorMessage);
      }
      const payload = await response.json();
      state.data = sanitizeTranscriptions(payload);
      state.lastUpdate = new Date();
      setLastUpdate(state.lastUpdate);
      render();
      setStatus('success');
    } catch (error) {
      console.error('[Coach Débat] Impossible de récupérer les transcriptions', error);
      setStatus('error', 'En attente de données');
      showError(error.message || 'Erreur inconnue');
    }
  }

  function render() {
    updateSpeakerFilterOptions(state.data);
    const analysis = analyzeTranscriptions(state.data);
    renderLatest(analysis.latest);
    renderArguments(analysis.arguments);
    renderTimeline(state.data);
    elements.responseSuggestion.textContent = analysis.strategy;
    updateInsights(analysis.insights);
    elements.autoRefreshIndicator.textContent = state.autoRefresh
      ? 'Rafraîchissement automatique activé'
      : 'Rafraîchissement automatique désactivé';
  }

  function startAutoRefresh() {
    if (state.timerId) clearInterval(state.timerId);
    if (!state.autoRefresh) return;
    state.timerId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchTranscriptions();
      }
    }, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && state.autoRefresh) {
      fetchTranscriptions();
      startAutoRefresh();
    }
  }

  function initEventListeners() {
    if (elements.refreshButton) {
      elements.refreshButton.addEventListener('click', () => {
        fetchTranscriptions();
      });
    }

    if (elements.autoRefreshToggle) {
      elements.autoRefreshToggle.addEventListener('change', event => {
        state.autoRefresh = Boolean(event.target.checked);
        elements.autoRefreshIndicator.textContent = state.autoRefresh
          ? 'Rafraîchissement automatique activé'
          : 'Rafraîchissement automatique désactivé';
        if (state.autoRefresh) {
          startAutoRefresh();
        } else {
          stopAutoRefresh();
        }
      });
    }

    if (elements.speakerFilter) {
      elements.speakerFilter.addEventListener('change', event => {
        state.selectedSpeaker = event.target.value;
        renderTimeline(state.data);
      });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function init() {
    initEventListeners();
    fetchTranscriptions();
    startAutoRefresh();
  }

  init();
})();
