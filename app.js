// Single Deck Blackjack Simulator
// Rules: Double on 9/10/11 only; no double after splits; up to 3 splits (4 hands)
// Dealer stands on soft 17. Single deck shoe. Option to reshuffle after N hands (4 or 5)

(function() {
  'use strict';

  // ---------- Card & Deck Utilities ----------
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function buildSingleDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
    return deck;
  }

  function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  // ---------- Timing & Audio ----------
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let audioCtx;
  function playDealSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.stop(now + 0.16);
    } catch (_) {}
  }

  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
    return parseInt(rank, 10);
  }

  function handTotals(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      if (c.rank === 'A') {
        aces += 1;
      }
      total += cardValue(c.rank);
    }
    // Reduce Aces from 11 to 1 as needed
    while (total > 21 && aces > 0) {
      total -= 10; // count one Ace as 1 instead of 11
      aces -= 1;
    }
    // Hand is soft if there is at least one Ace still counted as 11 after adjustments
    const isSoft = aces > 0;
    return { total, isSoft };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && handTotals(cards).total === 21;
  }

  // ---------- Game State ----------
  const state = {
    fullDeck: [], // remaining undealt cards
    discard: [], // cards out
    dealerHand: [],
    playerHands: [], // array of hands for splits
    activeHandIndex: 0,
    handsPlayedInShoe: 0,
    reshuffleAfter: 5, // default
    roundOver: false,
    bankroll: 500,
    pendingBet: 0,
    dealerHasBlackjack: false,
    showCount: false,
    runningCount: 0,
  };

  function resetShoe() {
    state.fullDeck = buildSingleDeck();
    shuffleInPlace(state.fullDeck);
    state.discard = [];
    state.handsPlayedInShoe = 0;
    state.runningCount = 0; // Reset count on reshuffle
  }

  // ---------- Card Counting Logic ----------
  function getCardCountValue(rank) {
    if (rank === 'A' || rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') {
      return -1; // High cards subtract 1
    } else if (rank === '2' || rank === '3' || rank === '4' || rank === '5' || rank === '6') {
      return 1; // Low cards add 1
    } else {
      return 0; // 7, 8, 9 are neutral
    }
  }

  function updateCount(card) {
    const countValue = getCardCountValue(card.rank);
    state.runningCount += countValue;
  }

  function getTrueCount() {
    const remainingDecks = state.fullDeck.length / 52;
    return remainingDecks > 0 ? state.runningCount / remainingDecks : 0;
  }

  // ---------- Dealing / Actions ----------
  function drawCard(visible = true) {
    const card = state.fullDeck.pop();
    // mark fresh for animation
    card._fresh = true;
    card._visible = !!visible;
    state.discard.push(card);
    
    // Update count when card is dealt

    if (card._visible) {
        updateCount(card);
    }

    if (card._visible) {
      playDealSound();
    }
    updateDashboard();
    return card;
  }

  function dealInitial() {
    state.dealerHand = [];
    // attach bet to each hand at deal time
    state.playerHands = [{ cards: [], stood: false, doubled: false, splitCount: 0, bet: state.pendingBet }];
    state.activeHandIndex = 0;
    state.roundOver = false;
    state.dealerHasBlackjack = false;
    // lock bet by moving from pending to pot; bankroll is reduced now
    if (state.pendingBet > 0) {
      state.bankroll -= state.pendingBet;
    }

    // Player, Dealer, Player, Dealer (dealer second card face down logically, but deck state is same)
    state.playerHands[0].cards.push(drawCard(true));
    state.dealerHand.push(drawCard(true));
    state.playerHands[0].cards.push(drawCard(true));
    // dealer hole card dealt face down, not visible to dashboard
    state.dealerHand.push(drawCard(false));

    // Check for dealer blackjack (up-card Ace or 10-value and totals to 21 with hole)
    const dealerBJ = isBlackjack(state.dealerHand);
    if (dealerBJ) {
      // Reveal hole card immediately and end round; players lose
      state.dealerHasBlackjack = true;
      if (state.dealerHand[1]) state.dealerHand[1]._visible = true;
      state.roundOver = true;
      state.handsPlayedInShoe += 1;
      setMessage('Dealer Blackjack.');
      render();
      if (state.handsPlayedInShoe >= state.reshuffleAfter) {
        resetShoe();
        showReshuffleNotification();
      }
    }
  }

  function canSplit(hand) {
    if (state.playerHands.length >= 4) return false; // max 4 hands
    if (hand.cards.length !== 2) return false;
    const [c1, c2] = hand.cards;
    const sameRank = c1.rank === c2.rank;
    const bothTenVal = cardValue(c1.rank) === 10 && cardValue(c2.rank) === 10;
    return sameRank || bothTenVal;
  }

  function canDouble(hand) {
    if (hand.doubled) return false;
    if (hand.cards.length !== 2) return false;
    // cannot double after split per rules
    if (hand.splitParent) return false;
    const total = handTotals(hand.cards).total;
    return total === 9 || total === 10 || total === 11;
  }

  function hitActive() {
    const hand = state.playerHands[state.activeHandIndex];
    hand.cards.push(drawCard(true));
    const t = handTotals(hand.cards).total;
    if (t > 21) {
      hand.stood = true; // bust ends hand
      advanceToNextHandOrResolve();
    }
  }

  async function standActive() {
    const hand = state.playerHands[state.activeHandIndex];
    hand.stood = true;
    await advanceToNextHandOrResolve();
  }

  async function doubleActive() {
    const hand = state.playerHands[state.activeHandIndex];
    if (!canDouble(hand)) return;
    hand.doubled = true;
    hand.cards.push(drawCard(true));
    hand.stood = true; // doubles get exactly one card then stand
    // Deduct additional bet equal to original hand bet
    state.bankroll -= hand.bet;
    hand.bet *= 2;
    await advanceToNextHandOrResolve();
  }

  function splitActive() {
    const hand = state.playerHands[state.activeHandIndex];
    if (!canSplit(hand)) return;

    // Split into two hands
    const [c1, c2] = hand.cards;
    const newHand1 = { cards: [c1], stood: false, doubled: false, splitCount: (hand.splitCount || 0) + 1, splitParent: true, bet: hand.bet };
    const newHand2 = { cards: [c2], stood: false, doubled: false, splitCount: (hand.splitCount || 0) + 1, splitParent: true, bet: hand.bet };

    // Replace current hand with newHand1 and insert newHand2 after it
    state.playerHands.splice(state.activeHandIndex, 1, newHand1);
    state.playerHands.splice(state.activeHandIndex + 1, 0, newHand2);

    // Deal one card to each split hand
    newHand1.cards.push(drawCard(true));
    newHand2.cards.push(drawCard(true));
    // Take an additional bet for the new hand
    state.bankroll -= hand.bet;
    // Remain on first split hand
  }

  async function advanceToNextHandOrResolve() {
    // Move to next hand that hasn't stood/busted
    for (let i = state.activeHandIndex + 1; i < state.playerHands.length; i++) {
      const h = state.playerHands[i];
      const t = handTotals(h.cards).total;
      if (!h.stood && t <= 21) {
        state.activeHandIndex = i;
        render();
        return;
      }
    }
    // If no next hand, check if any hand is still alive (<=21)
    const anyAlive = state.playerHands.some(h => handTotals(h.cards).total <= 21);
    if (!anyAlive) {
      // All busted: dealer should not draw; end round immediately
      state.roundOver = true;
      state.handsPlayedInShoe += 1;
      showOutcomeMessage();
      render();
      if (state.handsPlayedInShoe >= state.reshuffleAfter) {
        resetShoe();
        showReshuffleNotification();
      }
      return;
    }
    // Otherwise, dealer plays and resolve
    await dealerPlayAndResolve();
  }

  async function dealerPlayAndResolve() {
    // Reveal dealer hole card implicitly; then hit while total < 17 (stand on soft 17)
    // Reveal dealer hole card to dashboard before starting hits
    if (state.dealerHand[1] && state.dealerHand[1]._visible === false) {
      await sleep(900);
      state.dealerHand[1]._visible = true;
      state.dealerHand[1]._fresh = true;
      updateCount(state.dealerHand[1]);
      playDealSound();
      render();
      await sleep(700);
    }
    while (true) {
      const totals = handTotals(state.dealerHand);
      const total = totals.total;
      const isSoft = totals.isSoft;
      if (total < 17) {
        await sleep(900);
        state.dealerHand.push(drawCard(true));
        render();
        await sleep(700);
        continue;
      }
      // stands on soft 17 by rule
      if (total === 17 && isSoft) break;
      break;
    }
    state.roundOver = true;
    state.handsPlayedInShoe += 1;
    showOutcomeMessage();
    render();

    // Reshuffle if needed
    if (state.handsPlayedInShoe >= state.reshuffleAfter) {
      resetShoe();
      setMessage('Shoe reshuffled. Odds reset.');
    }
  }

  function outcomeForHand(hand) {
    const playerTotal = handTotals(hand.cards).total;
    const dealerTotal = handTotals(state.dealerHand).total;
    const playerBust = playerTotal > 21;
    const dealerBust = dealerTotal > 21;
    if (playerBust) return 'Lose';
    if (dealerBust) return 'Win';
    if (playerTotal > dealerTotal) return 'Win';
    if (playerTotal < dealerTotal) return 'Lose';
    return 'Push';
  }

  // ---------- Dashboard & Probabilities ----------
  // Visible-only helpers to avoid revealing hidden hole card by elimination
  const INITIAL_COUNTS_BY_RANK = (() => {
    const counts = Object.fromEntries(RANKS.map(r => [r, 0]));
    buildSingleDeck().forEach(c => { counts[c.rank] += 1; });
    return counts;
  })();

  function visibleDealtCards() {
    return state.discard.filter(c => c._visible);
  }

  function visibleDealtCountsByRank() {
    const counts = Object.fromEntries(RANKS.map(r => [r, 0]));
    visibleDealtCards().forEach(c => { counts[c.rank] += 1; });
    return counts;
  }

  // Remaining counts shown to user = initial deck - visible dealt counts
  function shownRemainingCountsByRank() {
    const visibleCounts = visibleDealtCountsByRank();
    const shown = Object.fromEntries(RANKS.map(r => [r, (INITIAL_COUNTS_BY_RANK[r] - (visibleCounts[r] || 0))]));
    return shown;
  }

  function probabilityOfShown(rankOrCategory) {
    const shownCounts = shownRemainingCountsByRank();
    const totalRemainingShown = 52 - visibleDealtCards().length;
    if (totalRemainingShown <= 0) return 0;
    if (rankOrCategory === '10+') {
      const count = (shownCounts['10']||0)+(shownCounts['J']||0)+(shownCounts['Q']||0)+(shownCounts['K']||0);
      return count / totalRemainingShown;
    }
    return (shownCounts[rankOrCategory] || 0) / totalRemainingShown;
  }

  // ---------- UI Rendering ----------
  const qs = s => document.querySelector(s);
  const dealerCardsEl = qs('#dealerCards');
  const playerCardsEl = qs('#playerCards');
  const dealerValueEl = qs('#dealerValue');
  const playerValueEl = qs('#playerValue');
  const messageEl = qs('#message');
  const handIndexLabelEl = qs('#handIndexLabel');

  const dealBtn = qs('#dealBtn');
  const hitBtn = qs('#hitBtn');
  const standBtn = qs('#standBtn');
  const doubleBtn = qs('#doubleBtn');
  const splitBtn = qs('#splitBtn');
  const newRoundBtn = qs('#newRoundBtn');
  const toggleDashboardBtn = qs('#toggleDashboardBtn');
  const reshuffleSelect = qs('#reshuffleSelect');
  const bankrollEl = qs('#bankroll');
  const pendingBetEl = qs('#pendingBet');
  const clearBetBtn = qs('#clearBetBtn');
  const chipButtons = Array.from(document.querySelectorAll('.chip-btn'));
  const runningCountEl = qs('#runningCount');
  const trueCountEl = qs('#trueCount');
  const toggleCountBtn = qs('#toggleCountBtn');

  // Dashboard els
  const dashboardEl = qs('#dashboard');
  const deckSizeEl = qs('#deckSize');
  const cardsDealtEl = qs('#cardsDealt');
  const handsSinceEl = qs('#handsSince');
  const rankStatsEl = qs('#rankStats');
  const cardsOutEl = qs('#cardsOut');

  function setMessage(msg) { messageEl.textContent = msg || ''; }

  function showReshuffleNotification() {
    // Create a more prominent notification
    const notification = document.createElement('div');
    notification.className = 'reshuffle-notification';
    notification.innerHTML = `
      <div class="reshuffle-content">
        <div class="reshuffle-icon">🔄</div>
        <div class="reshuffle-text">
          <div class="reshuffle-title">Shoe Reshuffled!</div>
          <div class="reshuffle-subtitle">Count reset to 0 • Odds refreshed</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => notification.classList.add('show'), 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.classList.add('hide');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  function renderCards(container, cards, revealAll) {
    container.innerHTML = '';
    cards.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'card' + ((c.suit === '♥' || c.suit === '♦') ? ' red' : '');
      // Hide dealer hole if round not over and first render
      if (!revealAll && container === dealerCardsEl && idx === 1 && !state.roundOver && !c._visible) {
        div.className = 'card back';
        container.appendChild(div);
        return;
      }
      if (c._fresh) {
        div.classList.add('dealt');
        // clear marker so subsequent renders don't re-animate
        delete c._fresh;
      }
      div.textContent = `${c.rank}${c.suit}`;
      container.appendChild(div);
    });
  }

  function render() {
    const activeHand = state.playerHands[state.activeHandIndex];
    renderCards(dealerCardsEl, state.dealerHand, state.roundOver);

    // Render all player hands
    playerCardsEl.innerHTML = '';
    state.playerHands.forEach((hand, idx) => {
      const handWrap = document.createElement('div');
      handWrap.className = 'hand' + (idx === state.activeHandIndex && !state.roundOver ? ' hand--active' : '');

      const header = document.createElement('div');
      header.className = 'hand__header';
      const title = document.createElement('div');
      title.textContent = state.playerHands.length > 1 ? `Hand ${idx + 1}` : 'Hand';
      const t = handTotals(hand.cards);
      const value = document.createElement('div');
      value.className = 'hand-value';
      value.textContent = `${t.total}${t.isSoft ? ' (soft)' : ''}`;
      header.appendChild(title);
      header.appendChild(value);

      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'cards';
      renderCards(cardsDiv, hand.cards, true);

      handWrap.appendChild(header);
      handWrap.appendChild(cardsDiv);
      playerCardsEl.appendChild(handWrap);
    });

    const dealerTotals = handTotals(state.dealerHand);
    dealerValueEl.textContent = state.roundOver ? `${dealerTotals.total}${dealerTotals.isSoft ? ' (soft)' : ''}` : '';

    if (activeHand) {
      const t = handTotals(activeHand.cards);
      playerValueEl.textContent = `${t.total}${t.isSoft ? ' (soft)' : ''}`;
      handIndexLabelEl.textContent = state.playerHands.length > 1 ? `Hand ${state.activeHandIndex + 1} of ${state.playerHands.length}` : '';
    } else {
      playerValueEl.textContent = '';
      handIndexLabelEl.textContent = '';
    }

    // Enable/disable controls
    const canAct = !!activeHand && !state.roundOver && !state.dealerHasBlackjack;
    hitBtn.disabled = !canAct;
    standBtn.disabled = !canAct;
    doubleBtn.disabled = !canAct || !canDouble(activeHand);
    splitBtn.disabled = !canAct || !canSplit(activeHand);
    // Deal is enabled only when there's a positive pending bet and no active round
    dealBtn.disabled = canAct || state.pendingBet <= 0 || (!state.roundOver && state.playerHands.length > 0 && activeHand && activeHand.cards.length > 0);
    newRoundBtn.disabled = !state.roundOver;

    // Bankroll/Bet UI
    if (bankrollEl) bankrollEl.textContent = state.bankroll.toFixed(2);
    if (pendingBetEl) pendingBetEl.textContent = state.pendingBet.toFixed(2);

    // Count UI - only update if count is visible
    if (state.showCount) {
      if (runningCountEl) runningCountEl.textContent = state.runningCount;
      if (trueCountEl) trueCountEl.textContent = getTrueCount().toFixed(1);
    }

    updateDashboard();
  }

  function updateDashboard() {
    const visibleDealt = visibleDealtCards();
    const hiddenCount = state.discard.length - visibleDealt.length;
    const totalRemainingShown = 52 - visibleDealt.length; // treat hidden as still unknown/remaining for user

    deckSizeEl.textContent = `${totalRemainingShown} remaining / 52 total`;
    cardsDealtEl.textContent = `${visibleDealt.length}`;
    handsSinceEl.textContent = `${state.handsPlayedInShoe} of ${state.reshuffleAfter}`;

    // Group ranks with 10/J/Q/K as '10+' using shown remaining counts
    const shownRemaining = shownRemainingCountsByRank();
    const categories = ['A','2','3','4','5','6','7','8','9','10+'];
    const catCounts = {
      'A': shownRemaining['A'],
      '2': shownRemaining['2'],
      '3': shownRemaining['3'],
      '4': shownRemaining['4'],
      '5': shownRemaining['5'],
      '6': shownRemaining['6'],
      '7': shownRemaining['7'],
      '8': shownRemaining['8'],
      '9': shownRemaining['9'],
      '10+': (shownRemaining['10']||0)+(shownRemaining['J']||0)+(shownRemaining['Q']||0)+(shownRemaining['K']||0),
    };
    rankStatsEl.innerHTML = '';
    categories.forEach(label => {
      const item = document.createElement('div');
      item.className = 'dash-item';
      const count = catCounts[label] || 0;
      const p = totalRemainingShown > 0 ? (count / totalRemainingShown) : 0;
      item.innerHTML = `<strong>${label}</strong><div>Remain: ${count}</div><div>P(draw): ${(p*100).toFixed(1)}%</div>`;
      rankStatsEl.appendChild(item);
    });

    // Cards out chips (visible only)
    cardsOutEl.innerHTML = '';
    visibleDealt.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${c.rank}${c.suit}`;
      cardsOutEl.appendChild(chip);
    });

    // Optionally hint at unknowns without revealing
    if (hiddenCount > 0) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `Unknown ×${hiddenCount}`;
      cardsOutEl.appendChild(chip);
    }
  }

  function showOutcomeMessage() {
    const outcomes = state.playerHands.map(h => outcomeForHand(h));
    // Payouts: Win = +bet (even money), Blackjack pays 3:2 (optional: for now treat as normal win), Push = refund bet, Lose = -bet already deducted
    state.playerHands.forEach((hand, idx) => {
      const result = outcomes[idx];
      if (result === 'Win') {
        state.bankroll += hand.bet * 2; // return stake + win
      } else if (result === 'Push') {
        state.bankroll += hand.bet; // return stake
      } else {
        // Lose: bankroll was already reduced at bet time
      }
    });

    const counts = outcomes.reduce((acc, o) => { acc[o] = (acc[o] || 0) + 1; return acc; }, {});
    const parts = [];
    if (counts['Win']) parts.push(`${counts['Win']} win${counts['Win'] > 1 ? 's' : ''}`);
    if (counts['Lose']) parts.push(`${counts['Lose']} loss${counts['Lose'] > 1 ? 'es' : ''}`);
    if (counts['Push']) parts.push(`${counts['Push']} push${counts['Push'] > 1 ? 'es' : ''}`);
    setMessage(parts.length ? `Round results: ${parts.join(', ')}` : '');
  }

  // ---------- Event Listeners ----------
  dealBtn.addEventListener('click', () => {
    if (state.fullDeck.length < 4) {
      resetShoe();
      showReshuffleNotification();
    }
    dealInitial();
    render();
  });

  hitBtn.addEventListener('click', () => { if (!state.dealerHasBlackjack) { hitActive(); render(); } });
  standBtn.addEventListener('click', async () => { if (!state.dealerHasBlackjack) { await standActive(); } });
  doubleBtn.addEventListener('click', async () => { if (!state.dealerHasBlackjack) { await doubleActive(); } });
  splitBtn.addEventListener('click', () => { if (!state.dealerHasBlackjack) { splitActive(); render(); } });

  newRoundBtn.addEventListener('click', () => {
    // Prepare for a new round within the same shoe
    state.dealerHand = [];
    state.playerHands = [];
    state.activeHandIndex = 0;
    state.roundOver = false;
    setMessage('');
    render();
  });

  toggleDashboardBtn.addEventListener('click', () => {
    dashboardEl.classList.toggle('hidden');
  });

  toggleCountBtn.addEventListener('click', () => {
    state.showCount = !state.showCount;
    
    if (state.showCount) {
      toggleCountBtn.textContent = 'Hide Count';
      document.body.classList.add('count-enabled');
    } else {
      toggleCountBtn.textContent = 'Show Count';
      document.body.classList.remove('count-enabled');
    }
    
    render();
  });

  reshuffleSelect.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    state.reshuffleAfter = (v === 4 || v === 5) ? v : 5;
    updateDashboard();
  });

  // Betting controls
  chipButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.playerHands.length > 0 && !state.roundOver) return; // lock during round
      const val = parseInt(btn.getAttribute('data-chip'), 10) || 0;
      if (val <= 0) return;
      if (state.bankroll - state.pendingBet < val) return; // not enough funds
      state.pendingBet += val;
      render();
    });
  });
  if (clearBetBtn) {
    clearBetBtn.addEventListener('click', () => {
      if (state.playerHands.length > 0 && !state.roundOver) return;
      state.pendingBet = 0;
      render();
    });
  }

  // ---------- Init ----------
  resetShoe();
  render();
})();

