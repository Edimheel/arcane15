/**
 * ARCANE XV — CardManager (Foundry VTT v13)
 * - Deck: 52 cartes (sans cavaliers)
 * - Hand: 3 cartes + 1 Joker persistant (cavalier visuel) value=0
 * - Clic carte = jouer
 * - Avant résultat: demande au MJ la difficulté
 * - Fix crucial: communication MJ/Joueur (DialogV2 callbacks + listener click HTML)
 * - Fix crucial: cycle exécuté par le MJ si le joueur manque de permissions (évite les moves partiels/doublons)
 */

const { DialogV2 } = foundry.applications.api;

export class CardManager {
  static #initLocks = new Map();

  // --------------------------
  // SOCKET
  // --------------------------
  static #socketReady = false;
  static #pendingDifficulty = new Map(); // requestId -> { resolve, createdAt }
  static #pendingGmOps = new Map();      // opId -> { resolve, createdAt }
  static #monteCristoPrompting = new Set();

  static get SOCKET_CHANNEL() {
    return `system.${game.system.id}`;
  }

  static ensureSocket() {
    if (CardManager.#socketReady) return;
    CardManager.#socketReady = true;

    if (!game.socket) {
      console.warn("[ARCANE XV][SOCKET] game.socket absent", { user: game.user?.name, isGM: game.user?.isGM });
      return;
    }

    console.log("[ARCANE XV][SOCKET] Register listener on", CardManager.SOCKET_CHANNEL, {
      user: game.user?.name,
      isGM: game.user?.isGM
    });

    game.socket.on(CardManager.SOCKET_CHANNEL, async (payload) => {
      const t0 = Date.now();
      try {
        if (!payload?.type) return;

        console.log("[ARCANE XV][SOCKET][RECV]", payload);

        // ---------------------------------
        // DIFFICULTÉ (player -> GM)
        // ---------------------------------
        if (payload.type === "difficultyRequest") {
          if (!game.user?.isGM) return;
          await CardManager._gmHandleDifficultyRequest(payload);
          return;
        }

        // ---------------------------------
        // DIFFICULTÉ (GM -> player)
        // ---------------------------------
        if (payload.type === "difficultyResponse") {
          if (payload?.toUserId !== game.user?.id) return;

          console.log("[ARCANE XV][DIFF][PLAYER] response received", {
            requestId: payload.requestId,
            toUserId: payload.toUserId,
            difficulty: payload.difficulty,
            decidedBy: payload.decidedBy
          });

          const pending = CardManager.#pendingDifficulty.get(payload.requestId);
          if (!pending) {
            console.warn("[ARCANE XV][DIFF][PLAYER] no pending request found", { requestId: payload.requestId });
            return;
          }

          CardManager.#pendingDifficulty.delete(payload.requestId);
          pending.resolve({
            difficulty: Number(payload?.difficulty ?? 0),
            note: payload?.note ?? "",
            decidedBy: payload?.decidedBy ?? "GM"
          });
          return;
        }

        // ---------------------------------
        // MONTE-CRISTO (prompt owner)
        // ---------------------------------
        if (payload.type === "monteCristoPrompt") {
          if (payload?.toUserId !== game.user?.id) return;
          const actor = game.actors.get(payload.actorId);
          if (!actor) return;
          const deck = game.cards.get(actor.getFlag("arcane15", "deck"));
          const hand = game.cards.get(actor.getFlag("arcane15", "hand"));
          const pile = game.cards.get(actor.getFlag("arcane15", "pile"));
          if (!deck || !hand || !pile) return;
          await CardManager._offerMonteCristo(actor, deck, hand, pile, true);
          return;
        }

        // ---------------------------------
        // GM OPS (fallback permissions)
        // ---------------------------------
        if (payload.type === "gmCycleCard") {
          if (!game.user?.isGM) return;

          const { opId, actorId, cardId } = payload;
          console.log("[ARCANE XV][GMOP][RECV] gmCycleCard", { opId, actorId, cardId });

          try {
            const actor = game.actors.get(actorId);
            if (!actor) throw new Error(`Actor introuvable: ${actorId}`);

            const hand = game.cards.get(actor.getFlag("arcane15", "hand"));
            const card = hand?.cards?.get(cardId) ?? null;
            if (!hand || !card) throw new Error("Main/carte introuvable (GM cycle)");

            console.log("[ARCANE XV][GMOP] executing cycle as GM", { actor: actor.name, cardId });

            await CardManager.cycleCard(actor, card, { forceAsGM: true });

            console.log("[ARCANE XV][GMOP] cycle done ok", { opId });

            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: true
            });
          } catch (e) {
            console.error("[ARCANE XV][GMOP] gmCycleCard ERROR", e);
            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: false,
              error: String(e?.message ?? e)
            });
          }
          return;
        }

        if (payload.type === "gmSwapSubstitutionCards") {
          if (!game.user?.isGM) return;

          const { opId, actorId, originalCardId, replacementCardId } = payload;
          console.log("[ARCANE XV][GMOP][RECV] gmSwapSubstitutionCards", { opId, actorId, originalCardId, replacementCardId });

          try {
            const actor = game.actors.get(actorId);
            if (!actor) throw new Error(`Actor introuvable: ${actorId}`);

            await CardManager.swapSubstitutionCards(actor, originalCardId, replacementCardId, { forceAsGM: true });

            console.log("[ARCANE XV][GMOP] substitution swap done ok", { opId });

            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: true
            });
          } catch (e) {
            console.error("[ARCANE XV][GMOP] gmSwapSubstitutionCards ERROR", e);
            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: false,
              error: String(e?.message ?? e)
            });
          }
          return;
        }

        if (payload.type === "gmTemporaryDrawCard") {
          if (!game.user?.isGM) return;

          const { opId, actorId, label } = payload;
          console.log("[ARCANE XV][GMOP][RECV] gmTemporaryDrawCard", { opId, actorId, label });

          try {
            const actor = game.actors.get(actorId);
            if (!actor) throw new Error(`Actor introuvable: ${actorId}`);

            const result = await CardManager.temporaryDrawCard(actor, label, { forceAsGM: true });

            console.log("[ARCANE XV][GMOP] temporary draw done ok", { opId, actor: actor.name, result });

            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: true,
              result
            });
          } catch (e) {
            console.error("[ARCANE XV][GMOP] gmTemporaryDrawCard ERROR", e);
            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "gmOpResult",
              opId,
              toUserId: payload.fromUserId,
              ok: false,
              error: String(e?.message ?? e)
            });
          }
          return;
        }

        if (payload.type === "gmOpResult") {
          if (payload?.toUserId !== game.user?.id) return;

          console.log("[ARCANE XV][GMOP][PLAYER] result received", payload);

          const pending = CardManager.#pendingGmOps.get(payload.opId);
          if (!pending) {
            console.warn("[ARCANE XV][GMOP][PLAYER] no pending op found", { opId: payload.opId });
            return;
          }

          CardManager.#pendingGmOps.delete(payload.opId);
          pending.resolve({ ok: !!payload.ok, error: payload.error ?? "", result: payload.result ?? null });
          return;
        }
      } catch (e) {
        console.error("[ARCANE XV][SOCKET][ERROR]", e, payload);
      } finally {
        const dt = Date.now() - t0;
        console.log("[ARCANE XV][SOCKET] handler duration", { ms: dt, type: payload?.type });
      }
    });
  }

  static _getActiveGM() {
    return game.users?.find(u => u.isGM && u.active) ?? null;
  }

  // --------------------------
  // OWNERSHIP (FIX PERMISSIONS) - inchangé
  // --------------------------
  static _buildOwnershipForActor(actor) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };

    const aOwn = actor?.ownership ?? {};
    for (const [uid, lvl] of Object.entries(aOwn)) {
      if (Number(lvl) >= OWNER) ownership[uid] = OWNER;
    }

    for (const u of (game.users?.contents ?? [])) {
      if (u.isGM) ownership[u.id] = OWNER;
    }

    return ownership;
  }

  static async _ensureCardsOwnership(actor, cardsDoc, label) {
    if (!cardsDoc) return;

    const desired = CardManager._buildOwnershipForActor(actor);

    const current = cardsDoc.ownership ?? {};
    let different = false;

    for (const [uid, lvl] of Object.entries(desired)) {
      if (Number(current?.[uid] ?? current?.default ?? 0) !== Number(lvl)) {
        different = true;
        break;
      }
    }

    if (!different) {
      console.log("[ARCANE XV][OWN] OK", { cards: label, id: cardsDoc.id });
      return;
    }

    console.log("[ARCANE XV][OWN] Updating ownership", { cards: label, id: cardsDoc.id, desired });
    await cardsDoc.update({ ownership: desired });
  }

  // --------------------------
  // Helpers cards
  // --------------------------
  static _getCardImg(card) {
    const f = card?.flags?.arcane15 ?? {};
    const systemId = game.system?.id || "arcane15";
    const rootPath = `/systems/${systemId}/assets/axvc01_tarot_v1v1`;
    const filePrefix = "axvc01";

    const normalizeSuit = (s) => {
      s = String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (!s) return "";
      if (s.startsWith("bat")) return "batons";
      if (s.startsWith("cou")) return "coupes";
      if (s.startsWith("den")) return "deniers";
      if (s.startsWith("epe")) return "epees";
      return s;
    };

    const buildCanonical = () => {
      const isJoker = !!f.isJoker;
      const suit = normalizeSuit(f.suit);
      if (isJoker) return `${rootPath}/${filePrefix}_epees12_cavalier.png`;
      const value = Number(f.value ?? 0);
      const rankMap = {
        1: "01", 2: "02", 3: "03", 4: "04", 5: "05", 6: "06", 7: "07", 8: "08", 9: "09", 10: "10",
        11: "11_valet", 12: "13_reine", 13: "14_roi"
      };
      const rank = rankMap[value];
      if (!rank || !suit) return "";
      return `${rootPath}/${filePrefix}_${suit}${rank}.png`;
    };

    const canonical = buildCanonical();
    const candidate = card?.face?.img ?? card?.faces?.[0]?.img ?? card?.img ?? "";
    const looksBack = /dos-cartes|back|cardback/i.test(String(candidate || ""));
    const broken = !candidate || /hazard\.svg/i.test(String(candidate || ""));
    if (canonical && (broken || looksBack)) return canonical;
    if (canonical) return canonical;
    return candidate || "";
  }

  static _getCardName(card) {
    const f = card?.flags?.arcane15 ?? {};
    return f.displayName ?? card?.name ?? card?.face?.name ?? card?.faces?.[0]?.name ?? "(carte sans nom)";
  }

  static _mkImgUrl(rootPath, filename) {
    return `${rootPath}/${filename}`;
  }

  static _expectedFaceImg(rootPath, filePrefix, card) {
    const f = card?.flags?.arcane15 ?? {};
    if (f.isJoker) return `${rootPath}/${filePrefix}_epees12_cavalier.png`;
    const suitMap = { 'bâton':'batons','baton':'batons','batons':'batons','coupe':'coupes','coupes':'coupes','denier':'deniers','deniers':'deniers','épée':'epees','epee':'epees','epees':'epees' };
    const suitId = suitMap[String(f.suit || '').toLowerCase()] || null;
    const val = Number(f.value ?? 0);
    const rankMap = {1:'01',2:'02',3:'03',4:'04',5:'05',6:'06',7:'07',8:'08',9:'09',10:'10',11:'11_valet',12:'13_reine',13:'14_roi'};
    const rank = rankMap[val] || null;
    if (suitId && rank) return `${rootPath}/${filePrefix}_${suitId}${rank}.png`;
    return null;
  }

  static async _repairFaceImages(cardsDoc, rootPath, filePrefix) {
    const updates = [];
    for (const c of cardsDoc?.cards?.contents || []) {
      const expected = CardManager._expectedFaceImg(rootPath, filePrefix, c);
      if (!expected) continue;
      const currentFace = c?.face?.img ?? c?.faces?.[0]?.img ?? '';
      const currentImg = c?.img ?? '';
      if (currentFace !== expected || currentImg !== expected) {
        updates.push({ _id: c.id, img: expected, faces: [{ name: CardManager._getCardName(c), img: expected }] });
      }
    }
    if (updates.length) {
      console.log('[ARCANE XV][CARD] repairing face images', { cardsId: cardsDoc.id, count: updates.length });
      await cardsDoc.updateEmbeddedDocuments('Card', updates);
    }
  }

  static _isJoker(card) {
    return !!card?.flags?.arcane15?.isJoker;
  }

  static async _ensureHandJoker({ actor, hand, rootPath, filePrefix, jokerSuitId, jokerRankFile }) {
    const existing = hand.cards.contents.find(c => CardManager._isJoker(c));
    if (existing) return existing;

    const imgFile = `${filePrefix}_${jokerSuitId}${jokerRankFile}.png`;
    const imgPath = CardManager._mkImgUrl(rootPath, imgFile);

    console.log("[ARCANE XV][JOKER] Création Joker", { actor: actor.name, handId: hand.id, imgPath });

    const created = await hand.createEmbeddedDocuments("Card", [{
      name: "Joker",
      type: "base",
      img: imgPath,
      faces: [{ name: "Joker", img: imgPath }],
      system: {},
      flags: { arcane15: { displayName: "Joker", value: 0, suit: "Joker", isJoker: true } }
    }]);

    return created?.[0] ?? null;
  }



  static async _normalizeHandSize({ actor, deck, hand, pile }) {
    if (!deck || !hand || !pile) return;

    const cards = hand.cards.contents.slice();
    const jokers = cards.filter(c => CardManager._isJoker(c));
    const nonJokers = cards.filter(c => !CardManager._isJoker(c));

    // Un seul joker doit rester en main.
    const extraJokers = jokers.slice(1);
    if (extraJokers.length) {
      await hand.deleteEmbeddedDocuments("Card", extraJokers.map(c => c.id));
    }

    // La main doit contenir exactement 3 cartes non-joker + 1 joker.
    const refreshed = hand.cards.contents.slice();
    const refreshedNonJokers = refreshed.filter(c => !CardManager._isJoker(c));

    if (refreshedNonJokers.length > 3) {
      const extras = refreshedNonJokers.slice(3).map(c => c.id);
      if (extras.length) {
        await hand.pass(pile, extras, { chatNotification: false });
      }
    }

    const afterTrim = hand.cards.contents.filter(c => !CardManager._isJoker(c)).length;
    if (afterTrim < 3) {
      const needed = 3 - afterTrim;

      // Recycle discard pile if the deck does not have enough REALLY available cards.
      const availableBeforeRecycle = Array.isArray(deck.availableCards)
        ? deck.availableCards.length
        : deck.cards.contents.filter(c => !c.drawn).length;

      if (availableBeforeRecycle < needed) {
        const pileIds = pile.cards.contents.filter(c => !CardManager._isJoker(c)).map(c => c.id);
        if (pileIds.length) {
          console.log("[ARCANE XV][HAND] recycling discard pile before deal", {
            deckAvailable: availableBeforeRecycle,
            pileRecycled: pileIds.length,
            needed
          });
          await pile.pass(deck, pileIds, {
            chatNotification: false,
            updateData: { drawn: false }
          });
          await deck.shuffle();
        }
      }

      // Only deal if the deck actually has drawable cards now.
      const available = Array.isArray(deck.availableCards)
        ? deck.availableCards.length
        : deck.cards.contents.filter(c => !c.drawn).length;

      if (available > 0) {
        await deck.deal([hand], Math.min(needed, available), { chatNotification: false });
      } else {
        console.warn("[ARCANE XV][HAND] deck still empty after recycle — cannot deal", {
          actor: actor?.name,
          deckAvailable: 0,
          pileSize: pile.cards.size
        });
      }
    }

    const jokerCount = hand.cards.contents.filter(c => CardManager._isJoker(c)).length;
    if (jokerCount < 1) {
      const sysId = game.system.id;
      const rootPath = `/systems/${sysId}/assets/axvc01_tarot_v1v1`;
      await CardManager._ensureHandJoker({
        actor,
        hand,
        rootPath,
        filePrefix: 'axvc01',
        jokerSuitId: 'epees',
        jokerRankFile: '12_cavalier'
      });
    }
  }

  // --------------------------
  // INIT Deck/Hand/Pile + 52 cards + ownership
  // --------------------------

  static async _offerMonteCristo(actor, deck, hand, pile, forceLocal = false) {
    try {
      const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
      if (!ArcanaManager?.getCharacterAtouts || !actor || !deck || !hand || !pile) return;
      if (!ArcanaManager.getCharacterAtouts(actor).some(a => a.key === 'monte-cristo')) return;

      const ownerUser = (game.users?.contents ?? []).find(u => {
        if (!u?.active || u?.isGM) return false;
        try { return !!actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER); } catch (_) { return false; }
      }) || null;

      if (!forceLocal && ownerUser && String(ownerUser.id) !== String(game.user?.id)) {
        if (game.user?.isGM) {
          game.socket.emit(CardManager.SOCKET_CHANNEL, { type: 'monteCristoPrompt', toUserId: ownerUser.id, actorId: actor.id });
        }
        return;
      }

      if (ownerUser && String(ownerUser.id) !== String(game.user?.id) && !game.user?.isGM) return;

      const lockKey = `${actor.id}`;
      if (CardManager.#monteCristoPrompting.has(lockKey)) return;

      let seen = Array.isArray(actor.getFlag?.('arcane15', 'monteCristoSeenAces')) ? [...actor.getFlag('arcane15', 'monteCristoSeenAces')] : [];
      const aceCards = hand.cards.contents.filter(c => !CardManager._isJoker(c) && Number(c.flags?.arcane15?.value ?? 0) === 1);
      seen = seen.filter(cardId => aceCards.some(card => String(card.id) === String(cardId)));
      const ace = aceCards.find(card => !seen.includes(card.id));
      await actor.setFlag('arcane15', 'monteCristoSeenAces', seen);
      if (!ace) return;

      CardManager.#monteCristoPrompting.add(lockKey);
      const finish = async (discardAce) => {
        try {
          if (discardAce) {
            await hand.pass(pile, [ace.id], { chatNotification: false });
            await CardManager._normalizeHandSize({ actor, deck, hand, pile });
            const currentSeen = Array.isArray(actor.getFlag?.('arcane15', 'monteCristoSeenAces')) ? [...actor.getFlag('arcane15', 'monteCristoSeenAces')] : [];
            await actor.setFlag('arcane15', 'monteCristoSeenAces', currentSeen.filter(cardId => String(cardId) !== String(ace.id)));
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `
                <div class="axv-chat-card" style="width:100%; max-width:100%; box-sizing:border-box; border:2px solid #3d5875; border-radius:16px; overflow:hidden; background:linear-gradient(180deg, #f7fbff 0%, #ffffff 100%); box-shadow:0 10px 24px rgba(18, 31, 48, .14);">
                  <div style="padding:8px 12px; background:linear-gradient(90deg, #3d5875 0%, #161616 100%); color:#fff;">
                    <div style="font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:900; opacity:.95;">Atout de personnage</div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:4px;">
                      <div style="font-weight:900; font-size:16px; line-height:1.15;">Le Comte de Monte-Cristo</div>
                      <div style="flex:0 0 auto; white-space:nowrap; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.24); background:rgba(255,255,255,.16); font-size:11px; font-weight:900; text-transform:uppercase;">Déclenchement</div>
                    </div>
                    <div style="margin-top:4px; font-size:12px; opacity:.92;">${actor.name}</div>
                  </div>
                  <div style="padding:12px 14px; color:#1d2530; line-height:1.45;">Un <strong>As</strong> a été défaussé puis remplacé immédiatement.</div>
                </div>`
            });
          } else {
            const currentSeen = Array.isArray(actor.getFlag?.('arcane15', 'monteCristoSeenAces')) ? [...actor.getFlag('arcane15', 'monteCristoSeenAces')] : [];
            if (!currentSeen.includes(ace.id)) currentSeen.push(ace.id);
            await actor.setFlag('arcane15', 'monteCristoSeenAces', currentSeen);
          }
        } finally {
          CardManager.#monteCristoPrompting.delete(lockKey);
        }
      };

      const dlg = new DialogV2({
        window: { title: 'Le Comte de Monte-Cristo' },
        content: `<div><p><strong>${actor.name}</strong> vient de piocher un as : <strong>${CardManager._getCardName(ace)}</strong>.</p><p>Souhaites-tu le défausser immédiatement pour piocher une nouvelle carte ?</p></div>`,
        buttons: [
          { action: 'keep', label: 'Garder l’as', default: true, callback: async () => finish(false) },
          { action: 'discard', label: 'Défausser et repiocher', callback: async () => finish(true) }
        ]
      });
      await dlg.render({ force: true });
    } catch (error) {
      console.warn('[ARCANE XV][MONTE-CRISTO] prompt failed', error);
    }
  }

  static async initActorDecks(actor) {
    if (!game.cards) return;

    const lockKey = actor.id;
    if (CardManager.#initLocks.has(lockKey)) return CardManager.#initLocks.get(lockKey);

    const p = (async () => {
      console.log(`%c[ARCANE XV][INIT] DÉMARRAGE pour : ${actor.name} (${actor.id})`, "color: cyan; font-weight:bold;");

      const sysId = game.system.id;
      const rootPath = `/systems/${sysId}/assets/axvc01_tarot_v1v1`;
      const filePrefix = "axvc01";

      const suits = [
        { name: "Bâton", id: "batons" },
        { name: "Coupe", id: "coupes" },
        { name: "Denier", id: "deniers" },
        { name: "Épée", id: "epees" }
      ];

      const ranks = [
        { val: 1,  file: "01", label: "As" },
        { val: 2,  file: "02", label: "2" },
        { val: 3,  file: "03", label: "3" },
        { val: 4,  file: "04", label: "4" },
        { val: 5,  file: "05", label: "5" },
        { val: 6,  file: "06", label: "6" },
        { val: 7,  file: "07", label: "7" },
        { val: 8,  file: "08", label: "8" },
        { val: 9,  file: "09", label: "9" },
        { val: 10, file: "10", label: "10" },
        { val: 11, file: "11_valet", label: "Valet" },
        { val: 12, file: "12_cavalier", label: "Cavalier" }, // retiré deck
        { val: 12, file: "13_reine", label: "Dame" },
        { val: 13, file: "14_roi", label: "Roi" }
      ];

      const JOKER_SUIT_ID = "epees";
      const JOKER_RANK_FILE = "12_cavalier";

      const deckName = `${actor.name.trim()} - Pioche`;
      const handName = `${actor.name.trim()} - Main`;
      const pileName = `${actor.name.trim()} - Défausse`;

      const deckId = actor.getFlag("arcane15", "deck");
      const handId = actor.getFlag("arcane15", "hand");
      const pileId = actor.getFlag("arcane15", "pile");

      let deck = deckId ? game.cards.get(deckId) : null;
      let hand = handId ? game.cards.get(handId) : null;
      let pile = pileId ? game.cards.get(pileId) : null;

      if (!deck || !hand || !pile) {
        deck = deck ?? (game.cards.find(c => c.name === deckName && c.type === "deck") ?? null);
        hand = hand ?? (game.cards.find(c => c.name === handName && c.type === "hand") ?? null);
        pile = pile ?? (game.cards.find(c => c.name === pileName && c.type === "pile") ?? null);
        if (deck && hand && pile) {
          await actor.setFlag("arcane15", "deck", deck.id);
          await actor.setFlag("arcane15", "hand", hand.id);
          await actor.setFlag("arcane15", "pile", pile.id);
        }
      }

      if (!deck || !hand || !pile) {
        const coverImg = CardManager._mkImgUrl(rootPath, `${filePrefix}__dos-cartes.png`);
        deck = await Cards.create({ name: deckName, type: "deck", img: coverImg, system: {} });
        hand = await Cards.create({ name: handName, type: "hand", system: {} });
        pile = await Cards.create({ name: pileName, type: "pile", system: {} });

        await actor.setFlag("arcane15", "deck", deck.id);
        await actor.setFlag("arcane15", "hand", hand.id);
        await actor.setFlag("arcane15", "pile", pile.id);

        const cardData = [];
        for (const s of suits) {
          for (const r of ranks) {
            if (r.val === 12) continue;
            const imgFile = `${filePrefix}_${s.id}${r.file}.png`;
            const imgPath = CardManager._mkImgUrl(rootPath, imgFile);
            const cardName = `${r.label} de ${s.name}`;
            cardData.push({
              name: cardName,
              type: "base",
              img: imgPath,
              faces: [{ name: cardName, img: imgPath }],
              system: {},
              flags: { arcane15: { displayName: cardName, value: r.val, suit: s.name, isJoker: false } }
            });
          }
        }
        await deck.createEmbeddedDocuments("Card", cardData);
        await deck.shuffle();
        await deck.deal([hand], 3, { chatNotification: false });
      }

      try {
        await CardManager._ensureCardsOwnership(actor, deck, "deck");
        await CardManager._ensureCardsOwnership(actor, hand, "hand");
        await CardManager._ensureCardsOwnership(actor, pile, "pile");
      } catch (e) {
        console.warn("[ARCANE XV][OWN] update ownership failed (likely non-GM caller)", e);
      }

      try {
        await CardManager._repairFaceImages(deck, rootPath, filePrefix);
        await CardManager._repairFaceImages(hand, rootPath, filePrefix);
        await CardManager._repairFaceImages(pile, rootPath, filePrefix);
      } catch (e) {
        console.warn('[ARCANE XV][CARD] repair face images failed', e);
      }

      await CardManager._ensureHandJoker({
        actor, hand, rootPath, filePrefix, jokerSuitId: JOKER_SUIT_ID, jokerRankFile: JOKER_RANK_FILE
      });

      await CardManager._normalizeHandSize({ actor, deck, hand, pile });
      await CardManager._offerMonteCristo(actor, deck, hand, pile);

      const finalJokerCount = hand.cards.contents.filter(c => CardManager._isJoker(c)).length;
      const finalNonJokerCount = hand.cards.contents.filter(c => !CardManager._isJoker(c)).length;
      console.log("[ARCANE XV][HAND] normalized", { actor: actor.name, handCount: hand.cards.size, nonJokerCount: finalNonJokerCount, jokerCount: finalJokerCount });

      console.log(`%c[ARCANE XV][INIT] TERMINÉ pour : ${actor.name}`, "color:#2ecc71;font-weight:bold;");
    })()
      .catch(err => {
        console.error("[ARCANE XV][INIT][ERROR]", err);
        throw err;
      })
      .finally(() => CardManager.#initLocks.delete(lockKey));

    CardManager.#initLocks.set(lockKey, p);
    return p;
  }

  // --------------------------
  // GM Cycle helper (player -> GM)
  // --------------------------
  static async _requestGmCycle(actor, card) {
    CardManager.ensureSocket();

    const activeGM = CardManager._getActiveGM();
    if (!activeGM || !game.socket) {
      ui.notifications.error("Permissions cartes: MJ indisponible. (Active GM absent)");
      throw new Error("Active GM absent");
    }

    const opId = foundry.utils.randomID();
    console.log("[ARCANE XV][GMOP][PLAYER] request gmCycleCard", { opId, actorId: actor.id, cardId: card.id });

    const p = new Promise((resolve) => CardManager.#pendingGmOps.set(opId, { resolve, createdAt: Date.now() }));

    game.socket.emit(CardManager.SOCKET_CHANNEL, {
      type: "gmCycleCard",
      opId,
      fromUserId: game.user.id,
      actorId: actor.id,
      cardId: card.id
    });

    // Timeout GM op
    setTimeout(() => {
      const pending = CardManager.#pendingGmOps.get(opId);
      if (pending) {
        CardManager.#pendingGmOps.delete(opId);
        pending.resolve({ ok: false, error: "Timeout GM op" });
      }
    }, 15_000);

    const res = await p;
    if (!res.ok) {
      ui.notifications.error(`Cycle GM refusé/échoué: ${res.error || "erreur"}`);
      throw new Error(res.error || "GM cycle failed");
    }
    return true;
  }

  static async _requestGmSwapSubstitution(actor, originalCardId, replacementCardId) {
    CardManager.ensureSocket();

    const activeGM = CardManager._getActiveGM();
    if (!activeGM || !game.socket) {
      ui.notifications.error("Permissions cartes: MJ indisponible. (Active GM absent)");
      throw new Error("Active GM absent");
    }

    const opId = foundry.utils.randomID();
    console.log("[ARCANE XV][GMOP][PLAYER] request gmSwapSubstitutionCards", { opId, actorId: actor.id, originalCardId, replacementCardId });

    const p = new Promise((resolve) => CardManager.#pendingGmOps.set(opId, { resolve, createdAt: Date.now() }));

    game.socket.emit(CardManager.SOCKET_CHANNEL, {
      type: "gmSwapSubstitutionCards",
      opId,
      fromUserId: game.user.id,
      actorId: actor.id,
      originalCardId,
      replacementCardId
    });

    setTimeout(() => {
      const pending = CardManager.#pendingGmOps.get(opId);
      if (pending) {
        CardManager.#pendingGmOps.delete(opId);
        pending.resolve({ ok: false, error: "Timeout GM op" });
      }
    }, 15_000);

    const res = await p;
    if (!res.ok) {
      ui.notifications.error(`Échange GM refusé/échoué: ${res.error || "erreur"}`);
      throw new Error(res.error || "GM substitution swap failed");
    }
    return true;
  }

  static async _requestGmTemporaryDraw(actor, label = "Pioche d’arcane") {
    CardManager.ensureSocket();

    const activeGM = CardManager._getActiveGM();
    if (!activeGM || !game.socket) {
      ui.notifications.error("Permissions cartes: MJ indisponible. (Active GM absent)");
      throw new Error("Active GM absent");
    }

    const opId = foundry.utils.randomID();
    console.log("[ARCANE XV][GMOP][PLAYER] request gmTemporaryDrawCard", { opId, actorId: actor.id, label });

    const p = new Promise((resolve) => CardManager.#pendingGmOps.set(opId, { resolve, createdAt: Date.now() }));

    game.socket.emit(CardManager.SOCKET_CHANNEL, {
      type: "gmTemporaryDrawCard",
      opId,
      fromUserId: game.user.id,
      actorId: actor.id,
      label
    });

    setTimeout(() => {
      const pending = CardManager.#pendingGmOps.get(opId);
      if (pending) {
        CardManager.#pendingGmOps.delete(opId);
        pending.resolve({ ok: false, error: "Timeout GM op", result: null });
      }
    }, 15_000);

    const res = await p;
    if (!res.ok) {
      ui.notifications.error(`Pioche GM refusée/échouée: ${res.error || "erreur"}`);
      throw new Error(res.error || "GM temporary draw failed");
    }
    return res.result ?? null;
  }

  // --------------------------
  // Cycle: main -> défausse, pioche 1, recycle
  // --------------------------
  static async cycleCard(actor, card, { forceAsGM = false } = {}) {
    try {
      if (!card) return;
      if (CardManager._isJoker(card)) return;

      // IMPORTANT: si joueur (non-GM), on fait exécuter le cycle par le MJ directement
      // pour éviter les moves partiels (create OK / delete refusé) qui créent des doublons _id.
      if (!game.user?.isGM && !forceAsGM) {
        console.warn("[ARCANE XV][CYCLE] player cycle -> delegate to GM", {
          actor: actor.name,
          cardId: card.id,
          user: game.user?.name
        });
        return await CardManager._requestGmCycle(actor, card);
      }

      const deck = game.cards.get(actor.getFlag("arcane15", "deck"));
      const hand = game.cards.get(actor.getFlag("arcane15", "hand"));
      const pile = game.cards.get(actor.getFlag("arcane15", "pile"));

      if (!deck || !hand || !pile) throw new Error("deck/hand/pile introuvables");

      console.log("[ARCANE XV][CYCLE] start", {
        actor: actor.name,
        cardId: card.id,
        isGM: game.user?.isGM,
        forceAsGM
      });

      const inHand = hand.cards.get(card.id);
      const inPile = pile.cards.get(card.id);

      // Anti-doublon minimal (répare l’état cassé si un move partiel a déjà eu lieu auparavant)
      if (inHand && inPile) {
        console.warn("[ARCANE XV][CYCLE] duplicate card id detected (hand+pîle) -> delete hand copy", {
          cardId: card.id,
          handId: hand.id,
          pileId: pile.id
        });
        await hand.deleteEmbeddedDocuments("Card", [inHand.id]);
      } else if (inHand) {
        await hand.pass(pile, [inHand.id], { chatNotification: false });
      } else {
        console.warn("[ARCANE XV][CYCLE] card not found in hand at cycle time", { cardId: card.id, handId: hand.id });
      }

      // Remet toujours la main à 3 cartes non-joker + 1 joker.
      // Cela couvre aussi l'initiative et le combat si la main était déjà dégradée
      // ou si la défausse doit être recyclée avant de repiocher.
      await CardManager._normalizeHandSize({ actor, deck, hand, pile });
      await CardManager._offerMonteCristo(actor, deck, hand, pile);

      console.log("[ARCANE XV][CYCLE] done", { actor: actor.name, handCount: hand.cards.size, deckCount: deck.cards.size, pileCount: pile.cards.size });
    } catch (e) {
      console.error("[ARCANE XV][CYCLE][ERROR] exception", e);
      ui.notifications.error("Erreur cycle carte (voir console).");
      throw e;
    }
  }

  static async temporaryDrawCard(actor, label = "Pioche d’arcane", { forceAsGM = false } = {}) {
    try {
      if (!actor) return null;

      if (!game.user?.isGM && !forceAsGM) {
        console.warn("[ARCANE XV][TEMPDRAW] player draw -> delegate to GM", { actor: actor.name, label, user: game.user?.name });
        return await CardManager._requestGmTemporaryDraw(actor, label);
      }

      let deck = game.cards.get(actor.getFlag("arcane15", "deck"));
      let hand = game.cards.get(actor.getFlag("arcane15", "hand"));
      let pile = game.cards.get(actor.getFlag("arcane15", "pile"));

      if (!deck || !hand || !pile) {
        await CardManager.initActorDecks(actor);
        deck = game.cards.get(actor.getFlag("arcane15", "deck"));
        hand = game.cards.get(actor.getFlag("arcane15", "hand"));
        pile = game.cards.get(actor.getFlag("arcane15", "pile"));
      }

      if (!deck || !hand || !pile) return null;

      const available = Array.isArray(deck.availableCards) ? deck.availableCards.length : deck.cards.contents.filter(c => !c.drawn).length;
      if (available < 1) {
        const pileIds = pile.cards.contents.filter(c => !CardManager._isJoker(c)).map(c => c.id);
        if (pileIds.length) {
          await pile.pass(deck, pileIds, { chatNotification: false, updateData: { drawn: false } });
          await deck.shuffle();
        }
      }

      const before = new Set(hand.cards.contents.map(c => c.id));
      await deck.deal([hand], 1, { chatNotification: false });
      const drawn = hand.cards.contents.find(c => !before.has(c.id) && !CardManager._isJoker(c)) || null;
      if (!drawn) return null;

      const info = {
        id: drawn.id,
        value: Number(drawn.flags?.arcane15?.value ?? 0),
        name: CardManager._getCardName(drawn),
        img: CardManager._getCardImg(drawn) || drawn.img || "icons/svg/hazard.svg",
        label
      };

      await hand.pass(pile, [drawn.id], { chatNotification: false });
      await CardManager._normalizeHandSize({ actor, deck, hand, pile });
      return info;
    } catch (e) {
      console.error("[ARCANE XV][TEMPDRAW][ERROR]", e);
      throw e;
    }
  }

  static async swapSubstitutionCards(actor, originalCardId, replacementCardId, { forceAsGM = false } = {}) {
    try {
      if (!actor || !originalCardId || !replacementCardId) throw new Error("Paramètres de substitution invalides.");

      if (!game.user?.isGM && !forceAsGM) {
        console.warn("[ARCANE XV][SUBSTITUTION] player swap -> delegate to GM", {
          actor: actor.name,
          originalCardId,
          replacementCardId,
          user: game.user?.name
        });
        return await CardManager._requestGmSwapSubstitution(actor, originalCardId, replacementCardId);
      }

      const hand = game.cards.get(actor.getFlag("arcane15", "hand"));
      const pile = game.cards.get(actor.getFlag("arcane15", "pile"));
      if (!hand || !pile) throw new Error("Main/défausse introuvables.");

      const originalInHand = hand.cards.get(originalCardId) ?? null;
      const replacementInHand = hand.cards.get(replacementCardId) ?? null;
      const originalInPile = pile.cards.get(originalCardId) ?? null;
      const replacementInPile = pile.cards.get(replacementCardId) ?? null;

      console.log("[ARCANE XV][SUBSTITUTION] swap start", {
        actor: actor.name,
        originalCardId,
        replacementCardId,
        originalInHand: !!originalInHand,
        originalInPile: !!originalInPile,
        replacementInHand: !!replacementInHand,
        replacementInPile: !!replacementInPile,
        isGM: game.user?.isGM,
        forceAsGM
      });

      if (originalInHand && replacementInPile) {
        console.log("[ARCANE XV][SUBSTITUTION] swap already applied", { actor: actor.name, originalCardId, replacementCardId });
        return true;
      }
      if (!originalInPile) throw new Error("Carte initiale introuvable dans la défausse.");
      if (!replacementInHand) throw new Error("Carte repiochée introuvable dans la main.");

      await hand.pass(pile, [replacementInHand.id], { chatNotification: false });
      try {
        await pile.pass(hand, [originalInPile.id], { chatNotification: false });
      } catch (e) {
        const replacementNowInPile = pile.cards.get(replacementCardId) ?? null;
        if (replacementNowInPile) {
          try {
            await pile.pass(hand, [replacementNowInPile.id], { chatNotification: false });
          } catch (rollbackError) {
            console.error("[ARCANE XV][SUBSTITUTION] rollback failed", rollbackError);
          }
        }
        throw e;
      }

      console.log("[ARCANE XV][SUBSTITUTION] swap done", { actor: actor.name, handCount: hand.cards.size, pileCount: pile.cards.size });
      return true;
    } catch (e) {
      console.error("[ARCANE XV][SUBSTITUTION][ERROR]", e);
      ui.notifications.error(String(e?.message || e || "Erreur lors de la substitution."));
      throw e;
    }
  }

  // --------------------------
  // DIFFICULTÉ (GM dialog) - FIX: callbacks (pas actions)
  // --------------------------
  static async _gmHandleDifficultyRequest(req) {
    console.log("[ARCANE XV][DIFF][GM] request received", req);

    const requestId = req.requestId;
    const dialogId = `axv-diff-${requestId}`;

    const content = `
      <style>
        #${dialogId} .row { display:flex; gap:10px; align-items:center; margin:10px 0; }
        #${dialogId} input[type="number"]{ width:120px; }
        #${dialogId} textarea{ width:100%; min-height:64px; resize:vertical; }
      </style>
      <div id="${dialogId}">
        <div style="font-weight:900; margin-bottom:8px;">Demande de difficulté — ${req.fromUserName}</div>
        <div style="font-size:12px; opacity:.9;">Acteur: <strong>${req.actorName}</strong></div>
        <div style="font-size:12px; opacity:.9;">Compétence: <strong>${req.skillName}</strong></div>
        <div style="font-size:12px; opacity:.9;">Carte: <strong>${req.cardName}</strong> (+${Number(req.cardValue ?? 0)})</div>
        <div style="font-size:12px; opacity:.9;">Total: <strong>${Number(req.finalTotal ?? 0)}</strong></div>

        <div class="row">
          <label style="font-weight:800;">Difficulté</label>
          <input name="difficulty" type="number" value="10" min="0" step="1" />
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:800; margin-bottom:6px;">Note MJ (optionnel)</div>
          <textarea name="note" placeholder="..." ></textarea>
        </div>
      </div>
    `;

    console.log("[ARCANE XV][DIFF][GM] open dialog", { requestId, from: req.fromUserName, actorName: req.actorName });

    const dlg = new DialogV2({
      window: { title: "ARCANE XV — Fixer la difficulté" },
      content,
      rejectClose: false,
      buttons: [
        {
          action: "cancel",
          label: "Annuler",
          callback: async (event, button, dialog) => {
            console.log("[ARCANE XV][DIFF][GM] cancel clicked", { requestId });

            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "difficultyResponse",
              requestId,
              toUserId: req.fromUserId,
              difficulty: 0,
              note: "Annulé par le MJ",
              decidedBy: game.user?.name ?? "GM"
            });

            console.log("[ARCANE XV][DIFF][GM] difficultyResponse sent (cancel)", { requestId, toUserId: req.fromUserId });
            return "cancel";
          }
        },
        {
          action: "ok",
          label: "Valider",
          default: true,
          callback: async (event, button, dialog) => {
            const form = button?.form;
            const diff = Number(form?.elements?.difficulty?.value ?? 0);
            const note = String(form?.elements?.note?.value ?? "");

            console.log("[ARCANE XV][DIFF][GM] ok clicked", { requestId, diff, noteLen: note.length });

            game.socket.emit(CardManager.SOCKET_CHANNEL, {
              type: "difficultyResponse",
              requestId,
              toUserId: req.fromUserId,
              difficulty: diff,
              note,
              decidedBy: game.user?.name ?? "GM"
            });

            console.log("[ARCANE XV][DIFF][GM] difficultyResponse sent (ok)", { requestId, toUserId: req.fromUserId, diff });
            return "ok";
          }
        }
      ]
    });

    await dlg.render({ force: true });
    console.log("[ARCANE XV][DIFF][GM] dialog rendered", { requestId });
  }

  static async _requestDifficultyFromGM(context) {
    CardManager.ensureSocket();

    if (game.user?.isGM) {
      console.log("[ARCANE XV][DIFF] GM local -> default difficulty=10");
      return { difficulty: 10, note: "", decidedBy: game.user?.name ?? "GM" };
    }

    const activeGM = CardManager._getActiveGM();
    if (!activeGM || !game.socket) {
      console.warn("[ARCANE XV][DIFF] no active GM or socket -> fallback difficulty=10");
      return { difficulty: 10, note: "Fallback (no GM socket)", decidedBy: "system" };
    }

    const requestId = foundry.utils.randomID();
    const p = new Promise((resolve) => CardManager.#pendingDifficulty.set(requestId, { resolve, createdAt: Date.now() }));

    console.log("[ARCANE XV][DIFF][PLAYER] sending difficultyRequest", {
      requestId,
      fromUserId: game.user.id,
      toGM: activeGM.id,
      actorName: context.actor.name,
      skillName: context.skillName,
      cardName: context.cardName,
      finalTotal: context.finalTotal
    });

    game.socket.emit(CardManager.SOCKET_CHANNEL, {
      type: "difficultyRequest",
      requestId,
      fromUserId: game.user.id,
      fromUserName: game.user.name,
      actorId: context.actor.id,
      actorName: context.actor.name,
      skillKey: context.skillKey,
      skillName: context.skillName,
      skillValue: Number(context.skillValue ?? 0),
      cardId: context.card.id,
      cardName: context.cardName,
      cardValue: Number(context.cardValue ?? 0),
      finalTotal: Number(context.finalTotal ?? 0)
    });

    ui.notifications?.info?.("Demande de difficulté envoyée au MJ…");

    // Timeout
    setTimeout(() => {
      const pending = CardManager.#pendingDifficulty.get(requestId);
      if (pending) {
        console.warn("[ARCANE XV][DIFF][PLAYER] timeout -> fallback difficulty=10", { requestId });
        CardManager.#pendingDifficulty.delete(requestId);
        pending.resolve({ difficulty: 10, note: "Timeout MJ", decidedBy: "system" });
      }
    }, 90_000);

    const res = await p;
    console.log("[ARCANE XV][DIFF][PLAYER] resolved", { requestId, ...res });
    return res;
  }

  // --------------------------
  // UI main + clic = jouer
  // FIX: DialogV2 n’exécute pas des handlers "actions" pour du HTML arbitraire.
  // On attache un listener click après rendu.
  // --------------------------
  static async rollSkill(actor, skillKey) {
    CardManager.ensureSocket();

    let handId = actor.getFlag("arcane15", "hand");
    if (!handId || !game.cards.get(handId)) {
      await CardManager.initActorDecks(actor);
      handId = actor.getFlag("arcane15", "hand");
    }

    const hand = game.cards.get(handId);
    if (actor?.system?.stats?.mort) {
      ui.notifications?.warn?.("Ce personnage est mort.");
      return;
    }
    if (actor?.system?.stats?.inconscient) {
      ui.notifications?.warn?.("Ce personnage est inconscient.");
      return;
    }
    const skillData = actor.system?.competences?.[skillKey];
    const skillName = (skillKey.charAt(0).toUpperCase() + skillKey.slice(1)) + (skillData?.label ? ` (${skillData.label})` : "");
    const baseSkillValue = Number(skillData?.total ?? 0);
    const malEnPointMod = (actor?.system?.stats?.malEnPoint || actor?.getFlag?.("arcane15", "malEnPoint")) ? -1 : 0;
    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    const arcanaMods = ArcanaManager?.getSkillModifiers ? ArcanaManager.getSkillModifiers(actor, skillKey) : { net: 0, labels: [], consume: [] };
    const skillValue = baseSkillValue + malEnPointMod + Number(arcanaMods?.net || 0);

    const cards = hand.cards.contents.slice().sort((a, b) => {
      const aj = CardManager._isJoker(a);
      const bj = CardManager._isJoker(b);
      if (aj && !bj) return -1;
      if (!aj && bj) return 1;
      return Number(a.flags.arcane15?.value ?? 0) - Number(b.flags.arcane15?.value ?? 0);
    });

    const dialogId = `axv-hand-${Date.now()}`;
    const modifiersLine = [
      malEnPointMod ? `Mal en point ${malEnPointMod}` : "",
      ...(arcanaMods?.labels || [])
    ].filter(Boolean).join(" • ");

    const cardsHtml = cards.map(c => {
      const img = CardManager._getCardImg(c) || "icons/svg/hazard.svg";
      const name = CardManager._getCardName(c);
      const v = Number(c.flags.arcane15?.value ?? 0);
      const isJoker = CardManager._isJoker(c);

      return `
        <button class="axv-card" data-card-id="${c.id}" type="button" title="Jouer ${name}"
          style="all:unset; cursor:pointer; user-select:none; border-radius:16px; overflow:hidden;
                 border:1px solid rgba(0,0,0,.35); box-shadow: 0 10px 24px rgba(0,0,0,.18); background:#111;">
          <div style="position:relative; aspect-ratio: 2 / 3; width: 150px;">
            <img src="${img}" style="width:100%; height:100%; object-fit:cover; display:block;"
              onerror="console.error('[ARCANE XV][IMG][ERROR] img load failed', this.src); this.src='icons/svg/hazard.svg';" />
            <div style="position:absolute; inset:auto 0 0 0; padding:10px;
                        background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.82) 60%, rgba(0,0,0,.90) 100%);
                        color:#fff;">
              <div style="font-weight:800; font-size:13px; line-height:1.15; margin-bottom:2px;">${name}</div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:12px; opacity:.95;">${isJoker ? "Joker" : "Carte"}</div>
                <div style="font-weight:900; font-size:14px; padding:2px 8px; border-radius:999px;
                            background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.18);">
                  +${v}
                </div>
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("");

    const content = `
      <style>
        #${dialogId} .axv-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                                gap:14px; padding:4px; max-height:560px; overflow:auto; }
        #${dialogId} .axv-card { transition: transform .12s ease, box-shadow .12s ease, filter .12s ease; }
        #${dialogId} .axv-card:hover { transform: translateY(-4px) scale(1.02); filter: brightness(1.05);
                                      box-shadow: 0 14px 34px rgba(0,0,0,.26); }
        #${dialogId} .axv-top { display:flex; justify-content:space-between; align-items:flex-end; gap:12px;
                               padding:10px 12px; border:1px solid rgba(0,0,0,.18); border-radius:14px; background:#fff; }
        #${dialogId} .axv-title { font-weight:900; font-size:16px; }
        #${dialogId} .axv-sub { font-size:12px; opacity:.85; margin-top:4px; }
        #${dialogId} .axv-badge { font-weight:900; font-size:14px; padding:6px 10px; border-radius:999px;
                                 border:1px solid rgba(0,0,0,.18); background:rgba(0,0,0,.04); white-space:nowrap; }
        #${dialogId} .axv-hint { font-size:12px; opacity:.85; margin:10px 2px 0 2px; }
      </style>

      <div id="${dialogId}">
        <div class="axv-top">
          <div>
            <div class="axv-title">${actor.name} — ${skillName}</div>
            <div class="axv-sub">Clique sur une carte pour la jouer. Le MJ fixe la difficulté avant le résultat.</div>
            ${modifiersLine ? `<div class="axv-sub">Modificateurs : ${modifiersLine}</div>` : `<div class="axv-sub">Modificateurs : aucun</div>`}
          </div>
          <div class="axv-badge">Compétence finale : ${skillValue}</div>
        </div>
        <div class="axv-hint">Main : ${cards.length} carte(s)</div>
        <div class="axv-grid">${cardsHtml || `<div style="opacity:.8;">Aucune carte en main.</div>`}</div>
      </div>
    `;

    const dlg = new DialogV2({
      window: { title: `Main — ${skillName}` },
      content,
      rejectClose: false,
      buttons: [{ action: "close", label: "Fermer", default: true }]
    });

    await dlg.render({ force: true });

    console.log("[ARCANE XV][HAND] dialog rendered, binding click listener", { dialogId, handId: hand.id, cards: cards.length });

    const root = dlg.element?.querySelector(`#${dialogId}`);
    if (!root) {
      console.warn("[ARCANE XV][HAND] root not found after render", { dialogId, element: !!dlg.element });
      return;
    }

    let busy = false;

    root.addEventListener("click", async (ev) => {
      try {
        const btn = ev.target?.closest?.("button.axv-card[data-card-id]");
        if (!btn) return;

        const cardId = btn.dataset.cardId;
        console.log("[ARCANE XV][HAND] card click", { actor: actor.name, skillKey, cardId, busy });

        if (busy) return;
        busy = true;

        const card = hand.cards.get(cardId);
        if (!card) {
          ui.notifications.error("Carte introuvable.");
          console.warn("[ARCANE XV][HAND] card not found in hand", { cardId, handId: hand.id });
          busy = false;
          return;
        }

        const cardValue = Number(card.flags.arcane15?.value ?? 0);
        const cardName = CardManager._getCardName(card);
        const cardImg = CardManager._getCardImg(card) || "icons/svg/hazard.svg";
        const isJoker = CardManager._isJoker(card);
        const finalTotal = skillValue + cardValue;

        console.log("[ARCANE XV][ROLL] preparing difficulty request", {
          actor: actor.name, skillName, baseSkillValue, malEnPointMod, skillValue, cardName, cardValue, finalTotal, arcanaMods
        });

        const diff = await CardManager._requestDifficultyFromGM({
          actor, skillKey, skillName, skillValue, card, cardName, cardValue, finalTotal
        });

        const difficulty = Number(diff?.difficulty ?? 0);
        const success = finalTotal >= difficulty;
        const verdict = success ? "RÉUSSITE" : "ÉCHEC";
        const actionButtons = ArcanaManager?.getRollActionButtons
          ? ArcanaManager.getRollActionButtons(actor, skillKey, {
              skillName,
              difficulty,
              skillTotal: skillValue,
              cardValue,
              finalTotal,
              originalCardId: card.id,
              handSnapshot: hand.cards.contents.filter(c => !CardManager._isJoker(c)).map(c => c.id)
            })
          : "";

        console.log("[ARCANE XV][ROLL] difficulty resolved", { difficulty, verdict, finalTotal });

        await ChatMessage.create({
          content: `
  <div class="axv-chat-card" style="width:100%; max-width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,.2); border-radius:14px; overflow:hidden; background:#fff;">
    <div style="padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.12); font-weight:900; box-sizing:border-box;">
      ${actor.name} — ${skillName}
    </div>
    <div style="display:flex; gap:12px; padding:12px; min-width:0; box-sizing:border-box;">
      <img src="${cardImg}" style="width:84px; height:126px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,0,0,.25); flex:0 0 auto;" />
      <div style="flex:1; min-width:0; overflow-wrap:anywhere; word-break:break-word;">
        <div style="font-weight:900; font-size:14px; margin-bottom:6px; overflow-wrap:anywhere; word-break:break-word;">${cardName}</div>
        <div>Compétence de base : <strong>${baseSkillValue}</strong></div>
        <div>Modificateurs : <strong>${modifiersLine || "aucun"}</strong></div>
        <div>Compétence finale : <strong>${skillValue}</strong></div>
        <div>Carte : <strong>+${cardValue}</strong></div>
        <div>Difficulté (MJ) : <strong>${difficulty}</strong></div>
        <div style="margin-top:10px; font-weight:900; font-size:18px;">TOTAL : ${finalTotal}</div>
        <div style="margin-top:6px; font-weight:900; font-size:16px;">${verdict}</div>
        ${actionButtons || ""}
      </div>
    </div>
  </div>
`,
          speaker: ChatMessage.getSpeaker({ actor })
        });

        try {
          await actor.setFlag("arcane15", "lastSkillTest", {
            skillKey,
            skillName,
            difficulty,
            success,
            timestamp: Date.now(),
            finalTotal,
            skillTotal: skillValue,
            cardValue,
            source: "normal"
          });
        } catch (flagError) {
          console.warn("[ARCANE XV][ROLL] unable to store lastSkillTest", flagError);
        }

        if (arcanaMods?.consume?.length && ArcanaManager?.consumeSkillModifiers) {
          await ArcanaManager.consumeSkillModifiers(actor, arcanaMods.consume);
        }

        if (!isJoker) {
          console.log("[ARCANE XV][ROLL] cycling card after chat", { cardId: card.id });
          await CardManager.cycleCard(actor, card);
        }

        await dlg.close();
      } catch (e) {
        console.error("[ARCANE XV][HAND][CLICK][ERROR]", e);
        ui.notifications.error("Erreur lors du jeu de carte (voir console).");
      } finally {
        busy = false;
      }
    });
  }


  static async cleanupActorDecks(actor, { clearFlags = false } = {}) {
    try {
      if (!actor) return;
      if (!game.user?.isGM) {
        console.log("[ARCANE XV][CLEANUP] skipped (not GM)", { actor: actor?.name, user: game.user?.name });
        return;
      }

      const deckName = `${String(actor.name ?? '').trim()} - Pioche`;
      const handName = `${String(actor.name ?? '').trim()} - Main`;
      const pileName = `${String(actor.name ?? '').trim()} - Défausse`;

      const ids = [
        actor.getFlag("arcane15", "deck"),
        actor.getFlag("arcane15", "hand"),
        actor.getFlag("arcane15", "pile")
      ].filter(Boolean);

      const docs = [];
      for (const id of ids) {
        const d = game.cards.get(id);
        if (d && !docs.some(x => x.id === d.id)) docs.push(d);
      }

      for (const d of game.cards.contents) {
        if (docs.some(x => x.id === d.id)) continue;
        if (
          (d.type === 'deck' && d.name === deckName) ||
          (d.type === 'hand' && d.name === handName) ||
          (d.type === 'pile' && d.name === pileName)
        ) docs.push(d);
      }

      if (!docs.length) {
        console.log("[ARCANE XV][CLEANUP] no card stacks found", { actor: actor.name });
        return;
      }

      console.log("[ARCANE XV][CLEANUP] deleting card stacks", {
        actor: actor.name,
        ids: docs.map(d => d.id),
        names: docs.map(d => d.name)
      });

      await Cards.deleteDocuments(docs.map(d => d.id));

      if (clearFlags) {
        try {
          await actor.unsetFlag("arcane15", "deck");
          await actor.unsetFlag("arcane15", "hand");
          await actor.unsetFlag("arcane15", "pile");
        } catch (e) {
          console.warn("[ARCANE XV][CLEANUP] unset flags failed", e);
        }
      }
    } catch (e) {
      console.error("[ARCANE XV][CLEANUP] cleanupActorDecks ERROR", e);
    }
  }
  // Placeholder pour ton hook updateActor appelé depuis arcane15.js
  static async syncCardsOwnership(actor) {
    try {
      if (!game.user.isGM) {
      console.log("[ARCANE XV][OWN] syncCardsOwnership skipped (not GM)", { actor: actor?.name, user: game.user?.name });
      return;
    }
      const deck = game.cards.get(actor.getFlag("arcane15", "deck"));
      const hand = game.cards.get(actor.getFlag("arcane15", "hand"));
      const pile = game.cards.get(actor.getFlag("arcane15", "pile"));
      console.log("[ARCANE XV][OWN] syncCardsOwnership", {
        actor: actor.name,
        deckId: deck?.id,
        handId: hand?.id,
        pileId: pile?.id
      });
      await CardManager._ensureCardsOwnership(actor, deck, "deck");
      await CardManager._ensureCardsOwnership(actor, hand, "hand");
      await CardManager._ensureCardsOwnership(actor, pile, "pile");
    } catch (e) {
      console.error("[ARCANE XV][OWN] syncCardsOwnership ERROR", e);
    }
  }
}

// Failsafe: socket ready
Hooks.once("ready", () => {
  try {
    CardManager.ensureSocket();
  } catch (e) {
    console.error("[ARCANE XV][SOCKET][AUTO][ERROR]", e);
  }
});


Hooks.on("deleteActor", async (actor) => {
  try {
    await CardManager.cleanupActorDecks(actor, { clearFlags: false });
  } catch (e) {
    console.error("[ARCANE XV][CLEANUP][HOOK][ERROR]", e);
  }
});
