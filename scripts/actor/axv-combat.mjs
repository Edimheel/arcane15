import { CardManager } from "./card-manager.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Arcane XV — Combat Manager
 * - Script indépendant : aucune logique lourde dans actor-sheet.
 * - Autorité MJ : le MJ est le seul à modifier Tokens/Actors/Cards.
 * - Joueurs : UI + choix cartes + ready.
 */
export class CombatManager {

  static SOCKET_CHANNEL = null;

  static #clientDialogs = new Map(); // key: dialogId -> DialogV2
  static #clientState = new Map();   // key: sessionId -> { role, view, dialogId }

  static #gmSessions = new Map();    // MJ only: sessionId -> session object

  // Initiative MJ only: sessionId -> initiative session
  static #gmInitSessions = new Map();
  static #pendingDestinyPrompts = new Map();

  

  // =====================================================
  // PRIMES / PENALITES (Arcane XV — PDF p.41)
  // - Sélection par cases à cocher
  // - Règle: si au moins une prime est cochée => au moins une pénalité doit être cochée
  // =====================================================
  static AXV_PP_PRIMES = [
    { id: "attaque_meurtriere", label: "Attaque meurtrière (+2 dégâts)" },
    { id: "attaques_multiples", label: "Attaques multiples (dégâts/2)" },
    { id: "efficacite", label: "Efficacité (+1 résultat final, cumulable)" },
    { id: "prudence", label: "Prudence (+1 Défense)" }
  ];

  static AXV_PP_PENALITES = [
    { id: "blessure_legere", label: "Blessure légère (dégâts/2)" },
    { id: "danger", label: "Danger (-1 Défense)" },
    { id: "difficulte", label: "Difficulté (-1 résultat final, cumulable)" },
    { id: "risque", label: "Risque (échec => incident)" }
  ];
// ---------------------------
  // Init / Socket
  // ---------------------------
  static ensureSocket() {
    if (CombatManager.SOCKET_CHANNEL) return;
    CombatManager.SOCKET_CHANNEL = `system.${game.system.id}`;

    game.socket?.on(CombatManager.SOCKET_CHANNEL, async (data) => {
      if (!data || !data.type) return;

      const t0 = performance.now();
      try {
        if (!data.toUserId || data.toUserId === game.user.id) {
          await CombatManager.#onSocket(data);
        }
      } catch (e) {
        console.error("[ARCANE XV][COMBAT][SOCKET][ERROR]", e, data);
      } finally {
        const ms = Math.round(performance.now() - t0);
        console.log("[ARCANE XV][COMBAT][SOCKET] handler duration", { ms, type: data.type });
      }
    });

    console.log("[ARCANE XV][COMBAT] socket ready", { channel: CombatManager.SOCKET_CHANNEL, user: game.user?.name, isGM: game.user?.isGM });
  }

  static async #emit(payload) {
    CombatManager.ensureSocket();
    const p = { ...payload, sentAt: Date.now() };

    await game.socket.emit(CombatManager.SOCKET_CHANNEL, p);

    // IMPORTANT: socket.emit ne "loopback" pas toujours localement.
    // Si le message est destiné à moi (ou broadcast), on le traite aussi en local.
    try {
      if (!p.toUserId || p.toUserId === game.user.id) {
        await CombatManager.#onSocket(p);
      }
    } catch (e) {
      console.error("[ARCANE XV][COMBAT][SOCKET][ERROR]", e, p);
    }
  }

  static async #onSocket(data) {
    console.log("[ARCANE XV][COMBAT][SOCKET][RECV]", data);

    // Targeted socket messages: ignore if not addressed to this user.
    if (data?.toUserId && data.toUserId !== game.user.id) return;

    // =====================================================
    // INITIATIVE (PDF p.35)
    // =====================================================
    if (data.type === "axvInit:start") {
      if (!game.user.isGM) return;
      return CombatManager.#gmStartInitiative(data);
    }

    if (data.type === "axvInit:open") {
      return CombatManager.#clientOpenInitiative(data);
    }

    if (data.type === "axvInit:select") {
      if (!game.user.isGM) return;
      return CombatManager.#gmSelectInitiative(data);
    }

    if (data.type === "axvInit:close") {
      return CombatManager.#clientCloseInitiative(data);
    }

    if (data.type === "axvCombat:start") {
      if (!game.user.isGM) return;
      return CombatManager.#gmStartSession(data);
    }

    if (data.type === "axvCombat:open") {
      // client open dialog
      return CombatManager.#clientOpen(data);
    }

    if (data.type === "axvCombat:state") {
      // client apply view
      return CombatManager.#clientApplyState(data);
    }

    if (data.type === "axvCombat:pick") {
      if (!game.user.isGM) return;
      return CombatManager.#gmPickCard(data);
    }

    if (data.type === "axvCombat:unpick") {
      if (!game.user.isGM) return;
      return CombatManager.#gmUnpickCard(data);
    }

    if (data.type === "axvCombat:ready") {
      if (!game.user.isGM) return;
      return CombatManager.#gmReady(data);
    }

    if (data.type === "axvCombat:resolve") {
      if (!game.user.isGM) return;
      return CombatManager.#gmResolve(data);
    }


    if (data.type === "axvCombat:pp") {
      if (!game.user.isGM) return;
      return CombatManager.#gmTogglePP(data);
    }

    if (data.type === "axvCombat:killBill") {
      if (!game.user.isGM) return;
      return CombatManager.#gmArmKillBill(data);
    }

    if (data.type === "axvCombat:larnacoeur") {
      if (!game.user.isGM) return;
      return CombatManager.#gmArmLarnacoeur(data);
    }

    if (data.type === "axvCombat:end") {
      if (!game.user.isGM) return;
      return CombatManager.#gmEndSession(data);
    }

    if (data.type === "axvCombat:close") {
      return CombatManager.#clientClose(data);
    }

    if (data.type === "axvCombat:destinyPrompt") {
      return CombatManager.#clientOpenDestinyPrompt(data);
    }

    if (data.type === "axvCombat:destinyPromptResult") {
      if (!game.user.isGM) return;
      return CombatManager.#gmReceiveDestinyPromptResult(data);
    }
  }

  // ---------------------------
  // API appelé depuis actor-sheet
  // ---------------------------
  static async openAttackFromWeapon(attackerActor, weaponKey) {
    CombatManager.ensureSocket();

    try {
      for (const [id, dlg] of CombatManager.#clientDialogs.entries()) {
        if (!dlg || dlg._state < 0 || dlg.rendered === false) CombatManager.#clientDialogs.delete(id);
      }
      for (const [key, st] of Array.from(CombatManager.#clientState.entries())) {
        if (!st) {
          CombatManager.#clientState.delete(key);
          continue;
        }
        if (String(key).startsWith('init:')) continue;
        const dlgId = st?.dialogId;
        const dlg = dlgId ? CombatManager.#clientDialogs.get(dlgId) : null;
        try { if (st) st.allowClose = true; } catch (_) {}
        try { await dlg?.close?.(); } catch (_) {}
        if (dlgId) CombatManager.#clientDialogs.delete(dlgId);
        CombatManager.#clientState.delete(key);
      }
      for (const [id, dlg] of Array.from(CombatManager.#clientDialogs.entries())) {
        if (!String(id).startsWith('axv-combat-')) continue;
        try { await dlg?.close?.(); } catch (_) {}
        CombatManager.#clientDialogs.delete(id);
      }
    } catch (_) {}

    const targets = Array.from(game.user.targets || []);
    const targetToken = targets?.[0] || null;
    if (!targetToken) {
      ui.notifications.error("Combat: aucune cible sélectionnée sur la scène.");
      console.warn("[ARCANE XV][COMBAT] no target selected", { user: game.user?.name });
      return;
    }

    const weapon = weaponKey ? (attackerActor?.system?.combat?.[weaponKey] || null) : null;
    let attackerWeapon = null;
    if (weaponKey) {
      const weaponName = String(weapon?.nom || "").trim();
      if (!weaponName) {
        ui.notifications.error("Combat: arme vide.");
        console.warn("[ARCANE XV][COMBAT] empty weapon", { weaponKey, attacker: attackerActor?.name });
        return;
      }
      const weaponDamageStr = String(weapon?.degats || "").trim();
      const attackMod = CombatManager.#parseSignedInt(weaponDamageStr);
      attackerWeapon = CombatManager.#resolveWeaponForActor(attackerActor, weaponKey, {
        weaponKey,
        name: weaponName,
        degats: weaponDamageStr,
        attackMod
      });
    } else {
      attackerWeapon = CombatManager.#resolveWeaponForActor(attackerActor);
      if (!attackerWeapon?.name) {
        ui.notifications.error("Combat: aucune arme utilisable.");
        console.warn("[ARCANE XV][COMBAT] no usable weapon", { attacker: attackerActor?.name });
        return;
      }
    }

    const sceneId = canvas.scene?.id || game.scenes?.active?.id;
    const reusable = CombatManager.#getReusableInitiative(attackerActor, targetToken, sceneId);
    if (reusable) {
      console.log("[ARCANE XV][COMBAT] reusable initiative -> start combat", {
        attacker: attackerActor?.name,
        defender: targetToken?.name,
        weaponKey,
        reusable
      });
      const activeGM = game.users?.find(u => u.active && u.isGM) || game.users?.find(u => u.isGM);
      if (!activeGM) {
        ui.notifications.error("Combat: aucun MJ actif.");
        return;
      }
      const sessionId = foundry.utils.randomID(16);
      await CombatManager.#emit({
        type: "axvCombat:start",
        toUserId: activeGM.id,
        fromUserId: game.user.id,
        sessionId,
        sceneId,
        attacker: { actorId: attackerActor.id, tokenId: CombatManager.#tokenIdFromActor(attackerActor), name: attackerActor.name },
        defender: {
          tokenId: targetToken.document?.id || targetToken.id,
          tokenName: targetToken.name,
          actorId: targetToken.actor?.id,
          actorName: targetToken.actor?.name
        },
        attackerWeapon,
        chainFromInitiative: true
      });
      return;
    }

    console.log("[ARCANE XV][COMBAT] no reusable initiative -> start initiative first", {
      attacker: attackerActor?.name,
      defender: targetToken?.name,
      weaponKey
    });

    await CombatManager.startInitiative(attackerActor, weaponKey, targetToken, {
      chainCombat: true,
      pendingWeapon: attackerWeapon
    });
  }

  static async startInitiative(attackerActor, weaponKey, targetToken, options = {}) {
    CombatManager.ensureSocket();

    const sessionId = foundry.utils.randomID(16);
    const activeGM = game.users?.find(u => u.active && u.isGM) || game.users?.find(u => u.isGM);
    if (!activeGM) {
      ui.notifications?.error?.("Initiative: aucun MJ actif.");
      return null;
    }

    await CombatManager.#emit({
      type: "axvInit:start",
      toUserId: activeGM.id,
      fromUserId: game.user.id,
      sessionId,
      sceneId: canvas.scene?.id || game.scenes?.active?.id,
      attacker: { actorId: attackerActor.id, tokenId: CombatManager.#tokenIdFromActor(attackerActor), name: attackerActor.name },
      defender: {
        tokenId: targetToken.document?.id || targetToken.id,
        tokenName: targetToken.name,
        actorId: targetToken.actor?.id,
        actorName: targetToken.actor?.name
      },
      chainCombat: !!options.chainCombat,
      pendingWeapon: options.pendingWeapon || null,
      weaponKey: weaponKey || null
    });

    return sessionId;
  }

  static async submitInitiativeChoice(sessionId, role, actorId, cardId) {
    CombatManager.ensureSocket();

    const activeGM = game.users?.find(u => u.active && u.isGM) || game.users?.find(u => u.isGM);
    if (!activeGM) {
      ui.notifications?.error?.("Initiative: aucun MJ actif.");
      return;
    }

    await CombatManager.#emit({
      type: "axvInit:select",
      toUserId: activeGM.id,
      fromUserId: game.user.id,
      sessionId,
      role,
      actorId,
      cardId
    });
  }

  static #sceneById(sceneId) {
    return game.scenes.get(sceneId) || canvas.scene || game.scenes?.active || null;
  }

  static #tokenDocFrom(sceneId, tokenId) {
    if (!tokenId) return null;
    const scene = CombatManager.#sceneById(sceneId);
    return scene?.tokens?.get(tokenId) || canvas.tokens?.get(tokenId)?.document || null;
  }

  static #actorFromCombatant({ actorId = null, tokenId = null, sceneId = null } = {}) {
    const tokDoc = CombatManager.#tokenDocFrom(sceneId, tokenId);
    return tokDoc?.actor || game.actors.get(actorId) || null;
  }

  static #tokenIdFromActor(actor) {
    return actor?.token?.id
      || actor?.token?.document?.id
      || actor?.getActiveTokens?.()?.[0]?.document?.id
      || actor?.getActiveTokens?.()?.[0]?.id
      || null;
  }

  // ---------------------------
  // GM: ownership resolver
  // ---------------------------
  static #resolveOwnerUsersForActor(actor) {
    const ownersPlayers = [];
    const ownersGM = [];

    for (const u of game.users) {
      if (!u.active) continue;
      if (actor?.testUserPermission?.(u, "OWNER")) {
        if (u.isGM) ownersGM.push(u);
        else ownersPlayers.push(u);
      }
    }

    const resolved = ownersPlayers.length ? ownersPlayers : (ownersGM.length ? ownersGM : game.users.filter(u => u.active && u.isGM));

    console.log("[ARCANE XV][COMBAT] owner users resolved", {
      actor: actor?.name,
      ownersPlayers: ownersPlayers.map(u => u.name),
      ownersGM: ownersGM.map(u => u.name),
      resolved: resolved.map(u => u.name)
    });

    return resolved;
  }

  // =====================================================
  // INITIATIVE (PDF p.35) — Orchestration MJ
  // - Chaque protagoniste choisit une carte de sa main
  // - Total = Réflexes + valeur carte
  // - Option B : en cas d'égalité, relance (re-choisir une carte)
  // - Effets de marge (implémentation minimale)
  // =====================================================
  static async #gmStartInitiative(data) {
    const { sessionId, attacker, defender, fromUserId, sceneId, chainCombat, pendingWeapon } = data;

    const scene = CombatManager.#sceneById(sceneId);
    const attackerActor = CombatManager.#actorFromCombatant({ actorId: attacker.actorId, tokenId: attacker.tokenId, sceneId });
    const tokDoc = CombatManager.#tokenDocFrom(sceneId, defender.tokenId);
    const defenderActor = tokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: defender.actorId, tokenId: defender.tokenId, sceneId });

    if (!attackerActor || !defenderActor || !tokDoc) {
      console.error("[ARCANE XV][INIT][GM] missing docs", { attackerActor: !!attackerActor, defenderActor: !!defenderActor, tokDoc: !!tokDoc });
      ui.notifications?.error?.("Initiative: documents introuvables (voir console).");
      return;
    }

    await CombatManager.#safeInitDecks(attackerActor);
    await CombatManager.#safeInitDecks(defenderActor);

    const attackerUser = game.users.get(fromUserId);
    const defenderUsers = CombatManager.#resolveOwnerUsersForActor(defenderActor);
    const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);

    const initSession = {
      sessionId,
      sceneId: scene?.id,
      chainCombat: !!chainCombat,
      pendingWeapon: pendingWeapon || null,
      attacker: { actorId: attackerActor.id, tokenId: attacker.tokenId || CombatManager.#tokenIdFromActor(attackerActor), name: attackerActor.name, userId: attackerUser?.id },
      defender: { tokenId: tokDoc.id, tokenName: tokDoc.name, actorId: defenderActor.id, name: defenderActor.name, userIds: defenderUsers.map(u => u.id) },
      picks: {
        attacker: { done: false, cardId: null, total: 0, reflexes: 0, cardValue: 0, suit: "", isJoker: false, cardName: "" },
        defender: { done: false, cardId: null, total: 0, reflexes: 0, cardValue: 0, suit: "", isJoker: false, cardName: "" }
      },
      result: { done: false, winner: null, diff: 0, effect: null, secretForPlayer: false },
      createdAt: Date.now()
    };

    CombatManager.#gmInitSessions.set(sessionId, initSession);

    console.log("[ARCANE XV][INIT][GM] start", { sessionId, attacker: initSession.attacker, defender: initSession.defender, pendingWeaponKey: pendingWeapon?.weaponKey, chainCombat: !!chainCombat });

    for (const u of defenderUsers) {
      if (!u.active) continue;
      await CombatManager.#emit({
        type: "axvInit:open",
        toUserId: u.id,
        fromUserId: gmUser?.id || game.user.id,
        sessionId,
        role: "defender",
        actorId: defenderActor.id,
        tokenId: tokDoc.id,
        sceneId: scene?.id,
        actorName: defenderActor.name
      });
    }

    const toId = attackerUser?.id || gmUser?.id || game.user.id;
    if (toId) {
      await CombatManager.#emit({
        type: "axvInit:open",
        toUserId: toId,
        fromUserId: gmUser?.id || game.user.id,
        sessionId,
        role: "attacker",
        actorId: attackerActor.id,
        tokenId: attacker.tokenId || CombatManager.#tokenIdFromActor(attackerActor),
        sceneId: scene?.id,
        actorName: attackerActor.name
      });
    }
  }

  static async #gmSelectInitiative(data) {
    const { sessionId, role, actorId, cardId, fromUserId, tokenId = null } = data;
    const initSession = CombatManager.#gmInitSessions.get(sessionId);
    if (!initSession) {
      console.warn("[ARCANE XV][INIT][GM] unknown session", { sessionId, role, actorId, cardId });
      return;
    }

    const actor = CombatManager.#actorFromCombatant({
      actorId,
      tokenId: tokenId || initSession?.[role]?.tokenId || null,
      sceneId: initSession?.sceneId
    });
    if (!actor) return;
    const pick = initSession.picks?.[role];
    if (!pick) return;

    const handId = actor.getFlag("arcane15", "hand");
    const hand = handId ? game.cards.get(handId) : null;
    const cardDoc = hand?.cards?.get(cardId) || null;
    if (!hand || !cardDoc) {
      console.error("[ARCANE XV][INIT][GM] hand/card missing", { actor: actor.name, handId, cardId, sessionId });
      ui.notifications?.warn?.("Initiative: carte introuvable (main non synchronisée ?)");
      return;
    }

    const reflexesTotal = Number(actor?.system?.competences?.reflexes?.total ?? actor?.system?.competences?.reflexes?.val ?? 0);
    const cardValue = Number(cardDoc.flags?.arcane15?.value ?? 0);
    const suit = String(cardDoc.flags?.arcane15?.suit ?? "");
    const isJoker = CardManager._isJoker?.(cardDoc) ?? false;
    const cardName = CardManager._getCardName?.(cardDoc) || cardDoc.name || "Carte";
    const total = Number(reflexesTotal) + Number(cardValue);

    console.log("[ARCANE XV][INIT][GM] select", { sessionId, role, actor: actor.name, fromUserId, cardId, cardValue, suit, isJoker, reflexesTotal, total });

    const cardImg = CombatManager.#cardImg(cardDoc);

    Object.assign(pick, {
      done: true,
      cardId,
      total,
      reflexes: reflexesTotal,
      cardValue,
      suit,
      isJoker,
      cardName,
      cardImg
    });

    try {
      await actor.update({ "system.stats.initiative": total });
      await actor.setFlag("arcane15", "initiative", {
        total,
        reflexes: reflexesTotal,
        cardId,
        cardValue,
        suit,
        isJoker,
        cardName,
        cardImg,
        at: Date.now(),
        userId: fromUserId
      });
    } catch (e) {
      console.error("[ARCANE XV][INIT][GM] actor update failed", e);
    }

    try {
      await CardManager.cycleCard(actor, cardDoc);
      await CombatManager.#safeInitDecks(actor);
    } catch (e) {
      console.error("[ARCANE XV][INIT][GM] cycle failed", e);
    }

    const a = initSession.picks.attacker;
    const d = initSession.picks.defender;
    if (!(a?.done && d?.done)) {
      console.log("[ARCANE XV][INIT][GM] waiting other side", { sessionId, attackerDone: !!a?.done, defenderDone: !!d?.done });
      return;
    }

    const diff = Number(a.total) - Number(d.total);
    if (diff === 0) {
      console.log("[ARCANE XV][INIT][GM] tie => reroll (Option B)", { sessionId });
      initSession.picks.attacker = { done: false, cardId: null, total: 0, reflexes: 0, cardValue: 0, suit: "", isJoker: false, cardName: "" };
      initSession.picks.defender = { done: false, cardId: null, total: 0, reflexes: 0, cardValue: 0, suit: "", isJoker: false, cardName: "" };
      const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
      const attackerUser = initSession.attacker.userId ? game.users.get(initSession.attacker.userId) : null;
      const defenderActor = game.actors.get(initSession.defender.actorId);
      const defenderUsers = defenderActor ? CombatManager.#resolveOwnerUsersForActor(defenderActor) : [];
      if (attackerUser?.id || gmUser?.id) {
        await CombatManager.#emit({
          type: "axvInit:open",
          toUserId: attackerUser?.id || gmUser?.id,
          fromUserId: gmUser?.id || game.user.id,
          sessionId,
          role: "attacker",
          actorId: initSession.attacker.actorId,
          actorName: initSession.attacker.name,
          reroll: true
        });
      }
      for (const u of defenderUsers) {
        await CombatManager.#emit({
          type: "axvInit:open",
          toUserId: u.id,
          fromUserId: gmUser?.id || game.user.id,
          sessionId,
          role: "defender",
          actorId: initSession.defender.actorId,
          actorName: initSession.defender.name,
          reroll: true
        });
      }
      return;
    }

    const winner = diff > 0 ? "attacker" : "defender";
    const margin = Math.abs(diff);
    let effect = null;
    if (margin >= 7 && margin <= 10) effect = { type: "forcedJoker", scope: "choice", label: "Joker imposé (attaque ou défense)", loser: winner === "attacker" ? "defender" : "attacker" };
    if (margin >= 11) effect = { type: "forcedJoker", scope: "attack", label: "Joker imposé en attaque", loser: winner === "attacker" ? "defender" : "attacker" };

    initSession.result = { done: true, winner, diff, effect, secretForPlayer: false, margin };

    const attackerActor = game.actors.get(initSession.attacker.actorId);
    const defenderActor = game.actors.get(initSession.defender.actorId);
    CombatManager.#storeReusableInitiative(attackerActor, initSession.defender, initSession.sceneId, initSession.result);
    CombatManager.#storeReusableInitiative(defenderActor, { actorId: initSession.attacker.actorId, tokenId: null }, initSession.sceneId, {
      done: true,
      winner: winner === "attacker" ? "defender" : "attacker",
      diff: -diff,
      effect,
      margin
    });

    console.log("[ARCANE XV][INIT][GM] resolved", { sessionId, winner, diff, margin, effect });

    try {
      const closeTargets = new Set();
      if (initSession.attacker.userId) closeTargets.add(initSession.attacker.userId);
      for (const uid of (initSession.defender.userIds || [])) closeTargets.add(uid);
      const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
      if (gmUser?.id) closeTargets.add(gmUser.id);
      for (const uid of closeTargets) {
        await CombatManager.#emit({ type: "axvInit:close", toUserId: uid, fromUserId: game.user.id, sessionId });
      }
    } catch (e) {
      console.warn("[ARCANE XV][INIT][GM] close dialogs failed", e);
    }

    try {
      const initChatContent = `
          <div class="axv-chat-card" style="border:1px solid #dbc7b8;border-radius:10px;background:linear-gradient(180deg,#fff,#f6f1ea);color:#2d211b;font-size:12px;line-height:1.4;word-break:break-word;">
            <div style="padding:8px 10px;background:linear-gradient(90deg,#521A15,#7b3327);color:#fff;font-weight:900;font-size:13px;">🎯 Initiative — ${CombatManager.#esc(initSession.attacker.name)} vs ${CombatManager.#esc(initSession.defender.name)}</div>
            <div style="padding:10px;">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                <div style="flex:1;min-width:120px;border:1px solid #eaded3;border-radius:8px;padding:8px;background:#fffaf6;">
                  ${CombatManager.#chatActorBadge(initSession.attacker.name, attackerActor, '#c65d2b')}
                  <div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;">
                    <img draggable="false" src="${CombatManager.#esc(a.cardImg || CombatManager.#fallbackCardImg(null))}" style="width:44px;height:66px;object-fit:cover;border-radius:6px;background:#111;box-shadow:0 2px 6px rgba(0,0,0,.18);flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
                    <div>
                      <div>Réflexes <strong>${a.reflexes}</strong></div>
                      <div>Carte <strong>${CombatManager.#esc(a.cardName)}</strong> (${a.cardValue})</div>
                      <div style="margin-top:2px;color:#555;">Réflexes ${a.reflexes} + Carte ${a.cardValue} = <strong>${a.total}</strong></div>
                      <div style="margin-top:3px;font-size:14px;font-weight:900;">Total : ${a.total}</div>
                    </div>
                  </div>
                </div>
                <div style="flex:1;min-width:120px;border:1px solid #eaded3;border-radius:8px;padding:8px;background:#f7f9ff;">
                  ${CombatManager.#chatActorBadge(initSession.defender.name, defenderActor, '#4467c4')}
                  <div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;">
                    <img draggable="false" src="${CombatManager.#esc(d.cardImg || CombatManager.#fallbackCardImg(null))}" style="width:44px;height:66px;object-fit:cover;border-radius:6px;background:#111;box-shadow:0 2px 6px rgba(0,0,0,.18);flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
                    <div>
                      <div>Réflexes <strong>${d.reflexes}</strong></div>
                      <div>Carte <strong>${CombatManager.#esc(d.cardName)}</strong> (${d.cardValue})</div>
                      <div style="margin-top:2px;color:#555;">Réflexes ${d.reflexes} + Carte ${d.cardValue} = <strong>${d.total}</strong></div>
                      <div style="margin-top:3px;font-size:14px;font-weight:900;">Total : ${d.total}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div style="padding:8px 10px;border-radius:8px;background:${winner === "attacker" ? '#fff2ea' : '#eef3ff'};border:1px solid ${winner === "attacker" ? '#f1c2a6' : '#bfd0ff'};font-size:12px;">
                <div><strong>Gagnant :</strong> ${winner === "attacker" ? CombatManager.#esc(initSession.attacker.name) : CombatManager.#esc(initSession.defender.name)} — <strong>Marge ${margin}</strong></div>
                <div style="margin-top:2px;color:#555;">${a.total} vs ${d.total} → différence de ${margin}</div>
                ${effect ? `<div style="margin-top:3px;"><strong>Effet :</strong> ${CombatManager.#esc(effect.label)}</div>` : ``}
              </div>
            </div>
          </div>`;

      // Build speaker with multiple fallbacks
      console.log("[ARCANE XV][INIT][GM] creating initiative chat message", { sessionId, contentLength: initChatContent.length });
      await ChatMessage.create({
        content: initChatContent,
        speaker: { alias: "" },
        style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
        flags: { arcane15: { customCard: true } }
      });
      console.log("[ARCANE XV][INIT][GM] initiative chat message created OK");
    } catch (e) {
      console.error("[ARCANE XV][INIT][GM] chat create failed", e);
    }

    if (initSession.chainCombat) {
      // Small delay so the initiative chat message has time to render before combat opens
      await new Promise(r => setTimeout(r, 300));
      await CombatManager.#gmOpenCombatAfterInitiative(initSession);
    }
  }

  static async #gmOpenCombatAfterInitiative(initSession) {
    const { sessionId, sceneId } = initSession;
    const scene = CombatManager.#sceneById(sceneId);
    const attackerActor = CombatManager.#actorFromCombatant({ actorId: initSession.attacker.actorId, tokenId: initSession.attacker.tokenId, sceneId });
    const defenderActor = CombatManager.#actorFromCombatant({ actorId: initSession.defender.actorId, tokenId: initSession.defender.tokenId, sceneId });
    const tokDoc = CombatManager.#tokenDocFrom(sceneId, initSession.defender.tokenId);
    if (!attackerActor || !defenderActor || !tokDoc) {
      console.error("[ARCANE XV][INIT][GM] cannot open combat, missing docs", { sessionId });
      return;
    }

    await CombatManager.#gmStartSession({
      sessionId,
      sceneId: scene?.id,
      attacker: { actorId: attackerActor.id, tokenId: CombatManager.#tokenIdFromActor(attackerActor), name: attackerActor.name },
      defender: {
        tokenId: tokDoc.id,
        tokenName: tokDoc.name,
        actorId: defenderActor.id,
        actorName: defenderActor.name
      },
      attackerWeapon: initSession.pendingWeapon || null,
      fromUserId: initSession.attacker.userId || game.user.id,
      chainFromInitiative: true,
      initiativeResult: initSession.result
    });

    try { CombatManager.#gmInitSessions.delete(sessionId); } catch (_) {}
  }

  static async #clientOpenInitiative(data) {
    const { sessionId, role, actorId, tokenId = null, sceneId = null } = data;
    const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId });
    if (!actor) return;

    let handId = actor.getFlag("arcane15", "hand");
    if (!handId || !game.cards.get(handId)) {
      await CombatManager.#safeInitDecks(actor);
      handId = actor.getFlag("arcane15", "hand");
    }
    const handDoc = game.cards.get(handId);
    const hand = handDoc?.cards?.contents ? handDoc.cards.contents.slice() : [];
    const cards = hand
      .map(c => {
        const v = CardManager._cardNumericValue?.(c) ?? Number(c?.flags?.arcane15?.value ?? 0) ?? 0;
        const suit = CardManager._cardSuitLabel?.(c) ?? c?.flags?.arcane15?.suit ?? "";
        const img = CombatManager.#cardImg(c);
        const name = CardManager._getCardName?.(c) || c?.flags?.arcane15?.displayName || c.name || `${v}`;
        const isJoker = CardManager._isJoker?.(c) ?? false;
        return { id: c.id, value: v, suit, img, name, isJoker };
      })
      .sort((a, b) => {
        if (a.isJoker && !b.isJoker) return -1;
        if (!a.isJoker && b.isJoker) return 1;
        return a.value - b.value;
      });

    const reflexesTotal = Number(actor?.system?.competences?.reflexes?.total ?? actor?.system?.competences?.reflexes?.val ?? 0);
    const dialogId = `axv-init-${sessionId}-${role}-${actor.id}-${game.user.id}`;
    const dialogKey = `init:${sessionId}:${role}:${actor.id}:${game.user.id}`;
    console.log("[ARCANE XV][INIT][CLIENT] open", { sessionId, role, actorId, actorName: actor.name, cards: cards.length });

    // Dimensions des cartes
    const CARD_W = 110;       // largeur totale
    const CARD_IMG_H = 148;   // hauteur image
    const CARD_H = CARD_IMG_H + 16 + 18 + 16; // image + padding haut + nom + valeur = ~198px
    const idealWidth  = Math.min(Math.max(cards.length * (CARD_W + 12) + 44, 360), 920);
    // Hauteur fenêtre = titlebar Foundry ~40px + window-content padding 20px
    //   + head ~80px + gap 10px + grid (CARD_H+20px) + gap 10px + status ~60px + footer ~52px
    const idealHeight = 40 + 20 + 80 + 10 + (CARD_H + 20) + 10 + 60 + 52;

    // HTMLElement → cleanHTML ignoré → <style> préservés
    const wrap = document.createElement("div");

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      #${dialogId} { font-family:var(--font-primary); color:#eee; display:flex; flex-direction:column; gap:8px; }
      #${dialogId} .axv-init-block {
        background:linear-gradient(160deg,#0d2a3a,#061824);
        border:1px solid rgba(60,140,200,.4);
        border-radius:14px; padding:12px 14px;
        display:flex; flex-direction:column; gap:10px;
      }
      #${dialogId} .axv-init-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
      #${dialogId} .axv-init-title { font-size:1rem; font-weight:900; color:#d8eeff; }
      #${dialogId} .axv-init-sub { font-size:.82rem; opacity:.8; margin-top:3px; color:#a8cce8; }
      #${dialogId} .axv-init-ref { padding:5px 12px; border-radius:999px; border:1px solid rgba(60,160,230,.45); background:rgba(60,160,230,.12); font-weight:900; color:#a8d8ff; white-space:nowrap; font-size:.88rem; flex-shrink:0; margin-top:2px; }
      #${dialogId} .axv-init-grid {
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        gap:10px;
        overflow-x:auto; overflow-y:visible;   /* VISIBLE pour ne pas couper les cartes */
        padding:4px 2px 6px 2px;
        align-items:flex-start;
        min-height:${CARD_H + 14}px;           /* hauteur min = carte entière + marge */
      }
      #${dialogId} .axv-init-grid::-webkit-scrollbar { height:5px; }
      #${dialogId} .axv-init-grid::-webkit-scrollbar-thumb { background:rgba(60,160,230,.4); border-radius:999px; }
      #${dialogId} .axv-init-card {
        display:flex !important; flex-direction:column; gap:2px;
        align-items:center; justify-content:flex-start;
        padding:8px 7px 10px;
        border:1px solid rgba(60,160,230,.3); border-radius:12px;
        background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));
        cursor:pointer;
        width:${CARD_W}px; min-width:${CARD_W}px; max-width:${CARD_W}px; flex-shrink:0;
        transition:transform .12s, border-color .12s, background .12s;
        height: auto; 
      }
      #${dialogId} .axv-init-card:hover { transform:translateY(-3px); border-color:rgba(80,180,255,.9); background:linear-gradient(180deg,rgba(60,160,230,.18),rgba(255,255,255,.04)); }
      #${dialogId} .axv-init-card img { width:${CARD_W - 14}px; height:${CARD_IMG_H+20}px; object-fit:cover; border-radius:8px; background:#111; display:block; flex-shrink:0; }
      #${dialogId} .axv-init-card-name { font-weight:800; font-size:.82rem; text-align:center; line-height:1.15; color:#d8eeff; width:100%; }
      #${dialogId} .axv-init-card-val { font-size:.78rem; color:#6ab8f7; text-align:center; }
      #${dialogId} .axv-init-status { padding:8px 12px; border-radius:10px; border:1px solid rgba(60,160,230,.2); background:rgba(0,0,0,.35); font-size:.83rem; color:#a8cce8; line-height:1.4; }
    `;
    wrap.appendChild(styleEl);

    const cardsHtml = cards.map(c => {
      const badge = c.isJoker ? "JOKER" : `${c.value}${c.suit ? " • " + c.suit : ""}`;
      return `
        <button type="button" class="axv-init-card" data-card-id="${c.id}">
          <img src="${c.img}" alt="${c.name}" />
          <div class="axv-init-card-name">${c.name}</div>
          <div class="axv-init-card-val">${badge}</div>
        </button>
      `;
    }).join("");

    const inner = document.createElement("div");
    inner.id = dialogId;
    inner.innerHTML = `
      <div class="axv-init-block">
        <div class="axv-init-head">
          <div>
            <div class="axv-init-title">Choisis une carte d'initiative</div>
            <div class="axv-init-sub">Les cartes sont jouées face visible. Total = Réflexes + valeur de la carte.</div>
          </div>
          <div class="axv-init-ref">Réflexes : ${reflexesTotal}</div>
        </div>
        <div class="axv-init-grid">${cardsHtml}</div>
        <div class="axv-init-status">Clique directement sur une carte. Une fois choisie, elle est envoyée au MJ et tu attends l'autre protagoniste.</div>
      </div>
    `;
    wrap.appendChild(inner);

    const dlg = new DialogV2({
      window: { title: `Initiative — ${actor.name}` },
      content: wrap,
      buttons: [{ action: "close", label: "Fermer", default: true }],
      rejectClose: false
    });

    await dlg.render({ force: true });

    try {
      const appEl = dlg.element;
      try {
        const left = Math.max(24, Math.round((window.innerWidth - idealWidth) / 2));
        const top  = Math.max(24, Math.round((window.innerHeight - idealHeight) / 2));
        dlg.setPosition?.({ left, top, width: idealWidth, height: idealHeight });
      } catch (_) {}
      try {
        const wc = appEl?.querySelector?.(".window-content");
        if (wc) { wc.style.background = "rgba(0,0,0,0.92)"; wc.style.backgroundImage = "none"; wc.style.padding = "10px"; wc.style.overflow = "auto"; }
      } catch (_) {}
    } catch (_) {}


    CombatManager.#clientDialogs.set(dialogId, dlg);
    CombatManager.#clientState.set(dialogKey, { dialogId, played: false });

    const root = dlg.element?.querySelector?.(`#${dialogId}`);
    const status = root?.querySelector?.('.axv-init-status');

    root?.addEventListener?.('click', async (ev) => {
      const st = CombatManager.#clientState.get(dialogKey);
      if (st?.played) return;
      const btn = ev.target?.closest?.('.axv-init-card');
      if (!btn) return;
      ev.preventDefault();
      const chosenId = btn.dataset.cardId;
      console.log('[ARCANE XV][INIT][CLIENT] choose', { sessionId, role, actor: actor.name, chosenId });
      try {
        CombatManager.#clientState.set(dialogKey, { ...(st || {}), played: true });
        root.querySelectorAll('.axv-init-card').forEach(el => {
          el.disabled = true;
          el.style.cursor = 'default';
          el.style.opacity = el === btn ? '1' : '0.55';
          el.style.borderColor = el === btn ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)';
        });
        if (status) status.innerHTML = '<b>En attente de l\'autre protagoniste…</b>';
        await CombatManager.submitInitiativeChoice(sessionId, role, actor.id, chosenId);
        try { await dlg.close(); } catch (_) {}
      } catch (e) {
        console.error('[ARCANE XV][INIT][CLIENT] submit failed', e);
        CombatManager.#clientState.set(dialogKey, { ...(st || {}), played: false });
        if (status) status.textContent = 'Erreur pendant l\'envoi. Réessaie.';
      }
    });
  }


  static async #clientCloseInitiative(data) {
    const { sessionId } = data || {};
    try {
      for (const [key, st] of CombatManager.#clientState.entries()) {
        if (!String(key).startsWith("init:")) continue;
        if (!String(key).includes(`:${sessionId}:`)) continue;
        const dlgId = st?.dialogId;
        if (dlgId) {
          const dlg = CombatManager.#clientDialogs.get(dlgId);
          try { await dlg?.close?.(); } catch (_) {}
          try { CombatManager.#clientDialogs.delete(dlgId); } catch (_) {}
        }
        try { CombatManager.#clientState.delete(key); } catch (_) {}
      }
    } catch (e) {
      console.warn("[ARCANE XV][INIT][CLIENT] close failed", e);
    }
  }


  // ---------------------------
  // GM: start session
  // ---------------------------
  static async #gmStartSession(data) {
    const { sessionId, attacker, defender, attackerWeapon, fromUserId, sceneId, initiativeResult } = data;

    const scene = CombatManager.#sceneById(sceneId);
    const attackerActor = CombatManager.#actorFromCombatant({ actorId: attacker.actorId, tokenId: attacker.tokenId, sceneId });
    const tokDoc = CombatManager.#tokenDocFrom(sceneId, defender.tokenId);
    const defenderActor = tokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: defender.actorId, tokenId: defender.tokenId, sceneId });

    if (!attackerActor || !defenderActor || !tokDoc) {
      console.error("[ARCANE XV][COMBAT][GM] missing docs", { attackerActor: !!attackerActor, defenderActor: !!defenderActor, tokDoc: !!tokDoc });
      ui.notifications.error("Combat: impossible de résoudre les documents (voir console).");
      return;
    }

    await CombatManager.#safeInitDecks(attackerActor);
    await CombatManager.#safeInitDecks(defenderActor);

    const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
    const defenderUsers = CombatManager.#resolveOwnerUsersForActor(defenderActor);
    const attackerUser = game.users.get(fromUserId);

    const storedInit = initiativeResult || (attackerActor?.getFlag?.("arcane15", "lastInitiativeCombat") || null);
    const winner = storedInit?.winner || "attacker";
    const margin = Math.abs(Number(storedInit?.diff ?? storedInit?.margin ?? 0));
    let effect = storedInit?.effect || null;
    if (!effect) {
      if (margin >= 7 && margin <= 10) effect = { type: "forcedJoker", scope: "choice", loser: winner === "attacker" ? "defender" : "attacker", label: "Joker imposé (attaque ou défense)" };
      if (margin >= 11) effect = { type: "forcedJoker", scope: "attack", loser: winner === "attacker" ? "defender" : "attacker", label: "Joker imposé en attaque" };
    }

    const session = {
      sessionId,
      sceneId: scene?.id,
      round: 1,
      ended: false,
      attacker: {
        actorId: attackerActor.id,
        tokenId: attacker.tokenId || CombatManager.#tokenIdFromActor(attackerActor),
        name: attackerActor.name,
        userId: attackerUser?.id,
        weapon: CombatManager.#resolveWeaponForActor(attackerActor, attackerWeapon?.weaponKey, attackerWeapon)
      },
      defender: {
        tokenId: tokDoc.id,
        tokenName: tokDoc.name,
        actorId: defenderActor.id,
        name: defenderActor.name,
        userIds: defenderUsers.map(u => u.id),
        weapon: CombatManager.#resolveWeaponForActor(defenderActor)
      },
      initiative: {
        winner,
        diff: Number(storedInit?.diff ?? 0),
        margin,
        effect
      },
      picks: {
        attacker: { attack: null, defense: null, locked: false, ready: false, played: [], primes: [], penalites: [] },
        defender: { attack: null, defense: null, locked: false, ready: false, played: [], primes: [], penalites: [] }
      },
      killBill: CombatManager.#emptyKillBillState(),
      pendingRoundAdvance: false,
      postRoundKillBillPrompt: false,
      roundCardsCycled: false,
      resolved: { done: false, revealed: false, result: null }
    };

    CombatManager.#gmSessions.set(sessionId, session);
    try { await CombatManager.#activateCombatScene(session); } catch (e) { console.warn('[ARCANE XV][COMBAT][GM] activate combat scene failed', e); }

    console.log("[ARCANE XV][COMBAT][GM] start session", { sessionId, attacker: session.attacker, defender: session.defender, initiative: session.initiative });

    if (attackerUser?.id) {
      await CombatManager.#emit({ type: "axvCombat:open", toUserId: attackerUser.id, fromUserId: game.user.id, sessionId, role: "attacker", sceneId: session.sceneId });
    }
    for (const u of defenderUsers) {
      await CombatManager.#emit({ type: "axvCombat:open", toUserId: u.id, fromUserId: game.user.id, sessionId, role: "defender", sceneId: session.sceneId });
    }

    const gmIsAttacker = attackerUser?.id === gmUser?.id;
    const gmIsDefender = defenderUsers.some(u => u.id === gmUser?.id);
    if (gmUser?.id && !gmIsAttacker && !gmIsDefender) {
      await CombatManager.#emit({ type: "axvCombat:open", toUserId: gmUser.id, fromUserId: game.user.id, sessionId, role: "gm", sceneId: session.sceneId });
    }

    await CombatManager.#gmBroadcastState(sessionId);
  }

  // ---------------------------
  // GM: validate pick
  // ---------------------------
  static #getHandCards(actor) {
    const handId = actor.getFlag("arcane15", "hand");
    const hand = handId ? game.cards.get(handId) : null;
    return hand?.cards?.contents?.slice() || [];
  }

  static #cardValue(card) {
    return Number(card?.flags?.arcane15?.value ?? 0);
  }

  static #isJoker(card) {
    return !!CardManager._isJoker?.(card);
  }

  static #fallbackCardImg(card) {
    const sysId = game?.system?.id || "arcane15";
    const root = `/systems/${sysId}/assets/axvc01_tarot_v1v1`;
    const filePrefix = "axvc01";
    const f = card?.flags?.arcane15 || {};
    const isJoker = !!f.isJoker;
    if (isJoker) return `${root}/${filePrefix}_epees12_cavalier.png`;
    const suitMap = {
      'bâton': 'batons', 'baton': 'batons', 'batons': 'batons',
      'coupe': 'coupes', 'coupes': 'coupes',
      'denier': 'deniers', 'deniers': 'deniers',
      'épée': 'epees', 'epee': 'epees', 'epees': 'epees'
    };
    const suitRaw = String(f.suit || '').toLowerCase();
    const suitId = suitMap[suitRaw] || null;
    const value = Number(f.value ?? 0);
    const rankMap = {1:'01',2:'02',3:'03',4:'04',5:'05',6:'06',7:'07',8:'08',9:'09',10:'10',11:'11_valet',12:'13_reine',13:'14_roi'};
    const rank = rankMap[value] || null;
    if (suitId && rank) return `${root}/${filePrefix}_${suitId}${rank}.png`;
    return `${root}/${filePrefix}__dos-cartes.png`;
  }

  static #cardImg(card) {
    const fallback = CombatManager.#fallbackCardImg(card);
    const candidate = CardManager._getCardImg?.(card)
      || CardManager._faceImg?.(card)
      || card?.faces?.[0]?.img
      || card?.img
      || null;
    if (!candidate) return fallback;
    const bad = /icons\/svg\/|warning|hazard|mystery/i.test(String(candidate));
    return bad ? fallback : candidate;
  }

  static #cardView(card) {
    const value = CombatManager.#cardValue(card);
    const img = CombatManager.#cardImg(card);
    const name = CardManager._getCardName?.(card) || card.name || "Carte";
    const isJoker = CombatManager.#isJoker(card);
    const suit = CardManager._cardSuitLabel?.(card) ?? card?.flags?.arcane15?.suit ?? "";
    return { id: card.id, name, img, faceImg: (card?.face?.img || card?.faces?.[0]?.img || null), rawImg: (card?.img || null), value, isJoker, suit };
  }

  static #sumSelected(session, role) {
    const pick = session.picks[role];
    return (pick.played || []).reduce((s, c) => s + (c?.isJoker ? 0 : Number(c?.value ?? 0)), 0);
  }

  static #sommeMaxFor(role, session) {
    // Le view pré-calcule sommeMax depuis le token actor — l'utiliser en priorité
    const fromView = session?.[role]?.sommeMax;
    if (fromView !== undefined && fromView !== null && Number(fromView) > 0) return Number(fromView);
    const actorId = role === "attacker" ? session.attacker.actorId : session.defender.actorId;
    const tokenId = role === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
    const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
    return Number(actor?.system?.stats?.sommeMax ?? 12);
  }

  static #normalizeSkillText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/^combat\b/g, "")
      .replace(/[()_:;,-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  static #extractWeaponSkillHints(weapon = null) {
    const directKeys = [
      weapon?.skillKey,
      weapon?.competenceKey,
      weapon?.combatSkillKey,
      weapon?.combatKey,
      weapon?.typeCombatKey
    ]
      .map(v => String(v || "").trim())
      .filter(Boolean);

    const labels = [
      weapon?.skillLabel,
      weapon?.competenceLabel,
      weapon?.combatLabel,
      weapon?.competence,
      weapon?.skill,
      weapon?.combatSkill,
      weapon?.typeCombat,
      weapon?.typeCombatLabel,
      weapon?.combat
    ]
      .map(v => String(v || "").trim())
      .filter(Boolean);

    return {
      directKeys: [...new Set(directKeys)],
      labels: [...new Set(labels)]
    };
  }

  static #resolveWeaponForActor(actor, preferredKey = null, provided = null) {
    const mergeWeapon = (key, source = null, extra = null) => {
      const w = source || actor?.system?.combat?.[key] || {};
      const name = String(extra?.name || w?.nom || w?.name || "").trim();
      if (!name) return null;
      const degats = String(extra?.degats ?? w?.degats ?? "").trim();
      const attackMod = Number.isFinite(Number(extra?.attackMod))
        ? Number(extra.attackMod)
        : CombatManager.#parseSignedInt(degats);

      const hints = CombatManager.#extractWeaponSkillHints(w);
      const extraHints = CombatManager.#extractWeaponSkillHints(extra);
      const directKeys = [...new Set([...(hints.directKeys || []), ...(extraHints.directKeys || [])])];
      const labels = [...new Set([...(hints.labels || []), ...(extraHints.labels || [])])];

      return {
        ...(w ? foundry.utils.deepClone(w) : {}),
        ...(extra ? foundry.utils.deepClone(extra) : {}),
        weaponKey: key || extra?.weaponKey || null,
        name,
        degats,
        attackMod,
        equipe: !!(extra?.equipe ?? w?.equipe ?? false),
        skillKey: directKeys[0] || null,
        competenceKey: String(extra?.competenceKey || w?.competenceKey || directKeys[0] || "").trim() || null,
        combatSkillKey: String(extra?.combatSkillKey || w?.combatSkillKey || directKeys[0] || "").trim() || null,
        skillLabel: labels[0] || null,
        competenceLabel: String(extra?.competenceLabel || w?.competenceLabel || labels[0] || "").trim() || null,
        combatLabel: String(extra?.combatLabel || w?.combatLabel || labels[0] || "").trim() || null,
        competence: String(extra?.competence || w?.competence || labels[0] || "").trim() || null,
        skill: String(extra?.skill || w?.skill || labels[0] || "").trim() || null,
        typeCombat: String(extra?.typeCombat || w?.typeCombat || "").trim() || null
      };
    };

    if (preferredKey) {
      const merged = mergeWeapon(preferredKey, actor?.system?.combat?.[preferredKey], provided);
      if (merged?.name) return merged;
    }

    if (provided?.name) {
      const mergedProvided = mergeWeapon(String(provided?.weaponKey || preferredKey || "").trim() || null, null, provided);
      if (mergedProvided?.name) return mergedProvided;
    }

    const combatData = actor?.system?.combat || {};

    if (!preferredKey) {
      for (const [key, w] of Object.entries(combatData)) {
        if (!key.startsWith("arme")) continue;
        if (!w?.equipe) continue;
        const merged = mergeWeapon(key, w);
        if (merged?.name) return merged;
      }
    }

    const keys = preferredKey
      ? [preferredKey, "arme1", "arme2", "arme3", "arme4"]
      : [];

    for (const key of keys) {
      if (!key) continue;
      const merged = mergeWeapon(key);
      if (merged?.name) return merged;
    }

    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    const hasKillBill = ArcanaManager?.getCharacterAtouts ? ArcanaManager.getCharacterAtouts(actor).some(a => a.key === 'kill-bill') : false;
    const poingsMod = hasKillBill ? -1 : -3;
    if (game.user?.isGM) {
      console.warn(`[ARCANE XV][COMBAT] ${actor?.name} n'a aucune arme équipée → Poings (${poingsMod}). Cochez Équipé sur la fiche.`);
      ui.notifications?.info?.(`${actor?.name} n'a aucune arme équipée. Il combattra à mains nues (Poings ${poingsMod}).`);
    }
    return {
      weaponKey: null,
      name: "Poings",
      degats: String(poingsMod),
      attackMod: poingsMod,
      skillKey: null,
      competenceKey: null,
      combatSkillKey: null,
      skillLabel: null,
      competenceLabel: null,
      combatLabel: null,
      competence: null,
      skill: null,
      typeCombat: null
    };
  }


  static #emptyKillBillState() {
    return {
      owner: null,
      target: null,
      armed: false,
      phase: null,
      attack: null,
      defense: null,
      ownerReady: false,
      targetReady: false,
      result: null,
      round: null,
      weapon: null
    };
  }

  static #killBillHasAtout(actor) {
    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    return !!(actor && ArcanaManager?.getCharacterAtouts && ArcanaManager.getCharacterAtouts(actor).some(a => a.key === 'kill-bill'));
  }

  static #hasCharacterAtout(actor, atoutKey) {
    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    return !!(actor && ArcanaManager?.getCharacterAtouts && ArcanaManager.getCharacterAtouts(actor).some(a => a.key === atoutKey));
  }

  static #larnacoeurHasAtout(actor) {
    return CombatManager.#hasCharacterAtout(actor, 'larnacoeur');
  }

  static getActiveSessionContext(actorOrId) {
    const actorId = typeof actorOrId === 'string' ? actorOrId : actorOrId?.id;
    if (!actorId) return null;

    if (game.user?.isGM) {
      for (const session of CombatManager.#gmSessions.values()) {
        if (!session || session.ended) continue;
        if (String(session.attacker?.actorId || '') === String(actorId)) {
          return {
            sessionId: session.sessionId,
            role: 'attacker',
            opponentActorId: session.defender?.actorId ?? null,
            opponentName: session.defender?.name ?? null,
            round: Number(session.round || 1)
          };
        }
        if (String(session.defender?.actorId || '') === String(actorId)) {
          return {
            sessionId: session.sessionId,
            role: 'defender',
            opponentActorId: session.attacker?.actorId ?? null,
            opponentName: session.attacker?.name ?? null,
            round: Number(session.round || 1)
          };
        }
      }
    }

    for (const [sessionId, state] of CombatManager.#clientState.entries()) {
      const view = state?.view;
      if (!view) continue;
      if (String(view.attacker?.actorId || '') === String(actorId)) {
        return {
          sessionId,
          role: 'attacker',
          opponentActorId: view.defender?.actorId ?? null,
          opponentName: view.defender?.name ?? null,
          round: Number(view.round || 1)
        };
      }
      if (String(view.defender?.actorId || '') === String(actorId)) {
        return {
          sessionId,
          role: 'defender',
          opponentActorId: view.attacker?.actorId ?? null,
          opponentName: view.attacker?.name ?? null,
          round: Number(view.round || 1)
        };
      }
    }

    return null;
  }

  static #getLarnacoeurRoundState(session, role) {
    const roleInfo = role === 'attacker' ? session?.attacker : session?.defender;
    const otherInfo = role === 'attacker' ? session?.defender : session?.attacker;
    const actor = CombatManager.#actorFromCombatant({ actorId: roleInfo?.actorId, tokenId: roleInfo?.tokenId, sceneId: session?.sceneId });
    const otherActor = CombatManager.#actorFromCombatant({ actorId: otherInfo?.actorId, tokenId: otherInfo?.tokenId, sceneId: session?.sceneId });
    const runtime = actor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
    const effect = runtime?.larnacoeurCombat || null;
    const sameSession = !!effect?.sessionId && String(effect.sessionId) === String(session?.sessionId || '');
    const sameRound = Number(effect?.round || 0) === Number(session?.round || 0);
    const sameTarget = !effect?.targetId || String(effect.targetId) === String(otherActor?.id || '');
    const attemptedThisRound = !!effect && sameSession && sameRound;
    const active = attemptedThisRound && sameTarget && effect?.lastSuccess === true && Number(effect?.freePrimes || 0) > 0;
    return {
      actor,
      otherActor,
      effect,
      attemptedThisRound,
      active,
      freePrimes: active ? Number(effect?.freePrimes || 0) : 0
    };
  }

  static #larnacoeurSummaryChatHtml(actor, target, result, atoutName = 'L’arnacoeur') {
    const margin = Number(result?.margin || 0);
    const success = !!result?.success;
    return `
      <div class="axv-chat-card" style="border:1px solid #bfd0ff;border-radius:10px;background:linear-gradient(180deg,#fff,#f4f8ff);color:#17355f;font-size:12px;line-height:1.45;word-break:break-word;">
        <div style="padding:8px 10px;background:linear-gradient(90deg,#1d4f91,#2f6bb8);color:#fff;font-weight:900;font-size:13px;">Atout de personnage — ${CombatManager.#esc(atoutName)}</div>
        <div style="padding:10px 12px;">
          <div><strong>${CombatManager.#esc(actor?.name || 'Acteur')}</strong> embobine <strong>${CombatManager.#esc(target?.name || 'sa cible')}</strong>.</div>
          <div style="margin-top:6px;">Art (Comédie) : <strong>${Number(result?.actorTotal || 0)}</strong> • Psychologie : <strong>${Number(result?.targetTotal || 0)}</strong></div>
          <div style="margin-top:6px;font-weight:900;font-size:14px;color:${success ? '#174ea6' : '#7a1d1d'};">${success ? 'RÉUSSITE' : 'ÉCHEC'}</div>
          <div style="margin-top:4px;">${success ? `Marge <strong>${margin}</strong> — <strong>2 primes gratuites</strong> pour ce round.` : `${CombatManager.#esc(target?.name || 'La cible')} résiste${margin ? ` (marge <strong>${Math.abs(margin)}</strong>)` : ' (égalité : la cible l’emporte)'}. Aucune prime gratuite.`}</div>
        </div>
      </div>`;
  }

  static #getDestinyStateForCombat(actor) {
    const candidates = [
      ["system.stats.destin.value", actor?.system?.stats?.destin?.value],
      ["system.stats.destin.current", actor?.system?.stats?.destin?.current],
      ["system.stats.destin.actuel", actor?.system?.stats?.destin?.actuel],
      ["system.stats.destin.points", actor?.system?.stats?.destin?.points],
      ["system.stats.destin.remaining", actor?.system?.stats?.destin?.remaining],
      ["system.stats.destin.disponible", actor?.system?.stats?.destin?.disponible],
      ["system.destin.value", actor?.system?.destin?.value],
      ["system.destin.current", actor?.system?.destin?.current],
      ["system.destin.actuel", actor?.system?.destin?.actuel],
      ["system.resources.destin.value", actor?.system?.resources?.destin?.value],
      ["system.resources.destin.current", actor?.system?.resources?.destin?.current],
      ["system.ressources.destin.value", actor?.system?.ressources?.destin?.value],
      ["system.ressources.destin.current", actor?.system?.ressources?.destin?.current],
      ["system.stats.destin", actor?.system?.stats?.destin],
      ["system.destin", actor?.system?.destin],
      ["system.resources.destin", actor?.system?.resources?.destin],
      ["system.ressources.destin", actor?.system?.ressources?.destin]
    ];

    const toFinite = (value) => {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const head = trimmed.split("/")[0]?.trim() ?? trimmed;
        const normalized = head.replace(",", ".");
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    for (const [path, raw] of candidates) {
      const value = toFinite(raw);
      if (value !== null) return { path, value, raw };
    }
    return { path: "system.stats.destin", value: 0, raw: null };
  }

  static async #spendDestinyForCombat(actor, cost) {
    const state = CombatManager.#getDestinyStateForCombat(actor);
    if (state.value < cost) return { ok: false, remaining: state.value, path: state.path, actor };
    await actor.update({ [state.path]: state.value - cost });
    return { ok: true, remaining: state.value - cost, previous: state.value, path: state.path, actor };
  }

  static #killBillRolePhase(kb, role) {
    if (!kb?.armed) return null;
    const phase = String(kb.phase || "");
    if (phase === "armed") return role === kb.owner ? "armed" : "armed-target";
    if (phase === "pick-attack") return role === kb.owner ? "pick-attack" : "waiting-attack";
    if (phase === "pick-defense") return role === kb.target ? "pick-defense" : "waiting-defense";
    if (phase === "resolved") return "resolved";
    return null;
  }

  static #isKillBillSelectionPhase(phase) {
    return phase === "pick-attack" || phase === "pick-defense";
  }

  static #poingsWeaponForKillBill(actor) {
    const hasKillBill = CombatManager.#killBillHasAtout(actor);
    const poingsMod = hasKillBill ? -1 : -3;
    return {
      weaponKey: null,
      name: "Poings",
      degats: String(poingsMod),
      attackMod: poingsMod,
      skillKey: null,
      competenceKey: null,
      combatSkillKey: null,
      skillLabel: null,
      competenceLabel: null,
      combatLabel: null,
      competence: null,
      skill: null,
      typeCombat: null
    };
  }

  static #resolveKillBillWeapon(actor, preferredWeapon = null) {
    const weapon = CombatManager.#resolveWeaponForActor(actor, preferredWeapon?.weaponKey || null, preferredWeapon || null);
    const typeHint = CombatManager.#normalizeSkillText([
      weapon?.typeCombat,
      weapon?.combatLabel,
      weapon?.competenceLabel,
      weapon?.skillLabel,
      weapon?.name
    ].filter(Boolean).join(" "));
    if (/\btir\b|\bdistance\b|arme a feu|pistolet|fusil|carabine|arc/.test(typeHint)) {
      return CombatManager.#poingsWeaponForKillBill(actor);
    }
    return weapon;
  }

  static #getReusableInitiative(attackerActor, targetToken, sceneId) {
    const last = attackerActor?.getFlag?.("arcane15", "lastInitiativeCombat") || null;
    if (!last) return null;
    if (String(last.sceneId || "") !== String(sceneId || "")) return null;
    if (String(last.defenderActorId || "") !== String(targetToken?.actor?.id || "")) return null;
    if (String(last.defenderTokenId || "") !== String(targetToken?.document?.id || targetToken?.id || "")) return null;
    if ((Date.now() - Number(last.at || 0)) > 1000 * 15) return null;
    return last;
  }

  static #storeReusableInitiative(actor, defender, sceneId, result) {
    if (!actor?.setFlag) return;
    actor.setFlag("arcane15", "lastInitiativeCombat", {
      sceneId,
      defenderActorId: defender?.actorId || null,
      defenderTokenId: defender?.tokenId || null,
      winner: result?.winner || null,
      diff: Number(result?.diff ?? 0),
      margin: Math.abs(Number(result?.diff ?? result?.margin ?? 0)),
      effect: result?.effect || null,
      at: Date.now()
    }).catch(err => console.warn("[ARCANE XV][INIT] cannot store lastInitiativeCombat", err));
  }

  static #getRestrictionForRole(session, role) {
    const effect = session?.initiative?.effect;
    if (!effect || effect.loser !== role) return { mustJoker: false, scope: null };
    return { mustJoker: true, scope: effect.scope || null };
  }

  static #canPlaceCardInZone(session, role, currentPlayed, card, zone) {
    const killBill = session?.killBill || null;
    if (CombatManager.#isKillBillSelectionPhase(killBill?.phase)) {
      const forbidden = new Set([
        session?.attacker?.picked?.attack?.id,
        session?.attacker?.picked?.defense?.id,
        session?.defender?.picked?.attack?.id,
        session?.defender?.picked?.defense?.id,
        session?.picks?.attacker?.attack,
        session?.picks?.attacker?.defense,
        session?.picks?.defender?.attack,
        session?.picks?.defender?.defense,
        killBill?.attack?.id,
        killBill?.defense?.id
      ].filter(Boolean));

      if (killBill.phase === "pick-attack") {
        if (role !== killBill.owner) return { ok: false, toast: "Kill Bill : l'adversaire choisit d'abord la carte d'attaque supplémentaire." };
        if (zone !== "attack") return { ok: false, toast: "Kill Bill : une seule carte d'attaque supplémentaire est attendue." };
        if (forbidden.has(card?.id) && card?.id !== killBill?.attack?.id) return { ok: false, toast: "Kill Bill : cette carte est déjà utilisée ce round." };
        return { ok: true };
      }

      if (killBill.phase === "pick-defense") {
        if (role !== killBill.target) return { ok: false, toast: "Kill Bill : le défenseur doit maintenant choisir sa carte de défense supplémentaire." };
        if (zone !== "defense") return { ok: false, toast: "Kill Bill : une seule carte de défense supplémentaire est attendue." };
        if (forbidden.has(card?.id) && card?.id !== killBill?.defense?.id) return { ok: false, toast: "Kill Bill : cette carte est déjà utilisée ce round." };
        return { ok: true };
      }
    }

    const restriction = CombatManager.#getRestrictionForRole(session, role);

    // scope=attack : le perdant doit poser un joker en attaque, mais peut jouer normalement en défense
    if (restriction.mustJoker && restriction.scope === "attack") {
      if (zone === "attack") {
        if (!card?.isJoker) return { ok: false, toast: "Initiative : joker obligatoire en attaque." };
        return { ok: true };
      }
      // En défense, on continue de jouer normalement ; l'attaque comptera pour 0 avec le joker imposé.
      const defVal = card?.isJoker ? 0 : Number(card?.value || 0);
      const max = CombatManager.#sommeMaxFor(role, session);
      if (defVal > max) return { ok: false, toast: `Somme dépassée (${defVal}/${max}).` };
      return { ok: true };
    }

    const played = (currentPlayed || []).filter(c => c && c.zone !== zone);
    const candidate = { ...(card || {}), zone };
    const attack  = zone === "attack"  ? candidate : (played.find(c => c.zone === "attack")  || null);
    const defense = zone === "defense" ? candidate : (played.find(c => c.zone === "defense") || null);

    if (restriction.mustJoker && restriction.scope === "choice" && attack && defense && !(attack.isJoker || defense.isJoker)) {
      return { ok: false, toast: "Initiative : joker imposé en attaque ou en défense." };
    }

    const total = (attack?.isJoker ? 0 : Number(attack?.value || 0)) + (defense?.isJoker ? 0 : Number(defense?.value || 0));
    const max = CombatManager.#sommeMaxFor(role, session);
    if (total > max) return { ok: false, toast: `Somme des cartes dépassée (${total}/${max}).` };
    return { ok: true };
  }

  static #finalizeRoundSelection(session, role) {
    const pick = session.picks[role];
    const actorId = role === "attacker" ? session.attacker.actorId : session.defender.actorId;
    const tokenId = role === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
    const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
    const handCards = CombatManager.#getHandCards(actor);
    const handViews = handCards.map(CombatManager.#cardView);
    const joker = handViews.find(c => c.isJoker) || null;

    const VJOKER = { id: "virtual-joker", name: "Joker", img: "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png", value: 0, isJoker: true };

    let attack  = pick.played.find(p => p.zone === "attack")  || null;
    let defense = pick.played.find(p => p.zone === "defense") || null;

    const restriction = CombatManager.#getRestrictionForRole(session, role);

    // scope=attack : le joueur doit poser explicitement un joker en attaque et une carte en défense
    if (restriction.mustJoker && restriction.scope === "attack") {
      if (!attack || !attack.isJoker) {
        return { ok: false, toast: "Joker imposé en attaque : pose un joker en attaque." };
      }
      if (!defense) return { ok: false, toast: "Joker imposé en attaque : pose une carte en défense." };
    } else {
      // Auto-complétion joker/virtual pour les zones vides
      if (!attack && !defense && joker) attack = { ...joker, zone: "attack" };
      if (!attack  && joker) attack  = { ...joker,  zone: "attack" };
      if (!defense && joker && (!attack || attack.id !== joker.id)) defense = { ...joker, zone: "defense" };
      if (!defense && !joker && attack)  defense = { ...VJOKER, zone: "defense" };
      if (!attack  && !joker && defense) attack  = { ...VJOKER, zone: "attack"  };
    }

    if (!attack || !defense) return { ok: false, toast: "Choisis au moins une carte et garde un joker pour l'autre emplacement." };

    const total = (attack.isJoker ? 0 : Number(attack.value || 0)) + (defense.isJoker ? 0 : Number(defense.value || 0));
    const max = CombatManager.#sommeMaxFor(role, session);
    if (total > max) return { ok: false, toast: `Somme des cartes dépassée (${total}/${max}).` };

    if (restriction.mustJoker && restriction.scope === "choice" && !(attack.isJoker || defense.isJoker)) {
      return { ok: false, toast: "Initiative : joker imposé en attaque ou en défense." };
    }

    pick.attack  = attack.id;
    pick.defense = defense.id;
    pick.played  = [attack, defense];
    return { ok: true };
  }

  static async #applyCardCycleForRound(session, role) {
    const actorId = role === "attacker" ? session.attacker.actorId : session.defender.actorId;
    const tokenId = role === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
    const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
    const ids = [...new Set([
      ...(session.picks[role].played || []).filter(c => c && !c.isJoker && !String(c.id).startsWith("virtual-")).map(c => c.id),
      ...(session.killBill?.result && session.killBill?.owner === role && session.killBill?.attack && !session.killBill.attack.isJoker ? [session.killBill.attack.id] : []),
      ...(session.killBill?.result && session.killBill?.target === role && session.killBill?.defense && !session.killBill.defense.isJoker ? [session.killBill.defense.id] : [])
    ])];
    const handId = actor?.getFlag?.("arcane15", "hand");
    const hand = handId ? game.cards.get(handId) : null;
    for (const id of ids) {
      const card = hand?.cards?.get(id);
      if (!card) continue;
      await CardManager.cycleCard(actor, card);
    }
    await CombatManager.#safeInitDecks(actor);
  }

  static async #resetRoundState(session) {
    for (const role of ["attacker", "defender"]) {
      session.picks[role] = { attack: null, defense: null, locked: false, ready: false, played: [], primes: [], penalites: [] };
    }
    session.killBill = CombatManager.#emptyKillBillState();
    session.pendingRoundAdvance = false;
    session.postRoundKillBillPrompt = false;
    session.roundCardsCycled = false;
    session.lastResolvedRound = Number(session.round || 1);
    session.resolved = { done: false, revealed: false, result: null };
    session.round = Number(session.round || 1) + 1;

    for (const side of ["attacker", "defender"]) {
      try {
        const actorId = side === "attacker" ? session.attacker.actorId : session.defender.actorId;
        const tokenId = side === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
        const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
        if (actor) {
          const runtime = foundry.utils.deepClone(actor.getFlag?.('arcane15', 'arcanaRuntime') || {});
          if (runtime?.larnacoeurCombat?.sessionId && String(runtime.larnacoeurCombat.sessionId) === String(session.sessionId)) {
            delete runtime.larnacoeurCombat;
            await actor.setFlag('arcane15', 'arcanaRuntime', runtime);
          }
        }
      } catch (_) {}
    }

    for (const side of ["attacker", "defender"]) {
      try {
        const actorId = side === "attacker" ? session.attacker.actorId : session.defender.actorId;
        const tokenId = side === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
        const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
        if (!actor) continue;

        const stats = actor.system?.stats || {};
        const updates = {};

        if (stats.inconscient && Number(stats.inconscientRounds || 0) > 0) {
          const next = Math.max(0, Number(stats.inconscientRounds || 0) - 1);
          updates["system.stats.inconscientRounds"] = next;
          if (next === 0) updates["system.stats.inconscient"] = false;
        }

        if (stats.dangerMort && Number(stats.dangerMortRounds || 0) > 0) {
          const next = Math.max(0, Number(stats.dangerMortRounds || 0) - 1);
          updates["system.stats.dangerMortRounds"] = next;
          if (next === 0) {
            updates["system.stats.dangerMort"] = false;
            updates["system.stats.mort"] = true;
          }
        }

        if (Object.keys(updates).length) {
          await actor.update(updates, { axvVitalitySync: true });
          if (updates["system.stats.mort"]) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${actor.name}</strong> succombe à ses blessures.</div></div>`
            });
          } else if (updates["system.stats.inconscient"] === false) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${actor.name}</strong> reprend conscience.</div></div>`
            });
          }
        }
      } catch (error) {
        console.warn("[ARCANE XV][COMBAT] critical state round tick failed", error);
      }
    }
  }

  static async #gmPickCard(data) {
    const { sessionId, role, zone, cardId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role) || !["attack", "defense"].includes(zone)) return;
    if (session.killBill?.armed && CombatManager.#isKillBillSelectionPhase(session.killBill?.phase)) {
      const handled = await CombatManager.#gmPickKillBillCard(data);
      if (handled) return;
    }
    const pick = session.picks[role];
    if (pick.locked) return CombatManager.#gmBroadcastState(sessionId);

    const actorId = role === "attacker" ? session.attacker.actorId : session.defender.actorId;
    const actor = game.actors.get(actorId);
    const handCards = CombatManager.#getHandCards(actor);
    const card = handCards.find(c => c.id === cardId);
    if (!card) return CombatManager.#gmBroadcastState(sessionId);

    let played = (pick.played || []).filter(c => c.zone !== zone && c.id !== cardId);
    const candidate = { ...CombatManager.#cardView(card), zone };
    const check = CombatManager.#canPlaceCardInZone(session, role, played, candidate, zone);
    if (!check.ok) {
      session.toast = check.toast;
      return CombatManager.#gmBroadcastState(sessionId);
    }
    played.push(candidate);

    pick.played = played;
    pick.ready = false;
    pick.locked = false;
    pick.attack = played.find(c => c.zone === "attack")?.id || null;
    pick.defense = played.find(c => c.zone === "defense")?.id || null;
    session.toast = null;

    return CombatManager.#gmBroadcastState(sessionId);
  }

  static async #gmUnpickCard(data) {
    const { sessionId, role, zone } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role) || !["attack", "defense"].includes(zone)) return;
    if (session.killBill?.armed && CombatManager.#isKillBillSelectionPhase(session.killBill?.phase)) {
      const handled = await CombatManager.#gmUnpickKillBillCard(data);
      if (handled) return;
    }
    const pick = session.picks[role];
    if (pick.locked) return CombatManager.#gmBroadcastState(sessionId);
    pick.played = (pick.played || []).filter(c => c.zone !== zone);
    pick.attack = pick.played.find(c => c.zone === "attack")?.id || null;
    pick.defense = pick.played.find(c => c.zone === "defense")?.id || null;
    pick.ready = false;
    return CombatManager.#gmBroadcastState(sessionId);
  }

  static async #gmTogglePP(data) {
    const { sessionId, role, kind, id, checked } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session) return;

    if (role !== "attacker" && role !== "defender") return;
    if (kind !== "prime" && kind !== "penalite") return;

    const pick = session.picks[role];
    if (!pick) return;
    if (pick.locked) return CombatManager.#gmBroadcastState(sessionId);

    if (!Array.isArray(pick.primes)) pick.primes = [];
    if (!Array.isArray(pick.penalites)) pick.penalites = [];

    const list = (kind === "prime") ? pick.primes : pick.penalites;

    // validation id
    const valid = (kind === "prime")
      ? CombatManager.AXV_PP_PRIMES.some(x => x.id === id)
      : CombatManager.AXV_PP_PENALITES.some(x => x.id === id);
    if (!valid) {
      console.warn("[ARCANE XV][COMBAT][GM] pp rejected (invalid id)", { sessionId, role, kind, id });
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const roleInfo = role === 'attacker' ? session.attacker : session.defender;
    const roleActor = CombatManager.#actorFromCombatant({ actorId: roleInfo?.actorId, tokenId: roleInfo?.tokenId, sceneId: session.sceneId });
    const larnState = CombatManager.#getLarnacoeurRoundState(session, role);
    const hasRemyJulienne = CombatManager.#hasCharacterAtout(roleActor, 'remy-julienne');

    if (checked) {
      if (kind === 'prime') {
        const provisionalMax = Number(larnState.freePrimes || 0) + 1 + (hasRemyJulienne ? 1 : 0);
        if (!list.includes(id) && list.length >= provisionalMax) {
          session.toast = `Trop de primes sélectionnées : ${provisionalMax} maximum tant que la combinaison n'est pas complétée.`;
          return CombatManager.#gmBroadcastState(sessionId);
        }
      }
      if (!list.includes(id)) list.push(id);
    } else {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }

    console.log("[ARCANE XV][COMBAT][GM] pp updated", { sessionId, role, primes: pick.primes, penalites: pick.penalites });
    return CombatManager.#gmBroadcastState(sessionId);
  }



  static async #gmArmLarnacoeur(data) {
    const { sessionId, role } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role)) return;
    if (session.ended || session.resolved?.done) return CombatManager.#gmBroadcastState(sessionId);
    if (session.killBill?.armed && CombatManager.#isKillBillSelectionPhase(session.killBill?.phase)) {
      session.toast = "L’arnacoeur n’est pas disponible pendant la résolution de Kill Bill.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const pick = session.picks[role];
    if (!pick || pick.locked) {
      session.toast = "L’arnacoeur doit être activé avant la validation des cartes.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const roleInfo = role === 'attacker' ? session.attacker : session.defender;
    const targetInfo = role === 'attacker' ? session.defender : session.attacker;
    const actor = CombatManager.#actorFromCombatant({ actorId: roleInfo?.actorId, tokenId: roleInfo?.tokenId, sceneId: session.sceneId });
    const target = CombatManager.#actorFromCombatant({ actorId: targetInfo?.actorId, tokenId: targetInfo?.tokenId, sceneId: session.sceneId });

    if (!actor || !target || !CombatManager.#larnacoeurHasAtout(actor)) {
      session.toast = `${roleInfo?.name || 'Ce personnage'} n’a pas accès à L’arnacoeur.`;
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const currentState = CombatManager.#getLarnacoeurRoundState(session, role);
    if (currentState.attemptedThisRound) {
      session.toast = "L’arnacoeur a déjà été activé pour ce round.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const spend = await CombatManager.#spendDestinyForCombat(actor, 1);
    if (!spend?.ok) {
      session.toast = "Pas assez de points de Destin pour L’arnacoeur.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    if (!ArcanaManager?.resolveLarnacoeurCombatActivation) {
      session.toast = "ArcanaManager introuvable pour L’arnacoeur.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const result = await ArcanaManager.resolveLarnacoeurCombatActivation(actor, target, {
      sessionId: session.sessionId,
      round: Number(session.round || 1),
      role,
      gmOnlyChat: true
    });
    if (!result) {
      session.toast = "Activation de L’arnacoeur interrompue.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const runtime = foundry.utils.deepClone(actor.getFlag?.('arcane15', 'arcanaRuntime') || {});
    runtime.larnacoeurCombat = {
      sessionId: session.sessionId,
      round: Number(session.round || 1),
      targetId: target.id,
      targetName: target.name,
      freePrimes: result.success ? 2 : 0,
      lastSuccess: !!result.success,
      margin: Number(result.margin || 0),
      actorTotal: Number(result.actorTotal || 0),
      targetTotal: Number(result.targetTotal || 0),
      label: result.atoutName || 'L’arnacoeur',
      activatedAt: Date.now()
    };
    await actor.setFlag('arcane15', 'arcanaRuntime', runtime);

    session.toast = result.success
      ? `L’arnacoeur réussi : 2 primes gratuites pour ${roleInfo?.name || actor.name} ce round.`
      : `L’arnacoeur échoue : aucune prime gratuite pour ${roleInfo?.name || actor.name}.`;

    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: CombatManager.#larnacoeurSummaryChatHtml(actor, target, result, result.atoutName || 'L’arnacoeur')
      });
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][LARNACOEUR][GM] chat create failed', e);
    }

    return CombatManager.#gmBroadcastState(sessionId);
  }

  static async #gmArmKillBill(data) {
    const { sessionId, role } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role) || session.ended) return;

    session.killBill ||= CombatManager.#emptyKillBillState();
    if (session.killBill.armed) {
      session.toast = "Kill Bill est déjà armé pour ce round.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const actorInfo = role === "attacker" ? session.attacker : session.defender;
    const actorTokDoc = CombatManager.#tokenDocFrom(session.sceneId, actorInfo?.tokenId);
    const actor = actorTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: actorInfo?.actorId, tokenId: actorInfo?.tokenId, sceneId: session.sceneId });
    if (!actor || !CombatManager.#killBillHasAtout(actor)) {
      session.toast = "Kill Bill n'est pas disponible pour ce personnage.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    const spend = await CombatManager.#spendDestinyForCombat(actor, 1);
    if (!spend?.ok) {
      session.toast = "Pas assez de points de Destin pour Kill Bill.";
      return CombatManager.#gmBroadcastState(sessionId);
    }

    session.killBill = {
      owner: role,
      target: role === "attacker" ? "defender" : "attacker",
      armed: true,
      phase: "armed",
      attack: null,
      defense: null,
      ownerReady: false,
      targetReady: false,
      result: null,
      round: Number(session.resolved?.result?.round ?? session.lastResolvedRound ?? session.round ?? 1),
      weapon: CombatManager.#resolveKillBillWeapon(actor, role === "attacker" ? session.attacker.weapon : session.defender.weapon)
    };

    if (session.resolved?.done && session.resolved?.result) {
      session.pendingRoundAdvance = false;
      session.postRoundKillBillPrompt = false;
      session.killBill.phase = "pick-attack";
      session.toast = `Kill Bill : ${session[session.killBill.owner].name} doit maintenant choisir sa carte d'attaque supplémentaire.`;
      console.log("[ARCANE XV][COMBAT][KILL BILL][GM][ARM][POST-ROUND]", {
        sessionId,
        role,
        target: session.killBill.target,
        round: session.resolved?.result?.round ?? session.round,
        weapon: session.killBill.weapon
      });
      return CombatManager.#gmBroadcastState(sessionId);
    }

    session.toast = "Kill Bill armé : l'attaque supplémentaire sera jouée à la fin du round.";
    console.log("[ARCANE XV][COMBAT][KILL BILL][GM][ARM]", {
      sessionId,
      role,
      target: session.killBill.target,
      weapon: session.killBill.weapon
    });
    return CombatManager.#gmBroadcastState(sessionId);
  }

  static async #gmPickKillBillCard(data) {
    const { sessionId, role, zone, cardId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    const killBill = session?.killBill;
    if (!session || !killBill?.armed || !CombatManager.#isKillBillSelectionPhase(killBill.phase)) return false;

    const expectedRole = killBill.phase === "pick-attack" ? killBill.owner : killBill.target;
    const expectedZone = killBill.phase === "pick-attack" ? "attack" : "defense";
    if (role !== expectedRole || zone !== expectedZone) {
      session.toast = expectedZone === "attack"
        ? "Kill Bill : une seule carte d'attaque supplémentaire est attendue côté attaquant."
        : "Kill Bill : une seule carte de défense supplémentaire est attendue côté défenseur.";
      await CombatManager.#gmBroadcastState(sessionId);
      return true;
    }

    const actorId = role === "attacker" ? session.attacker.actorId : session.defender.actorId;
    const tokenId = role === "attacker" ? session.attacker.tokenId : session.defender.tokenId;
    const actor = CombatManager.#actorFromCombatant({ actorId, tokenId, sceneId: session.sceneId });
    const handCards = CombatManager.#getHandCards(actor);
    const card = handCards.find(c => c.id === cardId);
    if (!card) {
      await CombatManager.#gmBroadcastState(sessionId);
      return true;
    }

    const forbidden = new Set([
      session.picks.attacker.attack,
      session.picks.attacker.defense,
      session.picks.defender.attack,
      session.picks.defender.defense,
      expectedZone === "attack" ? killBill.defense?.id : killBill.attack?.id
    ].filter(Boolean));
    if (forbidden.has(cardId)) {
      session.toast = "Kill Bill : cette carte est déjà utilisée ce round.";
      await CombatManager.#gmBroadcastState(sessionId);
      return true;
    }

    const candidate = { ...CombatManager.#cardView(card), zone: expectedZone };
    if (expectedZone === "attack") {
      killBill.attack = candidate;
      killBill.ownerReady = false;
      session.toast = "Kill Bill : l'attaquant a choisi sa carte d'attaque supplémentaire.";
    } else {
      killBill.defense = candidate;
      killBill.targetReady = false;
      session.toast = "Kill Bill : le défenseur a choisi sa carte de défense supplémentaire.";
    }

    console.log("[ARCANE XV][COMBAT][KILL BILL][GM][PICK]", {
      sessionId,
      role,
      phase: killBill.phase,
      zone: expectedZone,
      cardId
    });

    await CombatManager.#gmBroadcastState(sessionId);
    return true;
  }

  static async #gmUnpickKillBillCard(data) {
    const { sessionId, role, zone } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    const killBill = session?.killBill;
    if (!session || !killBill?.armed || !CombatManager.#isKillBillSelectionPhase(killBill.phase)) return false;

    const expectedRole = killBill.phase === "pick-attack" ? killBill.owner : killBill.target;
    const expectedZone = killBill.phase === "pick-attack" ? "attack" : "defense";
    if (role !== expectedRole || zone !== expectedZone) return true;

    if (expectedZone === "attack") {
      killBill.attack = null;
      killBill.ownerReady = false;
    } else {
      killBill.defense = null;
      killBill.targetReady = false;
    }

    await CombatManager.#gmBroadcastState(sessionId);
    return true;
  }

  static async #gmKillBillReady(data) {
    const { sessionId, role } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    const killBill = session?.killBill;
    if (!session || !killBill?.armed || !CombatManager.#isKillBillSelectionPhase(killBill.phase)) return false;

    console.log("[ARCANE XV][COMBAT][KILL BILL][GM][READY]", {
      sessionId,
      role,
      phase: killBill.phase,
      attack: killBill.attack?.id || null,
      defense: killBill.defense?.id || null
    });

    if (killBill.phase === "pick-attack") {
      if (role !== killBill.owner) return CombatManager.#gmBroadcastState(sessionId);
      if (!killBill.attack) {
        session.toast = "Kill Bill : choisis une carte d'attaque supplémentaire.";
        await CombatManager.#gmBroadcastState(sessionId);
        return true;
      }
      killBill.ownerReady = true;
      killBill.phase = "pick-defense";
      const ownerName = killBill.owner === "attacker" ? session.attacker.name : session.defender.name;
      session.toast = `Kill Bill : ${session[killBill.target].name} subit une attaque supplémentaire de ${ownerName} et doit maintenant choisir une carte de défense.`;
      await CombatManager.#gmBroadcastState(sessionId);
      return true;
    }

    if (killBill.phase === "pick-defense") {
      if (role !== killBill.target) return CombatManager.#gmBroadcastState(sessionId);
      if (!killBill.defense) {
        session.toast = "Kill Bill : le défenseur doit choisir une carte de défense supplémentaire.";
        await CombatManager.#gmBroadcastState(sessionId);
        return true;
      }
      killBill.targetReady = true;
      session.toast = null;
      await CombatManager.#gmBroadcastState(sessionId);
      await CombatManager.#gmResolveKillBill({ sessionId });
      return true;
    }

    return true;
  }

  static async #gmReady(data) {
    const { sessionId, role } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role)) return;
    if (session.killBill?.armed && CombatManager.#isKillBillSelectionPhase(session.killBill?.phase)) {
      return CombatManager.#gmKillBillReady(data);
    }
    if (session.resolved?.done && session.pendingRoundAdvance && !session.killBill?.armed) {
      session.postRoundKillBillPrompt = false;
      session.toast = null;
      return CombatManager.#gmAdvanceRound({ sessionId });
    }
    const pick = session.picks[role];
    if (pick.locked) return CombatManager.#gmBroadcastState(sessionId);

    const finalized = CombatManager.#finalizeRoundSelection(session, role);
    if (!finalized.ok) {
      session.toast = finalized.toast;
      await CombatManager.#gmBroadcastState(sessionId);
      return;
    }

    const roleInfo = role === 'attacker' ? session.attacker : session.defender;
    const roleActor = CombatManager.#actorFromCombatant({ actorId: roleInfo?.actorId, tokenId: roleInfo?.tokenId, sceneId: session.sceneId });
    const larnState = CombatManager.#getLarnacoeurRoundState(session, role);
    const hasRemyJulienne = CombatManager.#hasCharacterAtout(roleActor, 'remy-julienne');
    const freePrimes = Number(larnState.freePrimes || 0);
    const paidPrime = (pick.penalites || []).length > 0 ? 1 : 0;
    const remyBonus = (hasRemyJulienne && (pick.penalites || []).includes('risque')) ? 1 : 0;
    const allowedPrimes = paidPrime + freePrimes + remyBonus;

    if ((pick.primes || []).length > allowedPrimes) {
      session.toast = `Trop de primes sélectionnées : ${allowedPrimes} autorisée(s) pour ce tour.`;
      await CombatManager.#gmBroadcastState(sessionId);
      return;
    }

    pick.locked = true;
    pick.ready = true;
    session.toast = null;

    console.log("[ARCANE XV][COMBAT][GM] ready locked", { sessionId, role, attack: pick.attack, defense: pick.defense });
    await CombatManager.#gmBroadcastState(sessionId);

    if (session.picks.attacker.ready && session.picks.defender.ready) {
      console.log("[ARCANE XV][COMBAT][GM] both ready -> auto resolve", { sessionId });
      return CombatManager.#gmResolve({ sessionId, auto: true });
    }
  }

  static #ppState(session, role) {
    const pick = session?.picks?.[role] || {};
    return {
      primes: Array.isArray(pick.primes) ? [...pick.primes] : [],
      penalites: Array.isArray(pick.penalites) ? [...pick.penalites] : []
    };
  }

  static #ppLabelMap() {
    const map = new Map();
    for (const x of CombatManager.AXV_PP_PRIMES) map.set(x.id, x.label);
    for (const x of CombatManager.AXV_PP_PENALITES) map.set(x.id, x.label);
    return map;
  }

  static #ppLabels(ids = []) {
    const map = CombatManager.#ppLabelMap();
    return (Array.isArray(ids) ? ids : []).map(id => map.get(id) || id);
  }

  static #pickMerteuilBonus(actor, targetActor, blocked = null) {
    const runtime = actor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
    const blockedSet = blocked instanceof Set ? blocked : new Set(Array.isArray(blocked) ? blocked : []);
    const targetId = String(targetActor?.id || '');
    const personal = runtime?.merteuilBonus;
    if (personal?.value && targetId && String(personal?.targetId || '') === targetId && !blockedSet.has('merteuilBonus')) {
      return { key: 'merteuilBonus', bonus: personal };
    }
    const shared = runtime?.sharedMerteuilBonus;
    if (shared?.value && targetId && String(shared?.targetId || '') === targetId && !blockedSet.has('sharedMerteuilBonus')) {
      return { key: 'sharedMerteuilBonus', bonus: shared };
    }
    return null;
  }

  static async #consumeMerteuilBonuses(actor, keys = []) {
    const unique = [...new Set((keys || []).filter(Boolean))];
    if (!actor || !unique.length) return;
    const runtime = foundry.utils.deepClone(actor.getFlag?.('arcane15', 'arcanaRuntime') || {});
    let dirty = false;
    for (const key of unique) {
      if (runtime && Object.prototype.hasOwnProperty.call(runtime, key)) {
        delete runtime[key];
        dirty = true;
      }
    }
    if (dirty) await actor.setFlag('arcane15', 'arcanaRuntime', runtime);
  }

  static async #gmResolve(data) {
    const { sessionId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || session.ended) return;
    if (!session.picks.attacker.ready || !session.picks.defender.ready) return CombatManager.#gmBroadcastState(sessionId);
    if (session.resolved.done) return CombatManager.#gmBroadcastState(sessionId);

    const scene = CombatManager.#sceneById(session.sceneId);
    const attackerTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.attacker.tokenId);
    const attackerActor = attackerTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.attacker.actorId, tokenId: session.attacker.tokenId, sceneId: session.sceneId });
    const tokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.defender.tokenId);
    const defenderActor = tokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.defender.actorId, tokenId: session.defender.tokenId, sceneId: session.sceneId });

    const _sv  = (s) => Number(s?.val ?? 0);
    const atkCombatSkill = CombatManager.#resolveCombatSkill(attackerActor, session.attacker.weapon, 'attacker');
    const defCombatSkill = CombatManager.#resolveCombatSkill(defenderActor, session.defender.weapon, 'defender');
    const atkCombat = Number(atkCombatSkill?.value ?? 0);
    const atkCombatLabel = String(atkCombatSkill?.label || 'Combat').trim() || 'Combat';
    const atkDefenseSkill = _sv(attackerActor?.system?.competences?.defense);
    const atkProtection = Number(attackerActor?.system?.stats?.protection ?? 0);
    const defCombat = Number(defCombatSkill?.value ?? 0);
    const defCombatLabel = String(defCombatSkill?.label || 'Combat').trim() || 'Combat';
    const defDefenseSkill = _sv(defenderActor?.system?.competences?.defense);
    const defProtection = Number(defenderActor?.system?.stats?.protection ?? 0);

    const att = session.picks.attacker;
    const def = session.picks.defender;
    const attackerActsFirst = session.initiative?.winner !== "defender";

    const aAtk = att.played.find(c => c.zone === "attack") || { value: 0, isJoker: true, name: "Joker" };
    const aDef = att.played.find(c => c.zone === "defense") || { value: 0, isJoker: true, name: "Joker" };
    const dAtk = def.played.find(c => c.zone === "attack") || { value: 0, isJoker: true, name: "Joker" };
    const dDef = def.played.find(c => c.zone === "defense") || { value: 0, isJoker: true, name: "Joker" };

    const aWeapon = session.attacker.weapon || { name: "Poings", attackMod: -3, degats: "-3" };
    const dWeapon = session.defender.weapon || { name: "Poings", attackMod: -3, degats: "-3" };

    const ppAtt = CombatManager.#ppState(session, 'attacker');
    const ppDef = CombatManager.#ppState(session, 'defender');

    const makeExchange = ({ attackerSide, defenderSide, attackActor, defenseActor, attackCard, defenseCard, attackSkill, attackSkillLabel = "Combat", defenseSkill, weaponMod, protection, weaponName, consumedMerteuil = new Map() }) => {
      const attackPP = attackerSide === 'attacker' ? ppAtt : ppDef;
      const defensePP = defenderSide === 'attacker' ? ppAtt : ppDef;

      const atkMods = [];
      const defMods = [];
      const atkStateMods = [];
      const defStateMods = [];
      let atkAdj = 0;
      let defAdj = 0;
      let atkPPAdj = 0;
      let defPPAdj = 0;
      let atkStateAdj = 0;
      let defStateAdj = 0;

      if (attackPP.primes.includes('efficacite')) { atkAdj += 1; atkPPAdj += 1; atkMods.push('Efficacité +1'); }
      if (attackPP.penalites.includes('difficulte')) { atkAdj -= 1; atkPPAdj -= 1; atkMods.push('Difficulté -1'); }
      if (defensePP.primes.includes('prudence')) { defAdj += 1; defPPAdj += 1; defMods.push('Prudence +1'); }
      if (defensePP.penalites.includes('danger')) { defAdj -= 1; defPPAdj -= 1; defMods.push('Danger -1'); }

      const attackVitalite = Number(attackActor?.system?.stats?.vitalite ?? 0);
      const defenseVitalite = Number(defenseActor?.system?.stats?.vitalite ?? 0);
      const attackMalEnPoint = !!(attackActor?.system?.stats?.malEnPoint || attackActor?.getFlag?.('arcane15', 'malEnPoint'));
      const defenseMalEnPoint = !!(defenseActor?.system?.stats?.malEnPoint || defenseActor?.getFlag?.('arcane15', 'malEnPoint'));
      if (attackMalEnPoint || attackVitalite <= 0) { atkAdj -= 1; atkStateAdj -= 1; atkStateMods.push('Mal en point -1'); }
      if (defenseMalEnPoint || defenseVitalite <= 0) { defAdj -= 1; defStateAdj -= 1; defStateMods.push('Mal en point -1'); }

      const attackRuntime = attackActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const defenseRuntime = defenseActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const attackAllTestsMalus = Number(attackRuntime?.allTestsMalus?.value || 0);
      const defenseAllTestsMalus = Number(defenseRuntime?.allTestsMalus?.value || 0);
      if (attackAllTestsMalus) { atkAdj -= attackAllTestsMalus; atkStateAdj -= attackAllTestsMalus; atkStateMods.push(`${attackRuntime?.allTestsMalus?.label || 'Malus arcane'} -${attackAllTestsMalus}`); }
      if (defenseAllTestsMalus) { defAdj -= defenseAllTestsMalus; defStateAdj -= defenseAllTestsMalus; defStateMods.push(`${defenseRuntime?.allTestsMalus?.label || 'Malus arcane'} -${defenseAllTestsMalus}`); }

      const attackBlocked = consumedMerteuil.get(String(attackActor?.id || '')) || null;
      const defenseBlocked = consumedMerteuil.get(String(defenseActor?.id || '')) || null;
      const attackMerteuilMatch = CombatManager.#pickMerteuilBonus(attackActor, defenseActor, attackBlocked);
      const defenseMerteuilMatch = CombatManager.#pickMerteuilBonus(defenseActor, attackActor, defenseBlocked);
      const attackMerteuil = attackMerteuilMatch?.bonus || null;
      const defenseMerteuil = defenseMerteuilMatch?.bonus || null;
      if (attackMerteuil?.value) { atkAdj += Number(attackMerteuil.value || 0); atkStateAdj += Number(attackMerteuil.value || 0); atkStateMods.push(`${attackMerteuil.label || 'Marquise de Merteuil'} +${Number(attackMerteuil.value || 0)}`); }
      if (defenseMerteuil?.value) { defAdj += Number(defenseMerteuil.value || 0); defStateAdj += Number(defenseMerteuil.value || 0); defStateMods.push(`${defenseMerteuil.label || 'Marquise de Merteuil'} +${Number(defenseMerteuil.value || 0)}`); }

      const attackDoublePrimes = !!attackRuntime?.statuses?.doublePrimes;
      const defenseDoublePrimes = !!defenseRuntime?.statuses?.doublePrimes;
      if (attackDoublePrimes && attackPP.primes.includes('efficacite')) { atkAdj += 1; atkPPAdj += 1; atkMods.push('Maison-dieu : Efficacité doublée'); }
      if (defenseDoublePrimes && defensePP.primes.includes('prudence')) { defAdj += 1; defPPAdj += 1; defMods.push('Maison-dieu : Prudence doublée'); }

      const atkCardVal = attackCard?.isJoker ? 0 : Number(attackCard?.value ?? 0);
      const defCardVal = defenseCard?.isJoker ? 0 : Number(defenseCard?.value ?? 0);
      const atkBase = Number(attackSkill) + atkCardVal + Number(weaponMod || 0);
      const defBase = Number(defenseSkill) + defCardVal + Number(protection || 0);
      const atkTotal = atkBase + atkAdj;
      const defTotal = defBase + defAdj;
      const margin = atkTotal - defTotal;
      const hit = margin > 0;

      let damage = hit ? margin : 0;
      const damageMods = [];
      if (hit && attackPP.primes.includes('attaque_meurtriere')) {
        damage += 2;
        damageMods.push('Attaque meurtrière +2 dégâts');
        if (attackDoublePrimes) {
          damage += 2;
          damageMods.push('Maison-dieu : Attaque meurtrière doublée (+2)');
        }
      }
      if (hit && attackPP.primes.includes('attaques_multiples')) {
        damage = Math.ceil(damage / 2);
        damageMods.push('Attaques multiples dégâts/2');
      }
      if (hit && defensePP.penalites.includes('blessure_legere')) {
        damage = Math.ceil(damage / 2);
        damageMods.push('Blessure légère dégâts/2');
      }
      const attackArcaneDamageBonus = Number(attackActor?.getFlag?.('arcane15', 'arcaneDamageBonus') ?? 0);
      if (hit && attackArcaneDamageBonus) {
        damage += attackArcaneDamageBonus;
        damageMods.push(`Arcane-sans-nom +${attackArcaneDamageBonus} dégâts`);
      }

      console.log('[ARCANE XV][COMBAT][RESOLVE] exchange modifiers', {
        attackerSide,
        defenderSide,
        weaponName,
        attackSkill,
        attackSkillLabel,
        defenseSkill,
        weaponMod,
        protection,
        attackPP,
        defensePP,
        atkAdj,
        defAdj,
        atkPPAdj,
        defPPAdj,
        atkStateAdj,
        defStateAdj,
        atkStateMods,
        defStateMods,
        atkBase,
        defBase,
        atkTotal,
        defTotal
      });

      return {
        attackerSide,
        defenderSide,
        attackCard,
        defenseCard,
        attackSkillVal: Number(attackSkill),
        attackSkillLabel: attackSkillLabel,
        atkCardVal,
        weaponModVal: Number(weaponMod || 0),
        weaponName: weaponName || "Poings",
        defenseSkillVal: Number(defenseSkill),
        defCardVal,
        protectionVal: Number(protection || 0),
        atkAdj,
        defAdj,
        atkPPAdj,
        defPPAdj,
        atkStateAdj,
        defStateAdj,
        atkBase,
        defBase,
        atkTotal,
        defTotal,
        atkMods,
        defMods,
        atkStateMods,
        defStateMods,
        margin,
        hit,
        damage,
        damageMods,
        consumedMerteuil: {
          attackActorId: attackMerteuilMatch ? String(attackActor?.id || '') : null,
          attackKey: attackMerteuilMatch?.key || null,
          defenseActorId: defenseMerteuilMatch ? String(defenseActor?.id || '') : null,
          defenseKey: defenseMerteuilMatch?.key || null
        },
        pp: {
          attacker: { primes: [...attackPP.primes], penalites: [...attackPP.penalites] },
          defender: { primes: [...defensePP.primes], penalites: [...defensePP.penalites] },
          incidents: {
            attacker: attackPP.penalites.includes('risque'),
            defender: defensePP.penalites.includes('risque')
          }
        }
      };
    };

    const consumedMerteuil = new Map();

    const first = attackerActsFirst
      ? makeExchange({ attackerSide: 'attacker', defenderSide: 'defender', attackActor: attackerActor, defenseActor: defenderActor, attackCard: aAtk, defenseCard: dDef, attackSkill: atkCombat, attackSkillLabel: atkCombatLabel, defenseSkill: defDefenseSkill, weaponMod: aWeapon.attackMod, protection: defProtection, weaponName: aWeapon.name, consumedMerteuil })
      : makeExchange({ attackerSide: 'defender', defenderSide: 'attacker', attackActor: defenderActor, defenseActor: attackerActor, attackCard: dAtk, defenseCard: aDef, attackSkill: defCombat, attackSkillLabel: defCombatLabel, defenseSkill: atkDefenseSkill, weaponMod: dWeapon.attackMod, protection: atkProtection, weaponName: dWeapon.name, consumedMerteuil });

    const markConsumedMerteuil = (exchange) => {
      if (!exchange?.consumedMerteuil) return;
      for (const [actorId, key] of [
        [exchange.consumedMerteuil.attackActorId, exchange.consumedMerteuil.attackKey],
        [exchange.consumedMerteuil.defenseActorId, exchange.consumedMerteuil.defenseKey]
      ]) {
        if (!actorId || !key) continue;
        const set = consumedMerteuil.get(String(actorId)) || new Set();
        set.add(String(key));
        consumedMerteuil.set(String(actorId), set);
      }
    };

    const applyConsumedMerteuilFlags = async () => {
      for (const [actorId, keysSet] of consumedMerteuil.entries()) {
        const targetActor = [attackerActor, defenderActor].find(a => String(a?.id || '') === String(actorId));
        if (!targetActor) continue;
        await CombatManager.#consumeMerteuilBonuses(targetActor, [...keysSet]);
      }
    };

    const applied = [];
    const firstApplied = await applyDamage(first); if (firstApplied) applied.push(firstApplied);
    markConsumedMerteuil(first);

    const second = attackerActsFirst
      ? makeExchange({ attackerSide: 'defender', defenderSide: 'attacker', attackActor: defenderActor, defenseActor: attackerActor, attackCard: dAtk, defenseCard: aDef, attackSkill: defCombat, attackSkillLabel: defCombatLabel, defenseSkill: atkDefenseSkill, weaponMod: dWeapon.attackMod, protection: atkProtection, weaponName: dWeapon.name, consumedMerteuil })
      : makeExchange({ attackerSide: 'attacker', defenderSide: 'defender', attackActor: attackerActor, defenseActor: defenderActor, attackCard: aAtk, defenseCard: dDef, attackSkill: atkCombat, attackSkillLabel: atkCombatLabel, defenseSkill: defDefenseSkill, weaponMod: aWeapon.attackMod, protection: defProtection, weaponName: aWeapon.name, consumedMerteuil });

    const secondApplied = await applyDamage(second); if (secondApplied) applied.push(secondApplied);
    markConsumedMerteuil(second);
    await applyConsumedMerteuilFlags();

    session.resolved = {
      done: true,
      revealed: true,
      result: {
        round: session.round,
        initiativeWinner: session.initiative?.winner,
        first,
        second,
        attackerWeapon: aWeapon,
        defenderWeapon: dWeapon,
        applied,
        ppSummary: {
          attacker: { primes: CombatManager.#ppLabels(ppAtt.primes), penalites: CombatManager.#ppLabels(ppAtt.penalites) },
          defender: { primes: CombatManager.#ppLabels(ppDef.primes), penalites: CombatManager.#ppLabels(ppDef.penalites) }
        }
      }
    };

    console.log('[ARCANE XV][COMBAT][GM] resolved', { sessionId, result: session.resolved.result });

    await CombatManager.#gmBroadcastState(sessionId);

    try {
      await ChatMessage.create({
        content: CombatManager.#chatHtml(session, attackerActor, defenderActor),
        speaker: { alias: "" },
        style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
        flags: { arcane15: { customCard: true } }
      });
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][GM] chat create failed', e);
    }

    try {
      await CombatManager.#applyCardCycleForRound(session, 'attacker');
      await CombatManager.#applyCardCycleForRound(session, 'defender');
      session.roundCardsCycled = true;
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][GM] card cycle after resolved round failed', e);
    }

    if (session.killBill?.armed && (session.killBill.phase === 'armed' || CombatManager.#isKillBillSelectionPhase(session.killBill.phase))) {
      if (session.killBill.phase === 'armed') {
        session.killBill.phase = 'pick-attack';
        session.killBill.round = Number(session.resolved?.result?.round ?? session.killBill.round ?? session.lastResolvedRound ?? session.round ?? 1);
        session.killBill.attack = null;
        session.killBill.defense = null;
        session.killBill.ownerReady = false;
        session.killBill.targetReady = false;
        session.toast = `Kill Bill : ${session[session.killBill.owner].name} doit maintenant choisir sa carte d'attaque supplémentaire.`;
        console.log('[ARCANE XV][COMBAT][KILL BILL][GM][START]', {
          sessionId,
          owner: session.killBill.owner,
          target: session.killBill.target,
          round: session.resolved?.result?.round ?? session.round
        });
      }
      session.pendingRoundAdvance = false;
      await CombatManager.#gmBroadcastState(sessionId);
      return;
    }

    session.pendingRoundAdvance = false;

    if (!session.ended) {
      await CombatManager.#resetRoundState(session);
      session.toast = 'Round terminé : 1 carte repiochée, joker vérifié, round suivant prêt.';
      await CombatManager.#safeInitDecks(attackerActor);
      await CombatManager.#safeInitDecks(defenderActor);
      await CombatManager.#gmBroadcastState(sessionId);
    }
  }


  static async #gmAdvanceRound(data) {
    const { sessionId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || session.ended) return;
    if (!session.resolved?.done || !session.pendingRoundAdvance) return CombatManager.#gmBroadcastState(sessionId);
    if (session.killBill?.armed) return CombatManager.#gmBroadcastState(sessionId);
    session.postRoundKillBillPrompt = false;

    const attackerTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.attacker.tokenId);
    const attackerActor = attackerTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.attacker.actorId, tokenId: session.attacker.tokenId, sceneId: session.sceneId });
    const defenderTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.defender.tokenId);
    const defenderActor = defenderTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.defender.actorId, tokenId: session.defender.tokenId, sceneId: session.sceneId });

    if (!session.roundCardsCycled) {
      try {
        await CombatManager.#applyCardCycleForRound(session, 'attacker');
        await CombatManager.#applyCardCycleForRound(session, 'defender');
        session.roundCardsCycled = true;
      } catch (e) {
        console.error('[ARCANE XV][COMBAT][GM] card cycle after round failed', e);
      }
    }

    if (!session.ended) {
      await CombatManager.#resetRoundState(session);
      session.toast = 'Round terminé : 1 carte repiochée, joker vérifié, round suivant prêt.';
      await CombatManager.#safeInitDecks(attackerActor);
      await CombatManager.#safeInitDecks(defenderActor);
      await CombatManager.#gmBroadcastState(sessionId);
    }
  }

  static async #gmResolveKillBill(data) {
    const { sessionId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    const killBill = session?.killBill;
    if (!session || !killBill?.armed || killBill.phase !== 'pick-defense' || !killBill.ownerReady || !killBill.targetReady) return;
    if (!killBill.attack || !killBill.defense) return CombatManager.#gmBroadcastState(sessionId);

    const attackerTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.attacker.tokenId);
    const attackerActor = attackerTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.attacker.actorId, tokenId: session.attacker.tokenId, sceneId: session.sceneId });
    const defenderTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.defender.tokenId);
    const defenderActor = defenderTokDoc?.actor || CombatManager.#actorFromCombatant({ actorId: session.defender.actorId, tokenId: session.defender.tokenId, sceneId: session.sceneId });

    const ownerRole = killBill.owner;
    const targetRole = killBill.target;
    const attackActor = ownerRole === 'attacker' ? attackerActor : defenderActor;
    const defenseActor = targetRole === 'attacker' ? attackerActor : defenderActor;
    const attackWeapon = killBill.weapon || (ownerRole === 'attacker' ? session.attacker.weapon : session.defender.weapon) || { name: 'Poings', attackMod: -3, degats: '-3' };

    const _sv  = (s) => Number(s?.val ?? 0);
    const attackSkillData = CombatManager.#resolveCombatSkill(attackActor, attackWeapon, ownerRole);
    const attackSkill = Number(attackSkillData?.value ?? 0);
    const attackSkillLabel = String(attackSkillData?.label || 'Combat').trim() || 'Combat';
    const defenseSkill = _sv(defenseActor?.system?.competences?.defense);
    const protection = Number(defenseActor?.system?.stats?.protection ?? 0);

    const ppAtt = { primes: [], penalites: [] };
    const ppDef = { primes: [], penalites: [] };

    const makeExchange = ({ attackerSide, defenderSide, attackActor, defenseActor, attackCard, defenseCard, attackSkill, attackSkillLabel = "Combat", defenseSkill, weaponMod, protection, weaponName }) => {
      const attackPP = attackerSide === 'attacker' ? ppAtt : ppDef;
      const defensePP = defenderSide === 'attacker' ? ppAtt : ppDef;

      const atkMods = [];
      const defMods = [];
      const atkStateMods = [];
      const defStateMods = [];
      let atkAdj = 0;
      let defAdj = 0;
      let atkPPAdj = 0;
      let defPPAdj = 0;
      let atkStateAdj = 0;
      let defStateAdj = 0;

      const attackVitalite = Number(attackActor?.system?.stats?.vitalite ?? 0);
      const defenseVitalite = Number(defenseActor?.system?.stats?.vitalite ?? 0);
      const attackMalEnPoint = !!(attackActor?.system?.stats?.malEnPoint || attackActor?.getFlag?.('arcane15', 'malEnPoint'));
      const defenseMalEnPoint = !!(defenseActor?.system?.stats?.malEnPoint || defenseActor?.getFlag?.('arcane15', 'malEnPoint'));
      if (attackMalEnPoint || attackVitalite <= 0) { atkAdj -= 1; atkStateAdj -= 1; atkStateMods.push('Mal en point -1'); }
      if (defenseMalEnPoint || defenseVitalite <= 0) { defAdj -= 1; defStateAdj -= 1; defStateMods.push('Mal en point -1'); }

      const attackRuntime = attackActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const defenseRuntime = defenseActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const attackAllTestsMalus = Number(attackRuntime?.allTestsMalus?.value || 0);
      const defenseAllTestsMalus = Number(defenseRuntime?.allTestsMalus?.value || 0);
      if (attackAllTestsMalus) { atkAdj -= attackAllTestsMalus; atkStateAdj -= attackAllTestsMalus; atkStateMods.push(`${attackRuntime?.allTestsMalus?.label || 'Malus arcane'} -${attackAllTestsMalus}`); }
      if (defenseAllTestsMalus) { defAdj -= defenseAllTestsMalus; defStateAdj -= defenseAllTestsMalus; defStateMods.push(`${defenseRuntime?.allTestsMalus?.label || 'Malus arcane'} -${defenseAllTestsMalus}`); }

      const attackMerteuil = [attackRuntime?.merteuilBonus, attackRuntime?.sharedMerteuilBonus].find(b => b?.value && String(b?.targetId || '') === String(defenseActor?.id || '')) || null;
      const defenseMerteuil = [defenseRuntime?.merteuilBonus, defenseRuntime?.sharedMerteuilBonus].find(b => b?.value && String(b?.targetId || '') === String(attackActor?.id || '')) || null;
      if (attackMerteuil?.value) { atkAdj += Number(attackMerteuil.value || 0); atkStateAdj += Number(attackMerteuil.value || 0); atkStateMods.push(`${attackMerteuil.label || 'Marquise de Merteuil'} +${Number(attackMerteuil.value || 0)}`); }
      if (defenseMerteuil?.value) { defAdj += Number(defenseMerteuil.value || 0); defStateAdj += Number(defenseMerteuil.value || 0); defStateMods.push(`${defenseMerteuil.label || 'Marquise de Merteuil'} +${Number(defenseMerteuil.value || 0)}`); }

      const atkCardVal = attackCard?.isJoker ? 0 : Number(attackCard?.value ?? 0);
      const defCardVal = defenseCard?.isJoker ? 0 : Number(defenseCard?.value ?? 0);
      const atkBase = Number(attackSkill) + atkCardVal + Number(weaponMod || 0);
      const defBase = Number(defenseSkill) + defCardVal + Number(protection || 0);
      const atkTotal = atkBase + atkAdj;
      const defTotal = defBase + defAdj;
      const margin = atkTotal - defTotal;
      const hit = margin > 0;

      let damage = hit ? margin : 0;
      const damageMods = [];
      const attackArcaneDamageBonus = Number(attackActor?.getFlag?.('arcane15', 'arcaneDamageBonus') ?? 0);
      if (hit && attackArcaneDamageBonus) {
        damage += attackArcaneDamageBonus;
        damageMods.push(`Arcane-sans-nom +${attackArcaneDamageBonus} dégâts`);
      }

      return {
        attackerSide,
        defenderSide,
        attackCard,
        defenseCard,
        attackSkillVal: Number(attackSkill),
        attackSkillLabel: attackSkillLabel,
        atkCardVal,
        weaponModVal: Number(weaponMod || 0),
        weaponName: weaponName || "Poings",
        defenseSkillVal: Number(defenseSkill),
        defCardVal,
        protectionVal: Number(protection || 0),
        atkAdj,
        defAdj,
        atkPPAdj,
        defPPAdj,
        atkStateAdj,
        defStateAdj,
        atkBase,
        defBase,
        atkTotal,
        defTotal,
        atkMods,
        defMods,
        atkStateMods,
        defStateMods,
        margin,
        hit,
        damage,
        damageMods,
        pp: {
          attacker: { primes: [], penalites: [] },
          defender: { primes: [], penalites: [] },
          incidents: { attacker: false, defender: false }
        }
      };
    };

    const exchange = makeExchange({
      attackerSide: ownerRole,
      defenderSide: targetRole,
      attackActor,
      defenseActor,
      attackCard: killBill.attack,
      defenseCard: killBill.defense,
      attackSkill,
      attackSkillLabel,
      defenseSkill,
      weaponMod: attackWeapon?.attackMod,
      protection,
      weaponName: attackWeapon?.name
    });

    const applyDamage = async (ex) => {
      if (!ex.hit || ex.damage <= 0) return null;
      try {
        const targetActor = ex.defenderSide === 'attacker' ? attackerActor : defenderActor;
        const targetTokDoc = ex.defenderSide === 'attacker' ? attackerTokDoc : defenderTokDoc;
        return await CombatManager.applyVitalityDamage(targetActor, ex.damage, {
          targetTokDoc,
          sourceLabel: 'Kill Bill',
          attackerActor: ex.attackerSide === 'attacker' ? attackerActor : defenderActor
        });
      } catch (e) {
        console.error('[ARCANE XV][COMBAT][KILL BILL][GM] applyDamage FAILED', e, { exchange: ex });
        return null;
      }
    };

    const applied = await applyDamage(exchange);
    killBill.phase = 'resolved';
    killBill.result = {
      round: Number(killBill.round ?? session.resolved?.result?.round ?? session.lastResolvedRound ?? session.round ?? 1),
      exchange,
      applied: applied ? [applied] : [],
      weapon: attackWeapon
    };

    if (session.resolved?.result) {
      session.resolved.result.killBill = killBill.result;
    }

    console.log('[ARCANE XV][COMBAT][KILL BILL][GM][RESOLVED]', {
      sessionId,
      owner: ownerRole,
      target: targetRole,
      attack: killBill.attack?.id || null,
      defense: killBill.defense?.id || null,
      hit: exchange.hit,
      damage: exchange.damage
    });

    try {
      await CombatManager.#applyCardCycleForRound(session, 'attacker');
      await CombatManager.#applyCardCycleForRound(session, 'defender');
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][KILL BILL][GM] card cycle after round failed', e);
    }

    await CombatManager.#gmBroadcastState(sessionId);

    try {
      await ChatMessage.create({
        content: CombatManager.#killBillChatHtml(session, attackerActor, defenderActor),
        speaker: { alias: "" },
        style: CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
        flags: { arcane15: { customCard: true } }
      });
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][KILL BILL][GM] chat create failed', e);
    }

    if (!session.ended) {
      await CombatManager.#resetRoundState(session);
      session.toast = 'Round terminé : 1 carte repiochée, joker vérifié, round suivant prêt.';
      await CombatManager.#safeInitDecks(attackerActor);
      await CombatManager.#safeInitDecks(defenderActor);
      await CombatManager.#gmBroadcastState(sessionId);
    }
  }

  static #resolveCombatSkill(actor, weapon = null, side = "unknown") {
    const comps = actor?.system?.competences || {};
    const normalizedWeapon = CombatManager.#resolveWeaponForActor(actor, weapon?.weaponKey || null, weapon || null);
    const combatEntries = Object.entries(comps)
      .filter(([key]) => key === "combat" || key.startsWith("combat"))
      .map(([key, s]) => {
        const rawLabels = [
          key,
          s?.label,
          s?.name,
          s?.nom,
          s?.libelle,
          s?.specialite,
          s?.specialiteLabel,
          s?.specialisationLabel,
          s?.subLabel,
          s?.type,
          s?.precision
        ]
          .map(v => String(v ?? "").trim())
          .filter(Boolean);

        const derived = [];
        for (const label of rawLabels) {
          const m = label.match(/combat\s*\(([^)]+)\)/i);
          if (m?.[1]) derived.push(m[1]);
        }

        return {
          key,
          total: Number((s?.specialisation ? Number(s?.val ?? 0) + 2 : Number(s?.val ?? 0)) || 0),
          labels: [...new Set([...rawLabels, ...derived])]
        };
      })
      .map(entry => ({
        ...entry,
        normalized: entry.labels.map(CombatManager.#normalizeSkillText).filter(Boolean)
      }));

    console.log(`[ARCANE XV][COMBAT][SKILL] ${side} weapon input`, {
      actor: actor?.name,
      weaponInput: normalizedWeapon,
      availableCombatSkills: combatEntries.map(x => ({ key: x.key, total: x.total, labels: x.labels }))
    });

    const directKeys = [
      normalizedWeapon?.skillKey,
      normalizedWeapon?.competenceKey,
      normalizedWeapon?.combatSkillKey
    ]
      .map(v => String(v || "").trim())
      .filter(Boolean);

    console.log(`[ARCANE XV][COMBAT][SKILL] ${side} direct key candidates`, { actor: actor?.name, directKeys });

    for (const key of directKeys) {
      const entry = combatEntries.find(x => x.key === key);
      if (!entry) continue;
      const label = String(
        normalizedWeapon?.skillLabel ||
        normalizedWeapon?.competenceLabel ||
        normalizedWeapon?.combatLabel ||
        entry.labels.find(l => CombatManager.#normalizeSkillText(l) !== "combat") ||
        entry.labels[0] ||
        "Combat"
      ).trim() || "Combat";
      console.log(`[ARCANE XV][COMBAT][SKILL] resolved direct candidate`, { actor: actor?.name, side, key, label, value: entry.total });
      return { key, label, value: entry.total };
    }

    const wantedRaw = [
      normalizedWeapon?.skillLabel,
      normalizedWeapon?.competenceLabel,
      normalizedWeapon?.combatLabel,
      normalizedWeapon?.competence,
      normalizedWeapon?.skill,
      normalizedWeapon?.typeCombat
    ]
      .map(v => String(v || "").trim())
      .find(Boolean) || "";

    const wanted = CombatManager.#normalizeSkillText(wantedRaw);
    console.log(`[ARCANE XV][COMBAT][SKILL] ${side} label candidate`, {
      actor: actor?.name,
      wanted: wantedRaw,
      availableCombatSkills: combatEntries.map(x => ({ key: x.key, total: x.total, labels: x.labels }))
    });

    if (wanted) {
      const entry = combatEntries.find(x => x.normalized.some(lbl => lbl === wanted || lbl.includes(wanted) || wanted.includes(lbl)));
      if (entry) {
        const label = String(
          entry.labels.find(l => CombatManager.#normalizeSkillText(l) === wanted) ||
          entry.labels.find(l => CombatManager.#normalizeSkillText(l) !== "combat") ||
          wantedRaw ||
          "Combat"
        ).trim() || "Combat";
        console.log(`[ARCANE XV][COMBAT][SKILL] resolved hinted candidate`, { actor: actor?.name, side, wanted: wantedRaw, key: entry.key, label, value: entry.total });
        return { key: entry.key, label, value: entry.total };
      }
    }

    const generic = comps.combat || null;
    const genericValue = Number(generic?.specialisation ? Number(generic?.val ?? 0) + 2 : Number(generic?.val ?? 0));
    console.warn(`[ARCANE XV][COMBAT][SKILL] fallback generic combat only`, {
      actor: actor?.name,
      side,
      weaponInput: normalizedWeapon,
      availableCombatSkills: combatEntries.map(x => ({ key: x.key, total: x.total, labels: x.labels })),
      genericValue
    });
    return { key: "combat", label: "Combat", value: genericValue || 0 };
  }

  // ---------------------------
  // GM: broadcast views
  // ---------------------------
  static async #gmBroadcastState(sessionId) {
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session) return;

    const attackerUserId = session.attacker.userId;
    const defenderUserIds = session.defender.userIds;
    const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);

    const recipients = new Set();
    if (attackerUserId) recipients.add(attackerUserId);
    for (const id of defenderUserIds) recipients.add(id);
    if (gmUser?.id) recipients.add(gmUser.id);

    for (const userId of recipients) {
      const role = (userId === attackerUserId) ? "attacker"
        : (defenderUserIds.includes(userId) ? "defender" : "gm");
      const view = CombatManager.#buildViewForUser(session, userId, role);
      await CombatManager.#emit({
        type: "axvCombat:state",
        toUserId: userId,
        fromUserId: game.user.id,
        sessionId,
        view
      });
    }
  }

  static #buildViewForUser(session, userId, role) {
    const attackerActor = CombatManager.#actorFromCombatant({ actorId: session.attacker.actorId, tokenId: session.attacker.tokenId, sceneId: session.sceneId });
    const defenderActor = CombatManager.#actorFromCombatant({ actorId: session.defender.actorId, tokenId: session.defender.tokenId, sceneId: session.sceneId });

    let attackerHand = CombatManager.#getHandCards(attackerActor).map(CombatManager.#cardView);
    let defenderHand = CombatManager.#getHandCards(defenderActor).map(CombatManager.#cardView);

    const aPick = session.picks.attacker;
    const dPick = session.picks.defender;
    const killBill = session.killBill || CombatManager.#emptyKillBillState();
    const attackerKillBillPhase = CombatManager.#killBillRolePhase(killBill, "attacker");
    const defenderKillBillPhase = CombatManager.#killBillRolePhase(killBill, "defender");
    const killBillPhaseActive = CombatManager.#isKillBillSelectionPhase(killBill.phase);

    const aSelIds = [aPick.attack, aPick.defense, killBill.owner === "attacker" ? killBill.attack?.id : null, killBill.target === "attacker" ? killBill.defense?.id : null].filter(Boolean);
    const dSelIds = [dPick.attack, dPick.defense, killBill.owner === "defender" ? killBill.attack?.id : null, killBill.target === "defender" ? killBill.defense?.id : null].filter(Boolean);

    const attackerPickedVisible = killBillPhaseActive
      ? {
          attack: killBill.owner === "attacker" ? (killBill.attack || null) : null,
          defense: killBill.target === "attacker" ? (killBill.defense || null) : null
        }
      : {
          attack: aPick.attack ? (attackerHand.find(c => c.id === aPick.attack) || null) : null,
          defense: aPick.defense ? (attackerHand.find(c => c.id === aPick.defense) || null) : null
        };
    const defenderPickedVisible = killBillPhaseActive
      ? {
          attack: killBill.owner === "defender" ? (killBill.attack || null) : null,
          defense: killBill.target === "defender" ? (killBill.defense || null) : null
        }
      : {
          attack: dPick.attack ? (defenderHand.find(c => c.id === dPick.attack) || null) : null,
          defense: dPick.defense ? (defenderHand.find(c => c.id === dPick.defense) || null) : null
        };

    attackerHand = attackerHand.filter(c => !aSelIds.includes(c.id));
    defenderHand = defenderHand.filter(c => !dSelIds.includes(c.id));

    const isGM = (role === "gm");
    const attackerSelf = (role === "attacker");
    const defenderSelf = (role === "defender");
    const revealed = !!session.resolved?.revealed;
    const killBillRevealed = !!killBill.result;
    const backImg = "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png";

    const hidePicked = (card) => {
      if (!card) return null;
      return { ...card, img: backImg, name: "Carte", value: 0, suit: "", isJoker: false, faceImg: null, rawImg: null };
    };

    const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
    const attackerRuntime = attackerActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
    const defenderRuntime = defenderActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
    const attackerAtoutKeys = attackerActor && ArcanaManager?.getCharacterAtouts ? ArcanaManager.getCharacterAtouts(attackerActor).map(a => a.key) : [];
    const defenderAtoutKeys = defenderActor && ArcanaManager?.getCharacterAtouts ? ArcanaManager.getCharacterAtouts(defenderActor).map(a => a.key) : [];
    const attackerHasRemyJulienne = attackerAtoutKeys.includes('remy-julienne');
    const defenderHasRemyJulienne = defenderAtoutKeys.includes('remy-julienne');
    const attackerHasKillBill = attackerAtoutKeys.includes('kill-bill');
    const defenderHasKillBill = defenderAtoutKeys.includes('kill-bill');
    const attackerDestiny = CombatManager.#getDestinyStateForCombat(attackerActor).value;
    const defenderDestiny = CombatManager.#getDestinyStateForCombat(defenderActor).value;
    const attackerFreePrimes = (attackerRuntime?.larnacoeurCombat?.freePrimes && (!attackerRuntime?.larnacoeurCombat?.targetId || String(attackerRuntime.larnacoeurCombat.targetId) === String(defenderActor?.id || ''))) ? Number(attackerRuntime.larnacoeurCombat.freePrimes || 0) : 0;
    const defenderFreePrimes = (defenderRuntime?.larnacoeurCombat?.freePrimes && (!defenderRuntime?.larnacoeurCombat?.targetId || String(defenderRuntime.larnacoeurCombat.targetId) === String(attackerActor?.id || ''))) ? Number(defenderRuntime.larnacoeurCombat.freePrimes || 0) : 0;
    const attackerPaidPrime = (Array.isArray(aPick.penalites) && aPick.penalites.length > 0) ? 1 : 0;
    const defenderPaidPrime = (Array.isArray(dPick.penalites) && dPick.penalites.length > 0) ? 1 : 0;
    const attackerRemyActive = attackerHasRemyJulienne && Array.isArray(aPick.penalites) && aPick.penalites.includes('risque');
    const defenderRemyActive = defenderHasRemyJulienne && Array.isArray(dPick.penalites) && dPick.penalites.includes('risque');
    const attackerAllowedPrimes = attackerPaidPrime + attackerFreePrimes + (attackerRemyActive ? 1 : 0);
    const defenderAllowedPrimes = defenderPaidPrime + defenderFreePrimes + (defenderRemyActive ? 1 : 0);

    const attackerPPContext = {
      hasLarnacoeur: attackerAtoutKeys.includes('larnacoeur'),
      larnState: CombatManager.#getLarnacoeurRoundState(session, 'attacker'),
      otherActor: defenderActor || null
    };

    const defenderPPContext = {
      hasLarnacoeur: defenderAtoutKeys.includes('larnacoeur'),
      larnState: CombatManager.#getLarnacoeurRoundState(session, 'defender'),
      otherActor: attackerActor || null
    };

    const view = {
      sessionId: session.sessionId,
      role,
      round: session.round || 1,
      title: `${session.attacker.name} vs ${session.defender.name}`,
      weapon: session.weapon,
      weapons: {
        attacker: session.attacker.weapon || { name: "Poings", degats: "-3" },
        defender: session.defender.weapon || { name: "Poings", degats: "-3" }
      },
      initiative: session.initiative || null,
      attacker: {
        actorId: session.attacker.actorId,
        name: session.attacker.name,
        sommeMax: Number(attackerActor?.system?.stats?.sommeMax ?? 0),
        restriction: CombatManager.#getRestrictionForRole(session, "attacker"),
        hand: attackerSelf ? attackerHand : [],
        handBackCount: attackerSelf ? 0 : attackerHand.length,
        picked: {
          attack: (attackerSelf || isGM || (killBillPhaseActive && killBill.owner === 'attacker' ? killBillRevealed : revealed)) ? attackerPickedVisible.attack : hidePicked(attackerPickedVisible.attack),
          defense: (attackerSelf || isGM || (killBillPhaseActive && killBill.target === 'attacker' ? killBillRevealed : revealed)) ? attackerPickedVisible.defense : hidePicked(attackerPickedVisible.defense)
        },
        locked: killBillPhaseActive ? !!(killBill.owner === 'attacker' ? killBill.ownerReady : killBill.target === 'attacker' ? killBill.targetReady : aPick.locked) : !!aPick.locked,
        ready: killBillPhaseActive ? !!(killBill.owner === 'attacker' ? killBill.ownerReady : killBill.target === 'attacker' ? killBill.targetReady : aPick.ready) : !!aPick.ready,
        played: CombatManager.#maskPlayed(
          killBillPhaseActive
            ? [
                ...(killBill.owner === 'attacker' && killBill.attack ? [{ ...killBill.attack, zone: 'attack' }] : []),
                ...(killBill.target === 'attacker' && killBill.defense ? [{ ...killBill.defense, zone: 'defense' }] : [])
              ]
            : aPick.played,
          (!attackerSelf && !isGM) && !(killBillPhaseActive ? killBillRevealed : revealed),
          killBillPhaseActive ? killBillRevealed : revealed
        ),
        primes: attackerSelf ? (aPick.primes || []) : [],
        penalites: attackerSelf ? (aPick.penalites || []) : [],
        ppInfo: {
          allowedPrimes: attackerAllowedPrimes,
          remyActive: attackerRemyActive,
          hasRemyJulienne: attackerHasRemyJulienne,
          freePrimes: attackerFreePrimes,
          hasKillBill: attackerHasKillBill,
          killBillAvailable: attackerHasKillBill && attackerDestiny >= 1 && !killBill.armed,
          hasLarnacoeur: attackerPPContext.hasLarnacoeur,
          larnacoeurAvailable: attackerPPContext.hasLarnacoeur && attackerDestiny >= 1 && !attackerPPContext.larnState?.attemptedThisRound && !killBillPhaseActive && !session.resolved?.done,
          larnacoeur: {
            attemptedThisRound: !!attackerPPContext.larnState?.attemptedThisRound,
            success: !!attackerPPContext.larnState?.active,
            freePrimes: Number(attackerPPContext.larnState?.freePrimes || 0),
            targetName: attackerPPContext.larnState?.effect?.targetName || attackerPPContext.otherActor?.name || '',
            round: Number(attackerPPContext.larnState?.effect?.round || 0),
            margin: Number(attackerPPContext.larnState?.effect?.margin || 0)
          },
          destiny: attackerDestiny
        }
      },
      defender: {
        actorId: session.defender.actorId,
        name: session.defender.name,
        sommeMax: Number(defenderActor?.system?.stats?.sommeMax ?? 0),
        restriction: CombatManager.#getRestrictionForRole(session, "defender"),
        hand: defenderSelf ? defenderHand : [],
        handBackCount: defenderSelf ? 0 : defenderHand.length,
        picked: {
          attack: (defenderSelf || isGM || (killBillPhaseActive && killBill.owner === 'defender' ? killBillRevealed : revealed)) ? defenderPickedVisible.attack : hidePicked(defenderPickedVisible.attack),
          defense: (defenderSelf || isGM || (killBillPhaseActive && killBill.target === 'defender' ? killBillRevealed : revealed)) ? defenderPickedVisible.defense : hidePicked(defenderPickedVisible.defense)
        },
        locked: killBillPhaseActive ? !!(killBill.owner === 'defender' ? killBill.ownerReady : killBill.target === 'defender' ? killBill.targetReady : dPick.locked) : !!dPick.locked,
        ready: killBillPhaseActive ? !!(killBill.owner === 'defender' ? killBill.ownerReady : killBill.target === 'defender' ? killBill.targetReady : dPick.ready) : !!dPick.ready,
        played: CombatManager.#maskPlayed(
          killBillPhaseActive
            ? [
                ...(killBill.owner === 'defender' && killBill.attack ? [{ ...killBill.attack, zone: 'attack' }] : []),
                ...(killBill.target === 'defender' && killBill.defense ? [{ ...killBill.defense, zone: 'defense' }] : [])
              ]
            : dPick.played,
          (!defenderSelf && !isGM) && !(killBillPhaseActive ? killBillRevealed : revealed),
          killBillPhaseActive ? killBillRevealed : revealed
        ),
        primes: defenderSelf ? (dPick.primes || []) : [],
        penalites: defenderSelf ? (dPick.penalites || []) : [],
        ppInfo: {
          allowedPrimes: defenderAllowedPrimes,
          remyActive: defenderRemyActive,
          hasRemyJulienne: defenderHasRemyJulienne,
          freePrimes: defenderFreePrimes,
          hasKillBill: defenderHasKillBill,
          killBillAvailable: defenderHasKillBill && defenderDestiny >= 1 && !killBill.armed,
          hasLarnacoeur: defenderPPContext.hasLarnacoeur,
          larnacoeurAvailable: defenderPPContext.hasLarnacoeur && defenderDestiny >= 1 && !defenderPPContext.larnState?.attemptedThisRound && !killBillPhaseActive && !session.resolved?.done,
          larnacoeur: {
            attemptedThisRound: !!defenderPPContext.larnState?.attemptedThisRound,
            success: !!defenderPPContext.larnState?.active,
            freePrimes: Number(defenderPPContext.larnState?.freePrimes || 0),
            targetName: defenderPPContext.larnState?.effect?.targetName || defenderPPContext.otherActor?.name || '',
            round: Number(defenderPPContext.larnState?.effect?.round || 0),
            margin: Number(defenderPPContext.larnState?.effect?.margin || 0)
          },
          destiny: defenderDestiny
        }
      },
      killBill: {
        armed: !!killBill.armed,
        phase: killBill.phase || null,
        attackerPhase: attackerKillBillPhase,
        defenderPhase: defenderKillBillPhase,
        owner: killBill.owner || null,
        target: killBill.target || null,
        phaseActive: killBillPhaseActive,
        attack: killBill.attack || null,
        defense: killBill.defense || null
      },
      pendingRoundAdvance: !!session.pendingRoundAdvance,
      postRoundKillBillPrompt: !!session.postRoundKillBillPrompt,
      resolved: {
        done: !!session.resolved.done,
        revealed: !!session.resolved.revealed,
        result: session.resolved.done ? session.resolved.result : null
      }
    };

    if (killBill.armed) {
      console.log("[ARCANE XV][COMBAT][KILL BILL][VIEW]", {
        sessionId: session.sessionId,
        role,
        attackerPhase: attackerKillBillPhase,
        defenderPhase: defenderKillBillPhase,
        kbAttack: killBill.attack?.id || null,
        kbDefense: killBill.defense?.id || null,
        normalAttacker: { attack: aPick.attack, defense: aPick.defense },
        normalDefender: { attack: dPick.attack, defense: dPick.defense }
      });
    }

    return view;
  }

  static #maskPlayed(played, forceBack, revealed) {

    const backImg = "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png";
    return (played || []).map(p => {
      const masked = { ...p };
      if (forceBack) {
        masked.img = backImg;
        masked.name = "Carte";
        masked.value = 0;
        masked.suit = "";
        masked.isJoker = false;
        masked.faceImg = null;
        masked.rawImg = null;
        // zone is preserved so renderStateInto can place it correctly
      } else if (revealed) {
        // face visible normale
      }
      return masked;
    });
  }

  // ---------------------------
  // Client: open / apply state
  // ---------------------------
  static async #clientOpen(data) {
    const { sessionId, role } = data;

    

    // close initiative dialogs for this session (they should not remain when combat opens)
    try {
      for (const [key, st] of CombatManager.#clientState.entries()) {
        if (!String(key).startsWith("init:")) continue;
        if (!String(key).includes(`:${sessionId}:`)) continue;
        const dlgId = st?.dialogId;
        if (dlgId) {
          const dlg = CombatManager.#clientDialogs.get(dlgId);
          try { dlg?.close?.(); } catch (_) {}
          try { CombatManager.#clientDialogs.delete(dlgId); } catch (_) {}
        }
        try { CombatManager.#clientState.delete(key); } catch (_) {}
      }
    } catch (e) {
      console.warn("[ARCANE XV][INIT][CLIENT] close-on-combat-open failed", e);
    }
// si un dialog existe mais a été fermé : purge
    for (const [id, dlg] of CombatManager.#clientDialogs.entries()) {
      if (!dlg || dlg._state < 0 || dlg.rendered === false) {
        CombatManager.#clientDialogs.delete(id);
      }
    }

    const dialogId = `axv-combat-${sessionId}-${role}`;

    // si déjà ouvert, bring to front
    const existing = CombatManager.#clientDialogs.get(dialogId);
    if (existing) {
      console.log("[ARCANE XV][COMBAT][UI] already opened, bring to front", { sessionId, role, dialogId });
      try { existing.bringToFront?.(); } catch (_) {}
      return;
    }

    console.log("[ARCANE XV][COMBAT][UI] open requested", { sessionId, role, user: game.user?.name });

    const contentEl = CombatManager.#renderDialogShell(dialogId, role);

    const buttons = (() => {
      const out = [];
      if (role === "attacker" || role === "defender") {
        out.push({ action: "ready", label: "Valider mes cartes", default: !game.user?.isGM, callback: () => false });
      }
      if (role === "gm" || game.user?.isGM) {
        out.push({ action: "end", label: "Terminer le combat", default: role === "gm", callback: () => false });
      }
      return out;
    })();

    const dlg = new DialogV2({
      window: { title: `Combat — ${role.toUpperCase()}` },
      content: contentEl,
      rejectClose: true,
      buttons
    });

    // hook close => ignore tant que le MJ n'a pas terminé le combat
    const originalClose = dlg.close.bind(dlg);
    dlg.close = async (...args) => {
      const stateNow = CombatManager.#clientState.get(sessionId);
      if (!stateNow?.allowClose) {
        console.log("[ARCANE XV][COMBAT][UI] close ignored until GM ends combat", { sessionId, role });
        return;
      }
      try {
        CombatManager.#clientDialogs.delete(dialogId);
        CombatManager.#clientState.delete(sessionId);
      } catch (_) {}
      return originalClose(...args);
    };

    await dlg.render({ force: true });

    try {
      const appEl = dlg.element;
      try {
        const width = Math.min(1220, Math.max(1040, window.innerWidth - 24));
        const height = Math.min(window.innerHeight - 2, Math.min(1080, Math.max(900, window.innerHeight + 40)));
        const left = Math.max(8, Math.round((window.innerWidth - width) / 2));
        const top  = Math.max(8, Math.round((window.innerHeight - height) / 2));
        dlg.setPosition?.({ left, top, width, height });
      } catch (_) {}
      try {
        const wc = appEl?.querySelector?.('.window-content');
        if (wc) { wc.style.background = 'rgba(0,0,0,0.92)'; wc.style.backgroundImage = 'none'; wc.style.padding = '2px 2px 0 2px'; wc.style.overflow = 'hidden'; }
      } catch (_) {}
      try {
        const header = appEl?.querySelector?.('.window-header');
        if (header) { header.style.pointerEvents = 'none'; window.setTimeout(() => { try { header.style.pointerEvents = ''; } catch (_) {} }, 180); }
      } catch (_) {}
    } catch (_) {}

    // Pas de ré-injection CSS : content est un HTMLElement, cleanHTML ignoré.

    // On préserve le view déjà reçu (stocké avec dialogId:null) plutôt que de l'écraser par null.
    const prevState = CombatManager.#clientState.get(sessionId);
    const pendingView = prevState?.view ?? null;

    CombatManager.#clientDialogs.set(dialogId, dlg);
    CombatManager.#clientState.set(sessionId, { role, view: pendingView, dialogId, allowClose: false });

    // bind events
    CombatManager.#bindDialogEvents(dlg, { sessionId, role, dialogId });

    // Si un état était déjà en attente, on l'applique immédiatement
    if (pendingView) {
      const pendingRoot = dlg.element?.querySelector?.(`#${dialogId}`);
      if (pendingRoot) {
        CombatManager.#renderStateInto(pendingRoot, pendingView);
        console.log("[ARCANE XV][COMBAT][UI] pending state appliqué à l'ouverture", { sessionId, role });
      }
    }

    console.log("[ARCANE XV][COMBAT][UI] opened", { sessionId, role, dialogId });
  }

  static async #clientApplyState(data) {
    const { sessionId, view } = data;
    const state = CombatManager.#clientState.get(sessionId);
    if (!state) {
      // si state absent, on garde au cas où open arrive après
      CombatManager.#clientState.set(sessionId, { role: view?.role || "attacker", view, dialogId: null, allowClose: false });
      return;
    }
    state.view = { ...(state.view || {}), ...(view || {}) };

    const dialogId = state.dialogId;
    const dlg = dialogId ? CombatManager.#clientDialogs.get(dialogId) : null;

    if (!dlg) {
      // dialog pas ouvert (ou a été fermé)
      return;
    }

    const root = dlg.element?.querySelector?.(`#${dialogId}`);
    if (!root) return;

    CombatManager.#renderStateInto(root, state.view);

    if (view?.toast) ui.notifications?.warn?.(String(view.toast));

    console.log("[ARCANE XV][COMBAT][UI] state applied", { sessionId, role: state.role });
  }

  static async #clientClose(data) {
    const { sessionId, role } = data;
    const dialogId = `axv-combat-${sessionId}-${role}`;
    const dlg = CombatManager.#clientDialogs.get(dialogId);
    if (dlg) {
      const st = CombatManager.#clientState.get(sessionId);
      if (st) st.allowClose = true;
      await dlg.close();
    }
    try {
      CombatManager.#clientDialogs.delete(dialogId);
      CombatManager.#clientState.delete(sessionId);
      for (const [key, st] of CombatManager.#clientState.entries()) {
        if (!String(key).startsWith('init:')) continue;
        if (!String(key).includes(`:${sessionId}:`)) continue;
        const dlgId = st?.dialogId;
        if (dlgId) CombatManager.#clientDialogs.delete(dlgId);
        CombatManager.#clientState.delete(key);
      }
    } catch (_) {}
  }

  // ---------------------------
  // UI Rendering
  // ---------------------------
  static #renderDialogShell(dialogId, role) {
    // CRITIQUE: HTMLElement, pas une string → cleanHTML ne supprime pas les <style>
    const wrap = document.createElement("div");

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      #${dialogId} { font-family:var(--font-primary); color:#eee; }
      #${dialogId} { height:100%; }
      #${dialogId} .axv-wrap { width:min(1160px, calc(100vw - 56px)); max-width:min(1160px, calc(100vw - 56px)); height:100%; display:flex; flex-direction:column; gap:1px; }
      #${dialogId} .axv-head { display:flex; justify-content:space-between; align-items:flex-end; gap:6px; padding:2px 5px; border:1px solid rgba(255,255,255,.18); border-radius:10px; background:#000; }
      #${dialogId} .axv-title { font-weight:900; font-size:23px; }
      #${dialogId} .axv-sub { font-size:18px; opacity:.85; margin-top:0; }
      #${dialogId} .axv-row { display:flex; gap:3px; }
      #${dialogId} .axv-body { flex:1 1 auto; min-height:0; overflow:auto; padding-right:2px; }
      #${dialogId} .axv-col { flex:1; border:none; background:transparent; padding:0; }
      #${dialogId} .axv-col h3 { display:none; }
      #${dialogId} .axv-pill { font-size:19px; font-weight:900; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.35); white-space:nowrap; }
      #${dialogId} .axv-self-block--green { background:linear-gradient(160deg,#1a4a2e,#0d3320); border:1px solid rgba(60,180,90,.35); border-radius:14px; padding:5px; display:flex; flex-direction:column; gap:3px; }
      #${dialogId} .axv-self-block--red   { background:linear-gradient(160deg,#4a1a1a,#331010); border:1px solid rgba(180,60,60,.35); border-radius:14px; padding:5px; display:flex; flex-direction:column; gap:3px; }
      #${dialogId} .axv-block-header { display:flex; justify-content:space-between; align-items:center; }
      #${dialogId} .axv-block-name { font-weight:900; font-size:20px; }
      #${dialogId} .axv-hand-title { display:flex; justify-content:space-between; font-size:18px; font-weight:700; margin-bottom:1px; opacity:.85; }
      #${dialogId} .axv-hand { display:flex; gap:4px; flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden; padding-bottom:1px; }
      #${dialogId} .axv-hand::-webkit-scrollbar { height:4px; }
      #${dialogId} .axv-hand::-webkit-scrollbar-thumb { background:rgba(255,255,255,.2); border-radius:999px; }
      #${dialogId} .axv-card { width:62px; border-radius:8px; overflow:hidden; border:1px solid rgba(0,0,0,.3); background:#111; cursor:grab; user-select:none; flex:0 0 auto; display:flex; flex-direction:column; }
      #${dialogId} .axv-card img { width:100%; height:80px; object-fit:cover; display:block; }
      #${dialogId} .axv-card-meta { padding:2px 4px 2px; background:rgba(0,0,0,.82); border-top:1px solid rgba(255,255,255,.08); }
      #${dialogId} .axv-card-name { font-size:17px; font-weight:800; line-height:1.05; color:#f6e7db; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${dialogId} .axv-card-val { font-size:17px; color:#f8b18a; }
      #${dialogId} .axv-card[aria-disabled="true"] { opacity:.6; cursor:not-allowed; border-color:rgba(214,73,73,.8); }
      #${dialogId} .axv-card.is-disabled .axv-card-meta { background:rgba(42,8,8,.92); }
      #${dialogId} .axv-card.is-restricted { border:2px solid rgba(255,50,50,.85) !important; }
      #${dialogId} .axv-zones { display:flex; gap:4px; }
      #${dialogId} .axv-zone { flex:1; border:2px dashed rgba(255,255,255,.25); border-radius:10px; padding:4px; height:106px; max-height:106px; overflow:hidden; box-sizing:border-box; background:rgba(0,0,0,.2); }
      #${dialogId} .axv-zone.dragover { border-color:rgba(255,255,255,.6); background:rgba(255,255,255,.07); }
      #${dialogId} .axv-zone-title { font-weight:900; font-size:18px; margin-bottom:2px; display:flex; justify-content:space-between; }
      #${dialogId} .axv-zone-slot { display:flex; gap:5px; overflow:hidden; }
      #${dialogId} .axv-mini { font-size:20px; opacity:.78; }
      #${dialogId} .axv-foot { font-size:20px; opacity:.72; }
      #${dialogId} .axv-pp { display:flex; gap:3px; }
      #${dialogId} .axv-pp-box { flex:1; padding:2px 4px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.25); }
      #${dialogId} .axv-pp-box .axv-zone-title { font-size:18px; margin-bottom:0; }
      #${dialogId} .axv-pp-line { display:flex; gap:3px; align-items:center; margin:0; font-size:21px; opacity:.92; line-height:1.1; }
      #${dialogId} .axv-pp-warn { margin-top:0; font-size:21px; font-weight:900; color:#f8b18a; }
      #${dialogId} .axv-result { padding:3px 5px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:#000; font-size:18px; }
      #${dialogId} .axv-result strong { font-weight:900; }
      #${dialogId} .axv-btn { appearance:none; border:1px solid rgba(248,142,85,.9); background:linear-gradient(180deg,rgba(248,142,85,.25),rgba(82,26,21,.65)); color:#fff; border-radius:9px; padding:4px 12px; font-weight:900; font-size:19px; cursor:pointer; }
      #${dialogId} .axv-btn.secondary { border-color:rgba(255,255,255,.2); background:rgba(255,255,255,.06); }
      #${dialogId} .axv-btn:disabled { opacity:.45; cursor:not-allowed; }
      .window-app:has(#${dialogId}) .dialog-buttons,
      .window-app:has(#${dialogId}) footer.window-footer,
      .window-app:has(#${dialogId}) .form-footer {
        display:flex; gap:6px; justify-content:flex-end; align-items:center; margin:1px 0 0 0; padding:4px 8px 8px 8px; background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.5)); border-top:1px solid rgba(255,255,255,.08); flex:0 0 auto;
      }
      .window-app:has(#${dialogId}) .dialog-buttons button,
      .window-app:has(#${dialogId}) footer.window-footer button,
      .window-app:has(#${dialogId}) .form-footer button {
        appearance:none; border:1px solid rgba(248,142,85,.9); background:linear-gradient(180deg,rgba(248,142,85,.25),rgba(82,26,21,.65)); color:#fff; border-radius:9px; padding:4px 12px; font-weight:900; font-size:19px; cursor:pointer; min-height:40px;
      }
      .window-app:has(#${dialogId}) .dialog-buttons button:disabled,
      .window-app:has(#${dialogId}) footer.window-footer button:disabled,
      .window-app:has(#${dialogId}) .form-footer button:disabled { opacity:.45; cursor:not-allowed; }
    `;
    wrap.appendChild(styleEl);

    const inner = document.createElement("div");
    inner.id = dialogId;
    inner.innerHTML = `
      <div class="axv-wrap">
        <div class="axv-head">
          <div>
            <div class="axv-title">Combat</div>
            <div class="axv-sub">Pose secrètement une carte en attaque et une en défense. La somme ne peut pas dépasser la Somme max. Valide ensuite.</div>
          </div>
          <div class="axv-pill">Rôle : ${role.toUpperCase()}</div>
        </div>
        <div class="axv-body"></div>
      </div>
    `;
    wrap.appendChild(inner);
    return wrap;
  }

  static #renderStateInto(root, view) {
    const body = root.querySelector(".axv-body");
    if (!body) return;

    const role = view.role;
    const isGM = role === "gm";
    const you = (role === "attacker") ? view.attacker : (role === "defender" ? view.defender : null);

    const initLine = view.initiative?.winner ? `
      <div class="axv-foot">
        Round <strong>${Number((view.killBill?.armed ? (view.killBill?.round || view.resolved?.result?.round || view.lastResolvedRound || view.round || 1) : (view.round || 1)))}</strong>${view.killBill?.armed ? ` — Kill Bill en cours (même round)` : ` — Initiative : <strong>${CombatManager.#esc(view.initiative.winner === "attacker" ? view.attacker.name : view.defender.name)}</strong>`}
        ${view.initiative?.effect?.label ? ` — ${CombatManager.#esc(view.initiative.effect.label)}` : ``}
      </div>
    ` : ``;

    const weaponLine = `
      <div class="axv-foot">
        ${CombatManager.#esc(view.attacker.name)} : <strong>${CombatManager.#esc(view.weapons?.attacker?.name || "Poings")}</strong> (${CombatManager.#esc(view.weapons?.attacker?.degats || "-3")})
        &nbsp;—&nbsp;
        ${CombatManager.#esc(view.defender.name)} : <strong>${CombatManager.#esc(view.weapons?.defender?.name || "Poings")}</strong> (${CombatManager.#esc(view.weapons?.defender?.degats || "-3")})
      </div>
    `;

    const renderSide = (sideKey, side) => {
      const isSelf = isGM ? true : (you && you.actorId === side.actorId);
      const sommeMax = Number(side.sommeMax ?? 0);
      const hand = side.hand || [];
      const played = side.played || [];
      const backImg = "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png";
      const restriction = side.restriction || {};
      const attackOnlyJokerRule = !!restriction.mustJoker && restriction.scope === "attack";
      const choiceJokerRule = !!restriction.mustJoker && (restriction.scope === "choice" || restriction.scope === "attackOrDefense");
      const killBillRolePhase = sideKey === "attacker" ? view.killBill?.attackerPhase : view.killBill?.defenderPhase;
      const killBillPhaseActive = !!view.killBill?.phaseActive;
      const pickedAttack = played.find(p => p.zone === "attack") || side.picked?.attack || null;
      const pickedDefense = played.find(p => p.zone === "defense") || side.picked?.defense || null;
      const killBillAttackZoneUsed = !killBillPhaseActive || view.killBill?.owner === sideKey;
      const killBillDefenseZoneUsed = !killBillPhaseActive || view.killBill?.target === sideKey;
      const attackZoneHint = killBillRolePhase === 'pick-attack'
        ? '<span style="color:#ffdfb8;font-weight:900;">Kill Bill</span>'
        : (killBillPhaseActive && !killBillAttackZoneUsed)
          ? 'Non utilisée'
          : attackOnlyJokerRule
            ? '<span style="color:#ffdfb8;font-weight:900;">Joker obligatoire</span>'
            : (choiceJokerRule ? '<span style="color:#ffdfb8;font-weight:900;">Joker en attaque ou défense</span>' : '');

      if (!isSelf) {
        const hiddenCard = `
          <div class="axv-card axv-card--back" draggable="false" aria-disabled="true">
            <img src="${backImg}" draggable="false" />
          </div>`;
        const opponentColor = sideKey === "attacker" ? "axv-self-block--red" : "axv-self-block--green";
        return `
        <div class="axv-col axv-col--opponent" data-side="${sideKey}">
          <div class="${opponentColor}">
            <div class="axv-block-header">
              <span class="axv-block-name">${CombatManager.#esc(side.name)}</span>
              <span class="axv-pill">${side.ready ? "VALIDÉ ✓" : (side.locked ? "VERROUILLÉ" : "EN COURS")}</span>
            </div>
            <div class="axv-zones">
              <div class="axv-zone axv-zone--hidden">
                <div class="axv-zone-title"><span>Attaque</span></div>
                <div class="axv-zone-slot">${pickedAttack ? hiddenCard : `<div class="axv-mini">Aucune carte posée</div>`}</div>
              </div>
              <div class="axv-zone axv-zone--hidden">
                <div class="axv-zone-title"><span>Défense</span></div>
                <div class="axv-zone-slot">${pickedDefense ? hiddenCard : `<div class="axv-mini">Aucune carte posée</div>`}</div>
              </div>
            </div>
          </div>
        </div>`;
      }

      const handHtml = `
        <div class="axv-hand-shell">
          <div class="axv-hand-title"><span>Main</span><span class="axv-mini">${hand.length} carte(s)</span></div>
          <div class="axv-hand" data-hand="${sideKey}">
            ${hand.map(c => {
              const stateCtx = { ...view, picks: { [sideKey]: { played: played } }, attacker: view.attacker, defender: view.defender, initiative: view.initiative };
              const hasAttack = !!played.find(p => p.zone === "attack");
              const hasDefense = !!played.find(p => p.zone === "defense");
              let canAttack = false;
              let canDefense = false;
              if (!side.locked) {
                canAttack = CombatManager.#canPlaceCardInZone(stateCtx, sideKey, played, c, "attack").ok;
                canDefense = CombatManager.#canPlaceCardInZone(stateCtx, sideKey, played, c, "defense").ok;
              }
              let playable = false;
              if (!side.locked) {
                if (killBillRolePhase === 'pick-attack') playable = canAttack;
                else if (killBillRolePhase === 'pick-defense') playable = canDefense;
                else if (killBillRolePhase === 'waiting-attack' || killBillRolePhase === 'waiting-defense') playable = false;
                else if (hasAttack && !hasDefense) playable = canDefense;
                else if (!hasAttack && hasDefense) playable = canAttack;
                else playable = canAttack || canDefense;
              }
              const restricted = attackOnlyJokerRule && !c.isJoker && !hasAttack;
              return CombatManager.#cardHtml(c, { draggable: !side.locked && playable, disabled: side.locked || !playable, restricted });
            }).join("")}
          </div>
        </div>`;

      const primesSel = Array.isArray(side.primes) ? side.primes : [];
      const pensSel = Array.isArray(side.penalites) ? side.penalites : [];
      const ppDisabled = (side.locked || killBillPhaseActive) ? "disabled" : "";
      const primesHtml = CombatManager.AXV_PP_PRIMES.map(p => `
        <label class="axv-pp-line"><input type="checkbox" class="axv-pp-check" data-pp-side="${sideKey}" data-pp-kind="prime" data-pp-id="${p.id}" ${primesSel.includes(p.id) ? "checked" : ""} ${ppDisabled}/><span>${CombatManager.#esc(p.label)}</span></label>
      `).join("");
      const pensHtml = CombatManager.AXV_PP_PENALITES.map(p => `
        <label class="axv-pp-line"><input type="checkbox" class="axv-pp-check" data-pp-side="${sideKey}" data-pp-kind="penalite" data-pp-id="${p.id}" ${pensSel.includes(p.id) ? "checked" : ""} ${ppDisabled}/><span>${CombatManager.#esc(p.label)}</span></label>
      `).join("");
      const allowedPrimes = Number(side.ppInfo?.allowedPrimes || 0);
      const remyHeaderBadge = side.ppInfo?.hasRemyJulienne
        ? `<span class="axv-pill" style="background:${side.ppInfo?.remyActive ? '#f3c7c7' : '#e7d3ad'};color:#111;border:1px solid ${side.ppInfo?.remyActive ? '#fecaca' : '#d6b98c'};box-shadow:${side.ppInfo?.remyActive ? '0 0 0 2px rgba(254,202,202,.22)' : 'none'};">Rémy Julienne${side.ppInfo?.remyActive ? ' : disponible' : ''}</span>`
        : "";
      const killBillButton = (isSelf && side.ppInfo?.hasKillBill)
        ? `<button type="button" class="axv-btn axv-action-btn" data-action="killbill" style="padding:5px 12px;font-size:18px;border-color:${side.ppInfo?.killBillAvailable ? '#ffd08a' : 'rgba(255,255,255,.2)'};background:${side.ppInfo?.killBillAvailable ? 'linear-gradient(180deg,rgba(255,196,92,.42),rgba(125,43,16,.92))' : 'rgba(255,255,255,.06)'};box-shadow:${side.ppInfo?.killBillAvailable ? '0 0 0 2px rgba(255,196,92,.28), 0 0 14px rgba(255,140,64,.28)' : 'none'};${side.ppInfo?.killBillAvailable ? '' : 'opacity:.75;'}" ${side.ppInfo?.killBillAvailable ? '' : 'disabled'} title="${side.ppInfo?.killBillAvailable ? "Cliquer pour déclencher l'attaque supplémentaire de Kill Bill" : "Kill Bill indisponible pour ce tour"}">⚔ Kill Bill (-1 Destin)</button>`
        : "";
      const larnacoeurButton = (isSelf && side.ppInfo?.hasLarnacoeur)
        ? `<button type="button" class="axv-btn axv-action-btn" data-action="larnacoeur" style="padding:5px 12px;font-size:18px;border-color:${side.ppInfo?.larnacoeurAvailable ? '#9ec5ff' : 'rgba(255,255,255,.2)'};background:${side.ppInfo?.larnacoeurAvailable ? 'linear-gradient(180deg,rgba(120,172,255,.36),rgba(29,79,145,.92))' : 'rgba(255,255,255,.06)'};box-shadow:${side.ppInfo?.larnacoeurAvailable ? '0 0 0 2px rgba(158,197,255,.25), 0 0 14px rgba(64,128,255,.22)' : 'none'};${side.ppInfo?.larnacoeurAvailable ? '' : 'opacity:.75;'}" ${side.ppInfo?.larnacoeurAvailable ? '' : 'disabled'} title="${side.ppInfo?.larnacoeurAvailable ? "Cliquer pour activer L’arnacoeur pour ce round" : "L’arnacoeur déjà utilisé ou indisponible pour ce round"}">💬 L’arnacoeur (-1 Destin)</button>`
        : "";
      const remyBanner = side.ppInfo?.hasRemyJulienne
        ? `<div class="axv-remy-banner" style="margin:3px 0 4px 0;padding:4px 8px;border-radius:8px;border:1px solid ${side.ppInfo?.remyActive ? '#fca5a5' : '#d4c6a2'};background:${side.ppInfo?.remyActive ? 'rgba(255,235,235,.90)' : 'rgba(255,248,232,.92)'};color:#111;display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <span style="font-size:20px;font-weight:800;line-height:1.15;color:#111;">Atout de personnage — Rémy Julienne disponible</span>
            ${side.ppInfo?.remyActive ? `<span style="padding:2px 7px;border-radius:999px;background:#991b1b;color:#fff;font-weight:800;font-size:10px;white-space:nowrap;">${allowedPrimes} prime(s)</span>` : ''}
          </div>`
        : "";
      const larnacoeurBanner = side.ppInfo?.hasLarnacoeur && side.ppInfo?.larnacoeur?.attemptedThisRound
        ? `<div class="axv-larnacoeur-banner" style="margin:3px 0 4px 0;padding:4px 8px;border-radius:8px;border:1px solid rgba(158,197,255,.65);background:rgba(235,244,255,.96);color:#17355f;display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
            <span style="font-size:20px;font-weight:800;line-height:1.15;color:#17355f;">Atout de personnage — L’arnacoeur ${side.ppInfo?.larnacoeur?.success ? 'activé' : 'raté'}</span>
            <span style="padding:2px 7px;border-radius:999px;background:#1d4f91;color:#fff;font-weight:800;font-size:10px;white-space:nowrap;">${side.ppInfo?.larnacoeur?.success ? `${Number(side.ppInfo?.larnacoeur?.freePrimes || 0)} prime(s) gratuite(s)` : '0 prime gratuite'}</span>
          </div>`
        : "";
      const killBillDefenderNotice = (isSelf && sideKey === 'defender' && (killBillRolePhase === 'waiting-attack' || killBillRolePhase === 'pick-defense' || killBillRolePhase === 'waiting-defense'))
        ? `<div class="axv-kb-defender-notice" style="margin:3px 0 4px 0;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,208,138,.65);background:rgba(255,196,92,.14);color:#ffe7c4;font-size:11px;font-weight:800;line-height:1.2;">${killBillRolePhase === 'waiting-attack' ? "Kill Bill déclenché : l'attaquant prépare une attaque supplémentaire contre toi." : (killBillRolePhase === 'pick-defense' ? "Kill Bill déclenché : choisis maintenant ta carte de défense supplémentaire." : "Kill Bill : ta défense supplémentaire est verrouillée, en attente de résolution.")}</div>`
        : "";
      const freePrimeAllowance = Number(side.ppInfo?.freePrimes || 0);
      const ppWarn = (!side.locked && primesSel.length > freePrimeAllowance && pensSel.length === 0) ? `<div class="axv-pp-warn">Prime payée sélectionnée : choisis au moins une pénalité.</div>` : "";
      const ppCapWarn = (!side.locked && allowedPrimes >= 0 && primesSel.length > allowedPrimes) ? `<div class="axv-pp-warn">Trop de primes sélectionnées : <strong>${allowedPrimes}</strong> autorisée(s) pour ce tour.</div>` : "";

      return `
        <div class="axv-col axv-col--self" data-side="${sideKey}">
          <div class="axv-self-block ${sideKey === "attacker" ? "axv-self-block--red" : "axv-self-block--green"}">
            <div class="axv-block-header">
              <span class="axv-block-name">${CombatManager.#esc(side.name)}</span>
              <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                ${remyHeaderBadge}
                ${larnacoeurButton}
                ${killBillButton}
                <span class="axv-pill">${side.ready ? "VALIDÉ ✓" : (side.locked ? "VERROUILLÉ" : "EN COURS")}</span>
              </div>
            </div>
            ${remyBanner}
            ${larnacoeurBanner}
            ${killBillDefenderNotice}
            ${handHtml}
            <div class="axv-zones">
              <div class="axv-zone" data-zone="${sideKey}:attack">
                <div class="axv-zone-title"><span>Attaque</span><span class="axv-mini">${attackZoneHint}</span></div>
                <div class="axv-zone-slot">${pickedAttack ? CombatManager.#cardHtml(pickedAttack, { draggable: false }) : `<div class="axv-mini">${killBillPhaseActive && !killBillAttackZoneUsed ? "Non utilisée pendant Kill Bill" : (killBillRolePhase === 'pick-attack' ? "Dépose une carte d'attaque supplémentaire" : (attackOnlyJokerRule ? "Dépose un joker" : "Dépose une carte"))}</div>`}</div>
              </div>
              <div class="axv-zone" data-zone="${sideKey}:defense">
                <div class="axv-zone-title"><span>Défense</span><span class="axv-mini">${killBillRolePhase === 'pick-defense' ? 'Kill Bill' : (killBillPhaseActive && !killBillDefenseZoneUsed ? 'Non utilisée' : `Somme max : ${sommeMax}`)}</span></div>
                <div class="axv-zone-slot">${pickedDefense ? CombatManager.#cardHtml(pickedDefense, { draggable: false }) : `<div class="axv-mini">${killBillPhaseActive && !killBillDefenseZoneUsed ? "Non utilisée pendant Kill Bill" : (killBillRolePhase === 'pick-defense' ? "Dépose une carte de défense supplémentaire" : "Dépose une carte")}</div>`}</div>
              </div>
            </div>
            <div class="axv-pp">
              <div class="axv-pp-box"><div class="axv-zone-title"><span>Primes</span><span class="axv-mini">${freePrimeAllowance > 0 ? `(gratuites possibles : ${freePrimeAllowance})` : `(coche)`}</span></div>${primesHtml}</div>
              <div class="axv-pp-box"><div class="axv-zone-title"><span>Pénalités</span><span class="axv-mini">(si prime payée)</span></div>${pensHtml}${ppWarn}${ppCapWarn}</div>
            </div>
          </div>
        </div>`;
    };

    let resultHtml = "";

    const side = role === "attacker" ? view.attacker : (role === "defender" ? view.defender : null);
    // Mettre à jour les boutons natifs DialogV2 dans le footer Foundry
    const appEl = root.closest?.('.window-app, .application, form') || root.parentElement;
    const footer = appEl?.querySelector?.('.dialog-buttons, footer.window-footer, .form-footer');
    if (footer) {
      const readyBtn = footer.querySelector('[data-action="ready"], [data-button="ready"]');
      if (readyBtn && side) {
        const killBillRolePhase = role === 'attacker' ? view.killBill?.attackerPhase : (role === 'defender' ? view.killBill?.defenderPhase : null);
        let disabled = !!side.locked;
        let label = side.locked ? "Cartes validées ✓" : "Valider mes cartes";
        if (killBillRolePhase === 'pick-attack') {
          label = "Valider l'attaque Kill Bill";
          disabled = !!side.locked;
        } else if (killBillRolePhase === 'waiting-attack') {
          label = "En attente de l'attaque Kill Bill";
          disabled = true;
        } else if (killBillRolePhase === 'pick-defense') {
          label = "Valider la défense Kill Bill";
          disabled = !!side.locked;
        } else if (killBillRolePhase === 'waiting-defense') {
          label = "En attente de la défense Kill Bill";
          disabled = true;
        }
        readyBtn.disabled = disabled;
        readyBtn.textContent = label;
      }
      const endBtn = footer.querySelector('[data-action="end"], [data-button="end"]');
      if (endBtn && game.user?.isGM) {
        endBtn.disabled = false;
        endBtn.style.display = '';
        endBtn.textContent = "Terminer le combat";
      }
    }

    const toastHtml = view.toast ? `<div class="axv-result" style="margin-bottom:5px;">${CombatManager.#esc(view.toast)}</div>` : ``;
    const selfKey = role === "attacker" ? "attacker" : (role === "defender" ? "defender" : null);
    const opponentKey = selfKey === "attacker" ? "defender" : (selfKey === "defender" ? "attacker" : null);
    const leftHtml = selfKey ? renderSide(selfKey, view[selfKey]) : renderSide("attacker", view.attacker);
    const rightHtml = opponentKey ? renderSide(opponentKey, view[opponentKey]) : renderSide("defender", view.defender);
    body.innerHTML = `${toastHtml}<div class="axv-row">${leftHtml}${rightHtml}</div>${resultHtml}`;
  }

  static #cardHtml(c, { draggable = true, disabled = false, restricted = false } = {}) {
    const suitFromName = c?.name?.includes(' de ') ? c.name.split(' de ').slice(1).join(' de ') : '';
    const inferredSuit = c.suit || suitFromName;
    const rawName = String(c.name || "Carte");
    const value = Number(c.value ?? 0);
    const isJoker = !!c.isJoker;
    const fallbackImg = CombatManager.#fallbackCardImg({ flags: { arcane15: { value, suit: inferredSuit, isJoker } } });
    const explicitFaceImg = !isJoker ? (c.faceImg || null) : null;
    const candidateImg = explicitFaceImg || c.img || fallbackImg;
    const badImg = /icons\/svg\/|warning|hazard|mystery/i.test(String(candidateImg));
    const looksBack = /dos-cartes\.png|__dos-cartes\.png|card-back|back\.(png|webp|jpg|jpeg)$/i.test(String(candidateImg));
    const safeCandidate = (!isJoker && (badImg || looksBack)) ? (explicitFaceImg || fallbackImg) : (badImg ? (explicitFaceImg || fallbackImg) : candidateImg);
    const img = CombatManager.#esc(safeCandidate);
    const id = CombatManager.#esc(c.id || "");
    const name = CombatManager.#esc(rawName);
    const isBack = /dos-cartes\.png|__dos-cartes\.png|card-back|back\.(png|webp|jpg|jpeg)$/i.test(String(safeCandidate || ""));
    const showText = !isBack && rawName !== "Carte";

    const title = `${name}${isJoker ? " (Joker)" : ""} — ${isJoker ? "Joker" : `Valeur ${value}`}${restricted ? ' — Joker obligatoire en attaque' : ''}`;
    const classes = `axv-card ${disabled ? "is-disabled" : ""} ${restricted ? "is-restricted" : ""}`;

    return `
      <div class="${classes}" draggable="${draggable ? "true" : "false"}" aria-disabled="${disabled ? "true" : "false"}"
           data-card-id="${id}" title="${CombatManager.#esc(title)}">
        <img src="${img}" draggable="false" onerror="if(this.dataset.fallbackTried){this.src='/systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png';this.onerror=null;}else{this.dataset.fallbackTried='1';this.src='${CombatManager.#esc(explicitFaceImg || fallbackImg)}';this.onerror=null;}" />
        ${showText ? `<div class="axv-card-meta"><div class="axv-card-name">${name}</div><div class="axv-card-val">${isJoker ? "Joker" : `Valeur : ${value}`}${restricted ? ' <span style="color:#ff4444;">⛔ ATK</span>' : ''}</div></div>` : ``}
      </div>
    `;
  }

  static #bindDialogEvents(dlg, { sessionId, role, dialogId }) {
    const root = dlg.element?.querySelector?.(`#${dialogId}`);
    if (!root) return;

    const getView = () => CombatManager.#clientState.get(sessionId)?.view;

    // Primes / pénalités (checkbox)
    root.addEventListener("change", async (ev) => {
      const cb = ev.target?.closest?.("input.axv-pp-check");
      if (!cb) return;

      const view = getView();
      if (!view) return;

      const sideKey = cb.dataset.ppSide;
      const kind = cb.dataset.ppKind;
      const id = cb.dataset.ppId;
      const checked = !!cb.checked;

      const allowedSide = (role === "attacker") ? "attacker"
        : (role === "defender") ? "defender"
        : (role === "gm") ? sideKey
        : null;

      if (!allowedSide || sideKey !== allowedSide) {
        cb.checked = !checked;
        return;
      }

      const side = view[sideKey];
      if (!side || side.locked) {
        cb.checked = !checked;
        return;
      }

      if (!Array.isArray(side.primes)) side.primes = [];
      if (!Array.isArray(side.penalites)) side.penalites = [];

      const list = (kind === "prime") ? side.primes : side.penalites;
      if (checked) {
        if (!list.includes(id)) list.push(id);
      } else {
        if (kind === "prime") side.primes = side.primes.filter(x => x !== id);
        if (kind === "penalite") side.penalites = side.penalites.filter(x => x !== id);
      }

      CombatManager.#renderStateInto(root, view);

      console.log("[ARCANE XV][COMBAT][UI] pp -> emit", { sessionId, role, sideKey, kind, id, checked });

      await CombatManager.#emit({
        type: "axvCombat:pp",
        toUserId: CombatManager.#activeGMId(),
        fromUserId: game.user.id,
        sessionId,
        role: (role === "gm" ? sideKey : role),
        kind,
        id,
        checked
      });
    });


    
    // Drag start
    root.addEventListener("dragstart", (ev) => {
  const cardEl = ev.target?.closest?.(".axv-card[data-card-id]");
  if (!cardEl) return;

  const view = getView();
  if (!view) return;

  // Si verrouillé, stop
  let sideKey = (role === "attacker") ? "attacker" : (role === "defender" ? "defender" : null);
  if (role === "gm") {
    const handEl = cardEl.closest?.(".axv-hand[data-hand]");
    sideKey = handEl?.dataset?.hand || null;
  }

  const side = sideKey ? view[sideKey] : null;
  if (!side || side.locked) return ev.preventDefault();

  if (cardEl.getAttribute("aria-disabled") === "true" || cardEl.classList.contains("is-disabled")) return ev.preventDefault();

  const cardId = cardEl.dataset.cardId;

  // IMPORTANT: en mode GM, on envoie role=attacker|defender (pas "gm")
  const payload = JSON.stringify({ sessionId, role: (role === "gm" ? sideKey : role), cardId });

  // fallback si dataTransfer est vide selon navigateur/contexte Foundry
  CombatManager._axvLastDragPayload = payload;

  ev.dataTransfer?.setData("text/plain", payload);
  ev.dataTransfer?.setData("text", payload);
  ev.dataTransfer?.setData("application/json", payload);
  ev.dataTransfer.effectAllowed = "move";

  console.log("[ARCANE XV][COMBAT][UI] dragstart", { sessionId, role, cardId, sideKey });
    });


    // Drag over / drop zones
    root.addEventListener("dragover", (ev) => {
      const zone = ev.target?.closest?.(".axv-zone[data-zone]");
      if (!zone) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      zone.classList.add("dragover");
    });

    root.addEventListener("dragleave", (ev) => {
      const zone = ev.target?.closest?.(".axv-zone[data-zone]");
      if (!zone) return;
      zone.classList.remove("dragover");
    });

    root.addEventListener("drop", async (ev) => {
      const zone = ev.target?.closest?.(".axv-zone[data-zone]");
      if (!zone) return;

      ev.preventDefault();
      zone.classList.remove("dragover");

      const payload =
  ev.dataTransfer?.getData("text/plain") ||
  ev.dataTransfer?.getData("text") ||
  ev.dataTransfer?.getData("application/json") ||
  CombatManager._axvLastDragPayload;

if (!payload) return;


      let parsed = null;
      try { parsed = JSON.parse(payload); } catch (_) {}
      if (!parsed?.cardId) return;

      const view = getView();
      if (!view) return;

      // zone format: "attacker:attack" etc
      const z = zone.dataset.zone;
      const [sideKey, zoneKey] = String(z).split(":");

      // seuls les zones de ton rôle sont droppables
      const allowedSide = (role === "attacker") ? "attacker"
                  : (role === "defender") ? "defender"
                  : (role === "gm") ? sideKey
                  : null;

if (!allowedSide || sideKey !== allowedSide) return;


      // update UI locale immédiate (optimiste)
      // on met la carte dans played (affichage), et on la retire de la main locale
      const side = view[sideKey];
      if (side.locked) return;

      const card = side.hand.find(c => c.id === parsed.cardId);
      if (!card) return;

      const optimisticPlayed = (side.played || []).filter(p => p.zone !== zoneKey && p.id !== parsed.cardId);
      const localCheck = CombatManager.#canPlaceCardInZone({
        initiative: view.initiative,
        attacker: view.attacker,
        defender: view.defender,
        picks: {
          attacker: { attack: view.attacker?.picked?.attack?.id || null, defense: view.attacker?.picked?.defense?.id || null },
          defender: { attack: view.defender?.picked?.attack?.id || null, defense: view.defender?.picked?.defense?.id || null }
        },
        killBill: view.killBill || null
      }, sideKey, optimisticPlayed, card, zoneKey);
      if (!localCheck.ok) {
        ui.notifications?.warn?.(localCheck.toast || "Carte non jouable.");
        return;
      }

      // retirer de la main locale
      side.hand = side.hand.filter(c => c.id !== parsed.cardId);

      // remplacer ancienne carte zone si existante => la remettre en main
      const existing = (side.played || []).find(p => p.zone === zoneKey);
      side.played = (side.played || []).filter(p => p.zone !== zoneKey);
      if (existing) side.hand.unshift(existing);

      side.played.push({ ...card, zone: zoneKey });

      CombatManager.#renderStateInto(root, view);

      console.log("[ARCANE XV][COMBAT][UI] drop -> emit pick", { sessionId, role, zone: zoneKey, sideKey, cardId: parsed.cardId });

      await CombatManager.#emit({
        type: "axvCombat:pick",
        toUserId: CombatManager.#activeGMId(),
        fromUserId: game.user.id,
        sessionId,
        role: (role === "gm" ? sideKey : role),
        zone: zoneKey,
        cardId: parsed.cardId
      });
    });

    // click sur carte jouée => retirer (si pas verrouillé)
    root.addEventListener("click", async (ev) => {
      const cardEl = ev.target?.closest?.(".axv-zone .axv-card[data-card-id]");
      if (!cardEl) return;

      const view = getView();
      if (!view) return;

      let sideKey = (role === "attacker") ? "attacker" : (role === "defender" ? "defender" : null);
      if (!sideKey) return;
      const side = view[sideKey];
      if (side.locked) return;

      // identifier la zone
      const zoneEl = ev.target?.closest?.(".axv-zone[data-zone]");
      const z = zoneEl?.dataset?.zone || "";
      const [_side, zoneKey] = String(z).split(":");
      if (role === "gm") sideKey = _side;
      if (_side !== sideKey || (zoneKey !== "attack" && zoneKey !== "defense")) return;

      // remettre en main
      const played = (side.played || []).find(p => p.zone === zoneKey);
      if (!played) return;

      side.played = (side.played || []).filter(p => p.zone !== zoneKey);
      side.hand.unshift({ ...played });
      CombatManager.#renderStateInto(root, view);

      console.log("[ARCANE XV][COMBAT][UI] unpick -> emit", { sessionId, role, zone: zoneKey });

      await CombatManager.#emit({
        type: "axvCombat:unpick",
        toUserId: CombatManager.#activeGMId(),
        fromUserId: game.user.id,
        sessionId,
        role: (role === "gm" ? sideKey : role),
        zone: zoneKey
      });
    });

    // Buttons actions
    // DialogV2 button callbacks are internal; we use "submit" hook via rendered footer buttons:
    // Instead: we listen to window footer buttons via DOM query.
    const runAction = async (action) => {
      if (action === "ready") {
        const stateNow = getView();
        console.log("[ARCANE XV][COMBAT][KILL BILL][CLIENT][READY]", {
          sessionId,
          role,
          killBillPhase: role === 'attacker' ? stateNow?.killBill?.attackerPhase : stateNow?.killBill?.defenderPhase,
          bonusCard: role === stateNow?.killBill?.owner ? stateNow?.killBill?.attack?.id || null : stateNow?.killBill?.defense?.id || null,
          normalAttack: stateNow?.[role]?.picked?.attack?.id || null,
          normalDefense: stateNow?.[role]?.picked?.defense?.id || null
        });
        console.log("[ARCANE XV][COMBAT][UI] ready clicked", { sessionId, role });
        await CombatManager.#emit({
          type: "axvCombat:ready",
          toUserId: CombatManager.#activeGMId(),
          fromUserId: game.user.id,
          sessionId,
          role
        });
      }
      if (action === "killbill") {
        await CombatManager.#emit({
          type: "axvCombat:killBill",
          toUserId: CombatManager.#activeGMId(),
          fromUserId: game.user.id,
          sessionId,
          role
        });
      }
      if (action === "larnacoeur") {
        await CombatManager.#emit({
          type: "axvCombat:larnacoeur",
          toUserId: CombatManager.#activeGMId(),
          fromUserId: game.user.id,
          sessionId,
          role
        });
      }
      if (action === "end") {
        console.log("[ARCANE XV][COMBAT][UI] end clicked", { sessionId, role });
        await CombatManager.#emit({
          type: "axvCombat:end",
          toUserId: CombatManager.#activeGMId(),
          fromUserId: game.user.id,
          sessionId
        });
      }
    };

    root.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.('.axv-action-btn');
      if (!btn) return;
      ev.preventDefault();
      if (btn.disabled) return;
      await runAction(btn.dataset.action);
    });

    const ensureNativeFooterButtons = () => {
      const appEl = dlg.element;
      if (!appEl) return null;
      let footer = appEl.querySelector?.(".dialog-buttons, footer.window-footer, .form-footer");
      if (!footer) {
        const windowContent = appEl.querySelector?.('.window-content') || appEl;
        footer = document.createElement('nav');
        footer.className = 'dialog-buttons';
        footer.style.display = 'flex';
        footer.style.gap = '6px';
        footer.style.justifyContent = 'flex-end';
        footer.style.alignItems = 'center';
        footer.style.margin = '1px 0 0 0';
        footer.style.padding = '4px 8px 8px 8px';
        footer.style.background = 'linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.5))';
        footer.style.borderTop = '1px solid rgba(255,255,255,.08)';
        footer.style.flex = '0 0 auto';
        windowContent.appendChild(footer);
      }
      const ensureButton = (action, label, isDefault = false) => {
        let btn = footer.querySelector(`[data-action="${action}"], [data-button="${action}"]`);
        if (btn) return btn;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.action = action;
        btn.dataset.button = action;
        btn.textContent = label;
        if (isDefault) btn.classList.add('default');
        footer.appendChild(btn);
        return btn;
      };
      if (role === 'attacker' || role === 'defender') {
        ensureButton('ready', 'Valider mes cartes', !game.user?.isGM);
      }
      if (role === 'gm' || game.user?.isGM) {
        ensureButton('end', 'Terminer le combat', role === 'gm');
      }
      return footer;
    };

    const hookButtons = () => {
      const footer = ensureNativeFooterButtons();
      if (!footer) return;
      if (footer.dataset.axvBound === '1') return;
      footer.dataset.axvBound = '1';
      footer.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button");
        if (!btn) return;
        const action = btn.dataset?.button || btn.dataset?.action;
        if (!action) return;
        await runAction(action);
      }, true);
    };

    ensureNativeFooterButtons();
    hookButtons();
  }

  static async #gmEndSession(data) {
    const { sessionId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session) return;
    session.ended = true;
    try { await CombatManager.#deactivateCombatScene(session); } catch (e) { console.warn('[ARCANE XV][COMBAT][GM] deactivate combat scene failed', e); }
    try {
      const attackerWorldActor = game.actors.get(session.attacker.actorId);
      const defenderWorldActor = game.actors.get(session.defender.actorId);
      const attackerTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.attacker.tokenId);
      const defenderTokDoc = CombatManager.#tokenDocFrom(session.sceneId, session.defender.tokenId);
      const attackerTokenActor = attackerTokDoc?.actor || null;
      const defenderTokenActor = defenderTokDoc?.actor || null;
      const extraActors = [];
      for (const actorId of [session.attacker.actorId, session.defender.actorId]) {
        const base = game.actors.get(actorId);
        if (base) extraActors.push(base, ...(base.getActiveTokens?.().map(t => t.actor).filter(Boolean) || []));
      }
      for (const actor of [attackerWorldActor, defenderWorldActor, attackerTokenActor, defenderTokenActor, ...extraActors]) {
        try { await actor?.unsetFlag?.("arcane15", "lastInitiativeCombat"); } catch (_) {}
        try {
          const runtime = foundry.utils.deepClone(actor?.getFlag?.('arcane15', 'arcanaRuntime') || {});
          if (runtime?.larnacoeurCombat?.sessionId && String(runtime.larnacoeurCombat.sessionId) === String(sessionId)) {
            delete runtime.larnacoeurCombat;
            await actor?.setFlag?.('arcane15', 'arcanaRuntime', runtime);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn("[ARCANE XV][COMBAT][GM] clear lastInitiativeCombat failed", e);
    }
    try { CombatManager.#gmInitSessions.delete(sessionId); } catch (_) {}
    const recipients = new Set();
    if (session.attacker.userId) recipients.add(session.attacker.userId);
    for (const id of (session.defender.userIds || [])) recipients.add(id);
    const gmUser = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
    if (gmUser?.id) recipients.add(gmUser.id);
    for (const userId of recipients) {
      const role = (userId === session.attacker.userId) ? "attacker" : ((session.defender.userIds || []).includes(userId) ? "defender" : "gm");
      await CombatManager.#emit({ type: "axvCombat:close", toUserId: userId, fromUserId: game.user.id, sessionId, role });
    }
    CombatManager.#gmSessions.delete(sessionId);
  }

  static getSceneContext(sceneId = canvas.scene?.id) {
    const sceneDoc = game.scenes?.get?.(sceneId) ?? (canvas.scene?.id === sceneId ? canvas.scene : null);
    if (!sceneDoc) return null;
    const combatScene = sceneDoc.getFlag?.('arcane15', 'combatScene') || null;
    if (combatScene?.active && combatScene?.ref) {
      return {
        type: 'combat',
        active: true,
        sceneId: sceneDoc.id,
        ref: String(combatScene.ref),
        label: combatScene.label || 'Combat',
        sessionId: combatScene.sessionId || null,
        startedAt: Number(combatScene.startedAt || 0) || 0
      };
    }
    return null;
  }

  static async #activateCombatScene(session) {
    if (!game.user?.isGM || !session?.sceneId || !session?.sessionId) return;
    const sceneDoc = game.scenes?.get?.(session.sceneId) ?? (canvas.scene?.id === session.sceneId ? canvas.scene : null);
    if (!sceneDoc) return;
    const previousStory = sceneDoc.getFlag?.('arcane15', 'storyScene') || null;
    if (previousStory?.active && previousStory?.ref) {
      try { await sceneDoc.unsetFlag('arcane15', 'storyScene'); } catch (_) { await sceneDoc.setFlag('arcane15', 'storyScene', { active: false }); }
      try { await (globalThis.AXVArcanaManager || game.arcane15?.arcana || game.arcane15?.ArcanaManager)?.clearSceneScopedBonuses?.(previousStory.ref); } catch (_) {}
    }
    await sceneDoc.setFlag('arcane15', 'combatScene', {
      active: true,
      ref: `combat:${session.sessionId}`,
      label: `Combat — ${session.attacker?.name || 'Attaquant'} vs ${session.defender?.name || 'Défenseur'}`,
      startedAt: Date.now(),
      sessionId: session.sessionId
    });
  }

  static async #deactivateCombatScene(session) {
    if (!game.user?.isGM || !session?.sceneId || !session?.sessionId) return;
    const sceneDoc = game.scenes?.get?.(session.sceneId) ?? (canvas.scene?.id === session.sceneId ? canvas.scene : null);
    if (!sceneDoc) return;
    const current = sceneDoc.getFlag?.('arcane15', 'combatScene') || null;
    try { await sceneDoc.unsetFlag('arcane15', 'combatScene'); } catch (_) { await sceneDoc.setFlag('arcane15', 'combatScene', { active: false }); }
    try {
      const ref = current?.ref || `combat:${session.sessionId}`;
      await (globalThis.AXVArcanaManager || game.arcane15?.arcana || game.arcane15?.ArcanaManager)?.clearSceneScopedBonuses?.(ref);
    } catch (_) {}
  }

  static #activeGMId() {
    const gm = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
    return gm?.id || null;
  }

  static async #clientOpenDestinyPrompt(data) {
    const { promptId, actorName, damage, sourceLabel = '', gmUserId = null } = data || {};
    const accepted = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(!!value);
      };
      const dlg = new DialogV2({
        window: { title: 'Annuler les dégâts ?' },
        content: `
          <div style="padding:10px 12px; line-height:1.5;">
            <p><strong>${CombatManager.#esc(actorName || 'Personnage')}</strong> vient de subir <strong>${Number(damage || 0)}</strong> point${Number(damage || 0) > 1 ? 's' : ''} de dégât${Number(damage || 0) > 1 ? 's' : ''}${sourceLabel ? ` (${CombatManager.#esc(sourceLabel)})` : ''}.</p>
            <p>Dépenser <strong>2 points de Destin</strong> pour annuler complètement ces dégâts ?</p>
          </div>`,
        buttons: [
          { action: 'no', label: 'Garder les dégâts', default: true, callback: () => finish(false) },
          { action: 'yes', label: 'Annuler les dégâts (-2 Destin)', callback: () => finish(true) }
        ]
      });
      const originalClose = dlg.close.bind(dlg);
      dlg.close = async (...args) => {
        finish(false);
        return originalClose(...args);
      };
      dlg.render({ force: true });
    });

    await CombatManager.#emit({
      type: 'axvCombat:destinyPromptResult',
      toUserId: gmUserId || CombatManager.#activeGMId(),
      fromUserId: game.user.id,
      promptId,
      accepted
    });
  }

  static async #gmReceiveDestinyPromptResult(data) {
    const { promptId, accepted = false } = data || {};
    const pending = promptId ? CombatManager.#pendingDestinyPrompts.get(promptId) : null;
    if (!pending) return;
    try {
      pending.resolve(!!accepted);
    } finally {
      CombatManager.#pendingDestinyPrompts.delete(promptId);
    }
  }

  // ---------------------------
  // Utils
  // ---------------------------

  /**
   * Chat scrolling is left entirely to Foundry native behavior.
   */

  /**
   * Safe wrapper for CardManager.initActorDecks.
   * If the deck is empty (no cards to draw), attempt to recycle the discard pile,
   * then retry once. Never throws — logs and continues gracefully.
   */
  static async #safeInitDecks(actor) {
    if (!actor) return;
    try {
      await CardManager.initActorDecks(actor);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (msg.includes("not") && msg.includes("available") && msg.includes("remaining")) {
        console.warn(`[ARCANE XV][COMBAT] deck empty for ${actor?.name}, attempting recycle…`);
        try {
          // Try to recycle discard pile back into deck
          const deckId = actor.getFlag("arcane15", "deck");
          const discardId = actor.getFlag("arcane15", "pile");
          const deck = deckId ? game.cards.get(deckId) : null;
          const discard = discardId ? game.cards.get(discardId) : null;

          if (discard && deck && discard.cards?.size > 0) {
            // Move all non-joker cards from discard back to deck
            const cardIds = discard.cards.contents.filter(c => !c?.flags?.arcane15?.isJoker).map(c => c.id);
            await discard.pass(deck, cardIds, { chatNotification: false });
            await deck.shuffle();
            console.log(`[ARCANE XV][COMBAT] recycled ${cardIds.length} cards from discard to deck for ${actor?.name}`);

            // Retry initActorDecks
            try {
              await CardManager.initActorDecks(actor);
              console.log(`[ARCANE XV][COMBAT] initActorDecks succeeded after recycle for ${actor?.name}`);
            } catch (e2) {
              console.error(`[ARCANE XV][COMBAT] initActorDecks still failed after recycle for ${actor?.name}`, e2);
            }
          } else {
            console.warn(`[ARCANE XV][COMBAT] no discard pile to recycle for ${actor?.name} (deck: ${!!deck}, discard: ${!!discard}, discardSize: ${discard?.cards?.size ?? 0})`);
            // Try CardManager.recycleDeck if it exists
            if (typeof CardManager.recycleDeck === "function") {
              try {
                await CardManager.recycleDeck(actor);
                await CardManager.initActorDecks(actor);
                console.log(`[ARCANE XV][COMBAT] CardManager.recycleDeck succeeded for ${actor?.name}`);
              } catch (e3) {
                console.error(`[ARCANE XV][COMBAT] recycleDeck failed for ${actor?.name}`, e3);
              }
            }
          }
        } catch (recycleErr) {
          console.error(`[ARCANE XV][COMBAT] recycle attempt failed for ${actor?.name}`, recycleErr);
        }
      } else {
        console.error(`[ARCANE XV][COMBAT] initActorDecks failed for ${actor?.name}`, e);
      }
    }
  }

  static #parseSignedInt(s) {
    const m = String(s || "").trim().match(/^([+-]?\d+)/);
    return m ? Number(m[1]) : 0;
  }

  static #esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  static #tokenImgForActor(actor) {
    return String(actor?.prototypeToken?.texture?.src || actor?.img || "icons/svg/mystery-man.svg");
  }

  static #chatCardImg(card) {
    const suit = card?.suit || (typeof card?.name === "string" && card.name.includes(" de ") ? card.name.split(" de ").slice(1).join(" de ") : "");
    return String(
      card?.img
      || card?.faceImg
      || CombatManager.#fallbackCardImg({ flags: { arcane15: { value: card?.value, suit, isJoker: card?.isJoker } } })
    );
  }

  static #chatActorBadge(label, actor, tone = "#8a5") {
    const img = CombatManager.#esc(CombatManager.#tokenImgForActor(actor));
    return `
      <div style="display:flex;align-items:center;gap:6px;min-width:0;">
        <img draggable="false" src="${img}" style="width:22px;height:22px;border-radius:999px;object-fit:cover;border:2px solid ${tone};background:#111;flex:0 0 auto;" onerror="this.src='icons/svg/mystery-man.svg';this.onerror=null;"/>
        <div style="font-weight:900;font-size:12px;color:${tone};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${CombatManager.#esc(label)}</div>
      </div>`;
  }


  static async applyVitalityHealing(targetActor, amount, { targetTokDoc = null, sourceLabel = "" } = {}) {
    const heal = Math.max(0, Number(amount ?? 0));
    if (!targetActor || heal <= 0) return null;

    const docActor = targetTokDoc?.actor ?? targetActor;
    const beforeVit = Number(docActor?.system?.stats?.vitalite ?? 0);
    const maxVitRaw = Number(docActor?.system?.stats?.vitaliteMax ?? 0);
    const afterVit = maxVitRaw > 0 ? Math.min(maxVitRaw, beforeVit + heal) : (beforeVit + heal);
    const healed = Math.max(0, afterVit - beforeVit);

    const updates = {
      "system.stats.vitalite": afterVit
    };

    if (afterVit > 0) {
      updates["system.stats.malEnPoint"] = false;
      updates["system.stats.blessures"] = 0;
      updates["system.stats.dangerMort"] = false;
      updates["system.stats.dangerMortRounds"] = 0;
      updates["system.stats.inconscient"] = false;
      updates["system.stats.inconscientRounds"] = 0;
      updates["system.stats.mort"] = false;
    }

    await docActor.update(updates, { axvVitalitySync: true });
    try {
      await docActor.setFlag("arcane15", "malEnPoint", false);
      await docActor.setFlag("arcane15", "lastDamage", 0);
    } catch (_) {}

    return {
      target: docActor.name,
      sourceLabel,
      beforeVit,
      afterVit,
      healed,
      updates
    };
  }

  static async applyVitalityDamage(targetActor, amount, { targetTokDoc = null, sourceLabel = "", attackerActor = null, allowDestinyCancel = true } = {}) {
    const damage = Math.max(0, Number(amount ?? 0));
    if (!targetActor || damage <= 0) return null;

    const docActor = targetTokDoc?.actor ?? targetActor;
    const beforeVit = Number(docActor?.system?.stats?.vitalite ?? 0);
    const beforeBless = Number(docActor?.system?.stats?.blessures ?? 0);
    const beforeMaxVit = Number(docActor?.system?.stats?.vitaliteMax ?? 0);
    const beforeDanger = !!docActor?.system?.stats?.dangerMort;
    const beforeInconscient = !!docActor?.system?.stats?.inconscient;

    if (allowDestinyCancel !== false && !docActor?.system?.stats?.mort && docActor?.type === "personnage" && damage > 0) {
      const destinRaw = docActor?.system?.stats?.destin;
      let destinValue = Number(destinRaw ?? 0);
      let destinPath = "system.stats.destin";
      if (destinRaw && typeof destinRaw === "object") {
        if (destinRaw.value != null) {
          destinValue = Number(destinRaw.value ?? 0);
          destinPath = "system.stats.destin.value";
        } else if (destinRaw.current != null) {
          destinValue = Number(destinRaw.current ?? 0);
          destinPath = "system.stats.destin.current";
        } else if (destinRaw.actuel != null) {
          destinValue = Number(destinRaw.actuel ?? 0);
          destinPath = "system.stats.destin.actuel";
        }
      }

      if (destinValue >= 2) {
        let shouldCancelDamage = false;
        const ownerUsers = CombatManager.#resolveOwnerUsersForActor(docActor) || [];
        const ownerPlayer = ownerUsers.find(u => u.active && !u.isGM) || null;
        if (ownerPlayer && ownerPlayer.id !== game.user.id) {
          const promptId = foundry.utils.randomID(16);
          shouldCancelDamage = await new Promise((resolve) => {
            const timeout = window.setTimeout(() => {
              try { CombatManager.#pendingDestinyPrompts.delete(promptId); } catch (_) {}
              resolve(false);
            }, 120000);
            CombatManager.#pendingDestinyPrompts.set(promptId, {
              resolve: (value) => {
                try { window.clearTimeout(timeout); } catch (_) {}
                resolve(!!value);
              }
            });
            CombatManager.#emit({
              type: 'axvCombat:destinyPrompt',
              toUserId: ownerPlayer.id,
              fromUserId: game.user.id,
              gmUserId: CombatManager.#activeGMId(),
              promptId,
              actorName: docActor.name,
              damage,
              sourceLabel
            }).catch((error) => {
              console.warn('[ARCANE XV][COMBAT] destiny prompt emit failed', error);
              try { window.clearTimeout(timeout); } catch (_) {}
              CombatManager.#pendingDestinyPrompts.delete(promptId);
              resolve(false);
            });
          });
        } else {
          shouldCancelDamage = await new Promise((resolve) => {
            const dlg = new DialogV2({
              window: { title: "Annuler les dégâts ?" },
              content: `
                <div style="padding:10px 12px; line-height:1.5;">
                  <p><strong>${CombatManager.#esc(docActor.name)}</strong> vient de subir <strong>${damage}</strong> point${damage > 1 ? "s" : ""} de dégât${damage > 1 ? "s" : ""}${sourceLabel ? ` (${CombatManager.#esc(sourceLabel)})` : ""}.</p>
                  <p>Dépenser <strong>2 points de Destin</strong> pour annuler complètement ces dégâts ?</p>
                </div>`,
              buttons: [
                { action: "no", label: "Garder les dégâts", default: true, callback: () => resolve(false) },
                { action: "yes", label: "Annuler les dégâts (-2 Destin)", callback: () => resolve(true) }
              ]
            });
            dlg.render({ force: true });
          });
        }

        if (shouldCancelDamage) {
          await docActor.update({ [destinPath]: Math.max(0, destinValue - 2) }, { axvVitalitySync: true });
          return {
            target: docActor?.name,
            sourceLabel,
            attackerActorId: attackerActor?.id ?? null,
            beforeVit,
            beforeBless,
            afterVit: beforeVit,
            afterBless: beforeBless,
            updates: {},
            damage: 0,
            canceledDamage: damage,
            kind: "destin_cancel",
            statusNotes: [],
            critical: null
          };
        }
      }
    }

    const updates = {};
    if (beforeMaxVit <= 0 && beforeVit > 0) updates["system.stats.vitaliteMax"] = beforeVit;

    let kind = "none";
    const statusNotes = [];

    if (beforeVit > 0) {
      const afterVit = Math.max(0, beforeVit - damage);
      updates["system.stats.vitalite"] = afterVit;
      kind = "vitalite";
      if (afterVit === 0) {
        updates["system.stats.malEnPoint"] = true;
        updates["system.stats.blessures"] = 0;
        updates["system.stats.mort"] = false;
        updates["system.stats.dangerMort"] = false;
        updates["system.stats.dangerMortRounds"] = 0;
        updates["system.stats.inconscient"] = false;
        updates["system.stats.inconscientRounds"] = 0;
        kind = "vitalite_to_zero";
        statusNotes.push(`${docActor.name} est mal en point.`);
      }
    } else {
      updates["system.stats.vitalite"] = 0;
      updates["system.stats.malEnPoint"] = true;
      updates["system.stats.blessures"] = beforeBless + 1;
      kind = "blessure";
      statusNotes.push(`${docActor.name} subit une blessure critique (${beforeBless + 1}).`);
    }

    await docActor.update(updates, { axvVitalitySync: true });
    try {
      await docActor.setFlag("arcane15", "malEnPoint", !!(updates["system.stats.malEnPoint"] ?? docActor?.system?.stats?.malEnPoint ?? false));
      await docActor.setFlag("arcane15", "lastDamage", damage);
    } catch (_) {}

    const updatedActor = targetTokDoc?.actor ?? targetActor;
    const afterVit = Number(updatedActor?.system?.stats?.vitalite ?? updates["system.stats.vitalite"] ?? beforeVit);
    const afterBless = Number(updatedActor?.system?.stats?.blessures ?? updates["system.stats.blessures"] ?? beforeBless);
    const needsCriticalTests = (beforeVit > 0 && afterVit === 0) || beforeVit <= 0;

    let critical = null;

    if (needsCriticalTests && !updatedActor?.system?.stats?.mort) {
      const ArcanaManager = globalThis.AXVArcanaManager || game.arcane15?.ArcanaManager || null;
      const criticalMalus = afterBless > 0 ? (-2 * afterBless) : 0;
      const difficulty = 8 + damage;
      const criticalContext = beforeVit > 0
        ? `${CombatManager.#esc(updatedActor.name)} tombe à <strong>0 Vitalité</strong> après avoir subi <strong>${damage} dégât${damage > 1 ? "s" : ""}</strong>${sourceLabel ? ` (${CombatManager.#esc(sourceLabel)})` : ""}.`
        : `${CombatManager.#esc(updatedActor.name)} subit une <strong>nouvelle blessure</strong> alors qu'il est déjà <strong>mal en point</strong>.`;
      let resistanceResult = null;
      let volonteResult = null;

      await ChatMessage.create({
        whisper: game.users?.filter?.(u => u.isGM)?.map?.(u => u.id) ?? [],
        blind: true,
        speaker: ChatMessage.getSpeaker({ actor: updatedActor }),
        content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>Tests critiques déclenchés</strong><br>${criticalContext}<br><br><strong>Le joueur concerné choisit une carte de sa main pour chaque jet.</strong><br><br><strong>Pourquoi ces jets ?</strong><br>• <strong>Résistance / ${difficulty}</strong> : pour éviter le <strong>danger de mort</strong>.<br>• <strong>Volonté / ${difficulty}</strong> : pour éviter l'<strong>inconscience</strong>.${criticalMalus ? `<br>• Malus blessures en cours : <strong>${criticalMalus}</strong>.` : ""}</div></div>`
      });

      if (ArcanaManager?.rollFixedSkill) {
        resistanceResult = await ArcanaManager.rollFixedSkill(updatedActor, "resistance", {
          title: `${updatedActor.name} — Test critique`,
          subtitle: `Résistance / ${difficulty} — éviter le danger de mort`,
          difficulty,
          bonus: criticalMalus,
          chatTitle: `${updatedActor.name} — Résistance critique`,
          chatNote: `Cause : ${beforeVit > 0 ? "chute à 0 Vitalité" : "blessure supplémentaire à 0 Vitalité"}${sourceLabel ? ` • Source : ${sourceLabel}` : ""}${criticalMalus ? ` • Malus blessures ${criticalMalus}` : ""} • Échec : danger de mort.`,
          useStandardSkillHandSubtitle: true,
          playedByOwner: true,
          gmOnlyChat: true
        });
        volonteResult = await ArcanaManager.rollFixedSkill(updatedActor, "volonte", {
          title: `${updatedActor.name} — Test critique`,
          subtitle: `Volonté / ${difficulty} — éviter l'inconscience`,
          difficulty,
          bonus: criticalMalus,
          chatTitle: `${updatedActor.name} — Volonté critique`,
          chatNote: `Cause : ${beforeVit > 0 ? "chute à 0 Vitalité" : "blessure supplémentaire à 0 Vitalité"}${sourceLabel ? ` • Source : ${sourceLabel}` : ""}${criticalMalus ? ` • Malus blessures ${criticalMalus}` : ""} • Échec : inconscience.`,
          useStandardSkillHandSubtitle: true,
          playedByOwner: true,
          gmOnlyChat: true
        });
      }

      const criticalUpdates = {};
      if (resistanceResult && !resistanceResult.success) {
        const draw = ArcanaManager?.drawTemporaryCard ? await ArcanaManager.drawTemporaryCard(updatedActor, `${updatedActor.name} — danger de mort`) : null;
        const rounds = Math.max(1, Number(draw?.value || 1));
        criticalUpdates["system.stats.dangerMort"] = true;
        criticalUpdates["system.stats.dangerMortRounds"] = rounds;
        if (!beforeDanger) statusNotes.push(`${updatedActor.name} est en danger de mort (${rounds} rounds).`);
      }
      if (volonteResult && !volonteResult.success) {
        const draw = ArcanaManager?.drawTemporaryCard ? await ArcanaManager.drawTemporaryCard(updatedActor, `${updatedActor.name} — inconscience`) : null;
        const rounds = Math.max(1, Number(draw?.value || 1));
        criticalUpdates["system.stats.inconscient"] = true;
        criticalUpdates["system.stats.inconscientRounds"] = rounds;
        if (!beforeInconscient) statusNotes.push(`${updatedActor.name} est inconscient (${rounds} rounds).`);
      }

      if (Object.keys(criticalUpdates).length) {
        await updatedActor.update(criticalUpdates, { axvVitalitySync: true });
      }

      critical = {
        difficulty,
        malus: criticalMalus,
        resistance: resistanceResult,
        volonte: volonteResult,
        updates: criticalUpdates
      };
    }

    return {
      target: updatedActor?.name ?? docActor?.name,
      sourceLabel,
      attackerActorId: attackerActor?.id ?? null,
      beforeVit,
      beforeBless,
      afterVit: Number(updatedActor?.system?.stats?.vitalite ?? afterVit),
      afterBless: Number(updatedActor?.system?.stats?.blessures ?? afterBless),
      updates: {
        ...updates,
        ...(critical?.updates || {})
      },
      damage,
      kind,
      statusNotes,
      critical
    };
  }

  static #killBillChatHtml(session, attackerActor, defenderActor) {
    const r = session?.resolved?.result;
    const ex = r?.killBill?.exchange;
    if (!r || !ex) return CombatManager.#chatHtml(session, attackerActor, defenderActor);

    const applied = (r.killBill?.applied && r.killBill.applied[0]) || null;
    const atkActor = ex.attackerSide === 'attacker' ? attackerActor : defenderActor;
    const defActor = ex.defenderSide === 'attacker' ? attackerActor : defenderActor;
    const atkCardVal = ex.attackCard?.isJoker ? 0 : Number(ex.attackCard?.value ?? 0);
    const defCardVal = ex.defenseCard?.isJoker ? 0 : Number(ex.defenseCard?.value ?? 0);
    const atkImg = CombatManager.#esc(ex.attackCard?.img || CombatManager.#fallbackCardImg(ex.attackCard));
    const defImg = CombatManager.#esc(ex.defenseCard?.img || CombatManager.#fallbackCardImg(ex.defenseCard));
    const outcomeHtml = ex.hit
      ? `<strong style="color:#236c2b;">TOUCHÉ</strong>${applied?.after != null ? ` — Vitalité : ${applied.before} → ${applied.after}` : ''}${ex.damage > 0 ? ` — Dégâts : <strong>${ex.damage}</strong>` : ''}`
      : `<strong style="color:#888;">PARRÉ / ÉVITÉ</strong>`;

    return `
      <div class="axv-chat-card" style="border:1px solid #d7dbe2;border-radius:10px;background:linear-gradient(180deg,#fff,#f7f9fc);color:#1f2937;font-size:11px;line-height:1.4;word-break:break-word;">
        <div style="padding:6px 8px;background:linear-gradient(90deg,#5b214f,#7c3aed);color:#fff;font-weight:900;font-size:12px;">⚔ Kill Bill — Attaque supplémentaire issue d'un atout de personnage</div>
        <div style="padding:6px 8px;background:#faf5ff;border-bottom:1px solid #eadcff;font-size:11px;color:#581c87;">
          <div><strong>Round ${Number(r.round || session?.round || 1)}</strong> — fin du même round de combat.</div>
          <div style="margin-top:2px;">${CombatManager.#esc(atkActor?.name)} porte une attaque supplémentaire à ${CombatManager.#esc(defActor?.name)}. Aucune riposte supplémentaire n'est jouée : seule la résolution Attaque vs Défense est effectuée.</div>
        </div>
        <div style="padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">
          <div style="padding:6px;border-radius:6px;background:#fff7f2;border:1px solid #f0d2c0;min-width:0;">
            ${CombatManager.#chatActorBadge(atkActor?.name || ex.attackerSide, atkActor, '#c65d2b')}
            <div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;min-width:0;">
              <img draggable="false" src="${atkImg}" style="width:44px;height:66px;object-fit:cover;border-radius:4px;background:#111;flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
              <div style="font-size:11px;line-height:1.5;min-width:0;">
                <div><strong>Attaque</strong></div>
                <div>Carte : <strong>${CombatManager.#esc(ex.attackCard?.name || 'Joker')}</strong> (${atkCardVal})</div>
                <div>Compétence : <strong>${CombatManager.#esc(ex.attackSkillLabel ?? 'Combat')}</strong> +${ex.attackSkillVal ?? '?'}</div>
                <div>Arme : <strong>${CombatManager.#esc(ex.weaponName || 'Poings')}</strong> ${Number(ex.weaponModVal || 0) >= 0 ? '+' : ''}${Number(ex.weaponModVal || 0)}</div>
                ${ex.atkStateMods?.length ? `<div>États : ${CombatManager.#esc(ex.atkStateMods.join(', '))}</div>` : ''}
                <div style="margin-top:4px;font-size:14px;font-weight:900;color:#7a3d14;">Total Attaque : ${ex.atkTotal}</div>
              </div>
            </div>
          </div>
          <div style="padding:6px;border-radius:6px;background:#f4f8ff;border:1px solid #cfdbf6;min-width:0;">
            ${CombatManager.#chatActorBadge(defActor?.name || ex.defenderSide, defActor, '#4467c4')}
            <div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;min-width:0;">
              <img draggable="false" src="${defImg}" style="width:44px;height:66px;object-fit:cover;border-radius:4px;background:#111;flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
              <div style="font-size:11px;line-height:1.5;min-width:0;">
                <div><strong>Défense</strong></div>
                <div>Carte : <strong>${CombatManager.#esc(ex.defenseCard?.name || 'Joker')}</strong> (${defCardVal})</div>
                <div>Compétence : <strong>Défense</strong> +${ex.defenseSkillVal ?? '?'}</div>
                <div>Protection : ${Number(ex.protectionVal || 0) >= 0 ? '+' : ''}${Number(ex.protectionVal || 0)}</div>
                ${ex.defStateMods?.length ? `<div>États : ${CombatManager.#esc(ex.defStateMods.join(', '))}</div>` : ''}
                <div style="margin-top:4px;font-size:14px;font-weight:900;color:#1e4ea1;">Total Défense : ${ex.defTotal}</div>
              </div>
            </div>
          </div>
        </div>
        <div style="padding:0 8px 8px 8px;">
          <div style="padding:8px 10px;border-top:1px solid #eee;background:${ex.hit ? '#f0ffe8' : '#f7f7f7'};font-size:18px;line-height:1.6;border-radius:0 0 8px 8px;">
            <div><strong>${CombatManager.#esc(atkActor?.name || ex.attackerSide)}</strong> attaque <strong>${CombatManager.#esc(defActor?.name || ex.defenderSide)}</strong></div>
            <div><strong>${ex.atkTotal}</strong> vs <strong>${ex.defTotal}</strong> → Marge <strong>${ex.margin}</strong> — ${outcomeHtml}</div>
          </div>
        </div>
      </div>`;
  }

  static #chatHtml(session, attackerActor, defenderActor) {
    const r = session.resolved?.result;
    if (!r) return `<div>Combat résolu.</div>`;

    const ppLabelMap = CombatManager.#ppLabelMap();
    const fmtPP = (ids) => {
      if (!Array.isArray(ids) || !ids.length) return 'aucune';
      return ids.map(id => CombatManager.#esc(ppLabelMap.get(id) || id)).join(', ');
    };
    const fmtList = (arr) => (Array.isArray(arr) && arr.length ? arr.map(CombatManager.#esc).join(', ') : 'aucune');
    const signed = (n) => Number(n) >= 0 ? `+${Number(n)}` : `${Number(n)}`;

    let appliedIdx = 0;
    const nextApplied = (ex) => {
      if (!ex?.hit || Number(ex?.damage || 0) <= 0) return null;
      const arr = Array.isArray(r.applied) ? r.applied : [];
      if (appliedIdx >= arr.length) return null;
      const entry = arr[appliedIdx];
      appliedIdx += 1;
      return entry || null;
    };

    const exHtml = (title, ex, atkActor, defActor, appliedEntry) => {
      const atkImg = CombatManager.#esc(CombatManager.#chatCardImg(ex.attackCard));
      const defImg = CombatManager.#esc(CombatManager.#chatCardImg(ex.defenseCard));
      const atkCardVal = ex.attackCard?.isJoker ? 0 : Number(ex.attackCard?.value ?? 0);
      const defCardVal = ex.defenseCard?.isJoker ? 0 : Number(ex.defenseCard?.value ?? 0);
      const atkName = CombatManager.#esc(atkActor?.name || ex.attackerSide);
      const defName = CombatManager.#esc(defActor?.name || ex.defenderSide);
      const weaponMod = Number(ex.weaponModVal ?? 0);
      const protVal = Number(ex.protectionVal ?? 0);

      let outcomeHtml = `<div style="color:#4b5563;font-weight:700;">Attaque parée / évitée</div>`;
      if (ex.hit) {
        if (appliedEntry?.kind === 'destin_cancel') {
          const canceled = Number(appliedEntry?.canceledDamage ?? ex.damage ?? 0);
          outcomeHtml = `<div style="color:#1d4ed8;font-weight:900;">${defName} annule ${canceled} point${canceled > 1 ? 's' : ''} de dégât${canceled > 1 ? 's' : ''} en dépensant 2 Destin</div>`;
        } else if (appliedEntry?.kind === 'blessure' || appliedEntry?.updates?.['system.stats.blessures'] !== undefined) {
          const beforeBless = Number(appliedEntry?.beforeBless ?? 0);
          const afterBless = Number(appliedEntry?.afterBless ?? appliedEntry?.updates?.['system.stats.blessures'] ?? beforeBless);
          const delta = Math.max(0, afterBless - beforeBless);
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} subit ${delta} blessure${delta > 1 ? 's' : ''} (${beforeBless} → ${afterBless})</div>`;
        } else if (appliedEntry?.updates?.['system.stats.vitalite'] !== undefined) {
          const beforeVit = Number(appliedEntry?.beforeVit ?? 0);
          const afterVit = Number(appliedEntry?.afterVit ?? appliedEntry?.updates?.['system.stats.vitalite'] ?? beforeVit);
          const delta = Math.max(0, beforeVit - afterVit);
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} perd ${delta} point${delta > 1 ? 's' : ''} de Vitalité (${beforeVit} → ${afterVit})</div>`;
        } else {
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} subit ${Number(ex.damage || 0)} dégât${Number(ex.damage || 0) > 1 ? 's' : ''}</div>`;
        }
        if (Array.isArray(appliedEntry?.statusNotes) && appliedEntry.statusNotes.length) {
          outcomeHtml += `<div style="margin-top:4px;color:#92400e;font-weight:700;">${appliedEntry.statusNotes.map(CombatManager.#esc).join('<br/>')}</div>`;
        }
      }

      return `
        <div style="border:1px solid #dbc7b8;border-radius:8px;background:#fff;margin-top:6px;overflow:hidden;">
          <div style="padding:5px 8px;background:#2f3a48;color:#fff;font-weight:900;font-size:11px;">${CombatManager.#esc(title)}</div>
          <div style="padding:8px;">
            <div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center;margin-bottom:6px;">
              <div style="padding:6px;border-radius:6px;background:#fff7f2;border:1px solid #f0d2c0;min-width:0;">
                ${CombatManager.#chatActorBadge(atkActor?.name || ex.attackerSide, atkActor, '#c65d2b')}
                <div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;min-width:0;">
                  <img draggable="false" src="${atkImg}" style="width:44px;height:66px;object-fit:cover;border-radius:4px;background:#111;flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
                  <div style="font-size:11px;line-height:1.5;min-width:0;">
                    <div>Carte : <strong>${CombatManager.#esc(ex.attackCard?.name || 'Joker')}</strong> (${atkCardVal})</div>
                    <div style="font-weight:900;color:#7a3d14;">Total : ${ex.atkTotal}</div>
                  </div>
                </div>
              </div>
              <div style="font-size:18px;font-weight:900;color:#64748b;">VS</div>
              <div style="padding:6px;border-radius:6px;background:#f4f8ff;border:1px solid #cfdbf6;min-width:0;">
                ${CombatManager.#chatActorBadge(defActor?.name || ex.defenderSide, defActor, '#4467c4')}
                <div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;min-width:0;">
                  <img draggable="false" src="${defImg}" style="width:44px;height:66px;object-fit:cover;border-radius:4px;background:#111;flex:0 0 auto;" onerror="this.src='${CombatManager.#esc(CombatManager.#fallbackCardImg(null))}';this.onerror=null;"/>
                  <div style="font-size:11px;line-height:1.5;min-width:0;">
                    <div>Carte : <strong>${CombatManager.#esc(ex.defenseCard?.name || 'Joker')}</strong> (${defCardVal})</div>
                    <div style="font-weight:900;color:#1e4ea1;">Total : ${ex.defTotal}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style="font-size:13px;font-weight:900;color:#1f2937;">${atkName} attaque ${defName}</div>
            <div style="margin-top:2px;font-size:12px;font-weight:900;color:#111827;">Attaque ${ex.atkTotal} vs Défense ${ex.defTotal}</div>
            <div style="margin-top:4px;font-size:12px;line-height:1.45;">${outcomeHtml}</div>

            ${((ex.pp?.incidents?.attacker && !ex.hit) || (ex.pp?.incidents?.defender && ex.hit)) ? `
              <div style="margin-top:4px;color:#b45309;font-size:11px;font-weight:700;">
                ${(ex.pp?.incidents?.attacker && !ex.hit) ? `⚠ Risque (${atkName}) : incident possible (MJ décide)` : ``}
                ${(ex.pp?.incidents?.attacker && !ex.hit) && (ex.pp?.incidents?.defender && ex.hit) ? `<br/>` : ``}
                ${(ex.pp?.incidents?.defender && ex.hit) ? `⚠ Risque (${defName}) : incident possible (MJ décide)` : ``}
              </div>` : ``}

            <details style="margin-top:6px;">
              <summary style="cursor:pointer;font-size:18px;font-weight:800;color:#374151;">Détail technique du combat</summary>
              <div style="margin-top:6px;">
                <div style="padding:6px;border-radius:6px;background:#fff7f2;border:1px solid #f0d2c0;margin-bottom:6px;">
                  ${CombatManager.#chatActorBadge(atkActor?.name || ex.attackerSide, atkActor, '#c65d2b')}
                  <div style="display:flex;gap:6px;margin-top:4px;">
                    <div style="font-size:18px;line-height:1.75;">
                      <div>Carte : <strong>${CombatManager.#esc(ex.attackCard?.name || 'Joker')}</strong> (${atkCardVal}) &nbsp;|&nbsp; ${CombatManager.#esc(ex.attackSkillLabel ?? 'Combat')} +${ex.attackSkillVal ?? '?'} &nbsp;|&nbsp; Arme ${signed(weaponMod)}${ex.atkPPAdj ? ` &nbsp;|&nbsp; Primes/Pénalités ${signed(ex.atkPPAdj)}` : ''}${ex.atkStateAdj ? ` &nbsp;|&nbsp; États ${signed(ex.atkStateAdj)}` : ''}</div>
                      <div style="font-size:18px;font-weight:900;color:#7a3d14;">Total Attaque : ${ex.atkTotal}</div>
                      ${ex.atkMods?.length ? `<div style="color:#7a3d14;font-style:italic;">PP : ${CombatManager.#esc(ex.atkMods.join(', '))}</div>` : ''}
                      ${ex.atkStateMods?.length ? `<div style="color:#7a3d14;font-style:italic;">États : ${CombatManager.#esc(ex.atkStateMods.join(', '))}</div>` : ''}
                      ${ex.pp?.attacker?.primes?.length ? `<div>Primes : ${fmtPP(ex.pp.attacker.primes)}</div>` : ''}
                      ${ex.pp?.attacker?.penalites?.length ? `<div>Pénalités : ${fmtPP(ex.pp.attacker.penalites)}</div>` : ''}
                    </div>
                  </div>
                </div>

                <div style="padding:6px;border-radius:6px;background:#f4f8ff;border:1px solid #cfdbf6;">
                  ${CombatManager.#chatActorBadge(defActor?.name || ex.defenderSide, defActor, '#4467c4')}
                  <div style="display:flex;gap:6px;margin-top:4px;">
                    <div style="font-size:18px;line-height:1.75;">
                      <div>Carte : <strong>${CombatManager.#esc(ex.defenseCard?.name || 'Joker')}</strong> (${defCardVal}) &nbsp;|&nbsp; Défense +${ex.defenseSkillVal ?? '?'} &nbsp;|&nbsp; Protection +${protVal}${ex.defPPAdj ? ` &nbsp;|&nbsp; Primes/Pénalités ${signed(ex.defPPAdj)}` : ''}${ex.defStateAdj ? ` &nbsp;|&nbsp; États ${signed(ex.defStateAdj)}` : ''}</div>
                      <div style="font-size:18px;font-weight:900;color:#1e4ea1;">Total Défense : ${ex.defTotal}</div>
                      ${ex.defMods?.length ? `<div style="color:#1e4ea1;font-style:italic;">PP : ${CombatManager.#esc(ex.defMods.join(', '))}</div>` : ''}
                      ${ex.defStateMods?.length ? `<div style="color:#1e4ea1;font-style:italic;">États : ${CombatManager.#esc(ex.defStateMods.join(', '))}</div>` : ''}
                      ${ex.pp?.defender?.primes?.length ? `<div>Primes : ${fmtPP(ex.pp.defender.primes)}</div>` : ''}
                      ${ex.pp?.defender?.penalites?.length ? `<div>Pénalités : ${fmtPP(ex.pp.defender.penalites)}</div>` : ''}
                    </div>
                  </div>
                </div>

                <div style="margin-top:6px;padding:8px 10px;border-top:1px solid #eee;background:${ex.hit ? '#f0ffe8' : '#f7f7f7'};font-size:18px;line-height:1.6;">
                  <div><strong>${ex.atkTotal}</strong> vs <strong>${ex.defTotal}</strong> → Marge <strong>${ex.margin}</strong> — ${ex.hit ? `<strong style="color:#236c2b;">TOUCHÉ</strong>` : `<strong style="color:#888;">PARRÉ / ÉVITÉ</strong>`}</div>
                  ${ex.hit ? `<div style="font-size:18px;font-weight:900;color:#b91c1c;">Dégâts finaux : ${ex.damage}</div><div style="font-size:13px;color:#7a3d14;">Base : marge ${ex.margin}${ex.damageMods?.length ? ` • ${CombatManager.#esc(ex.damageMods.join(', '))}` : ""}</div>` : ''}
                </div>
              </div>
            </details>
          </div>
        </div>`;
    };
    const firstAtkActor = r.first.attackerSide === 'attacker' ? attackerActor : defenderActor;
    const firstDefActor = r.first.defenderSide === 'attacker' ? attackerActor : defenderActor;
    const secondAtkActor = r.second.attackerSide === 'attacker' ? attackerActor : defenderActor;
    const secondDefActor = r.second.defenderSide === 'attacker' ? attackerActor : defenderActor;

    const firstApplied = nextApplied(r.first);
    const secondApplied = nextApplied(r.second);
    const killBillApplied = r.killBill?.exchange ? nextApplied(r.killBill.exchange) : null;

    const atkWeaponName = CombatManager.#esc(r.attackerWeapon?.name || 'Poings');
    const defWeaponName = CombatManager.#esc(r.defenderWeapon?.name || 'Poings');

    return `
      <div class="axv-chat-card" style="border:1px solid #d7dbe2;border-radius:10px;background:linear-gradient(180deg,#fff,#f7f9fc);color:#1f2937;font-size:11px;line-height:1.4;word-break:break-word;">
        <div style="padding:6px 8px;background:linear-gradient(90deg,#521A15,#7b3327);color:#fff;font-weight:900;font-size:12px;">⚔ Combat — ${CombatManager.#esc(attackerActor?.name)} vs ${CombatManager.#esc(defenderActor?.name)} — Round ${r.round}</div>
        <div style="padding:6px 8px;background:#f5f0eb;border-bottom:1px solid #e0d5cc;font-size:10px;color:#5a4a3a;">
          <div>${CombatManager.#esc(attackerActor?.name)} : <strong>${atkWeaponName}</strong> (${CombatManager.#esc(r.attackerWeapon?.degats || '-3')}) — ${CombatManager.#esc(defenderActor?.name)} : <strong>${defWeaponName}</strong> (${CombatManager.#esc(r.defenderWeapon?.degats || '-3')})</div>
          <div style="margin-top:3px;">
            <span style="display:inline-block;padding:2px 5px;border-radius:4px;background:#fff7f2;border:1px solid #f0d2c0;margin-bottom:2px;"><strong>${CombatManager.#esc(attackerActor?.name)}</strong> P: ${fmtList(r.ppSummary?.attacker?.primes)} / Pén: ${fmtList(r.ppSummary?.attacker?.penalites)}</span>
            <span style="display:inline-block;padding:2px 5px;border-radius:4px;background:#f4f8ff;border:1px solid #cfdbf6;margin-bottom:2px;"><strong>${CombatManager.#esc(defenderActor?.name)}</strong> P: ${fmtList(r.ppSummary?.defender?.primes)} / Pén: ${fmtList(r.ppSummary?.defender?.penalites)}</span>
          </div>
        </div>
        <div style="padding:6px 8px;">
          ${exHtml('Échange 1 — ' + CombatManager.#esc(firstAtkActor?.name) + ' attaque', r.first, firstAtkActor, firstDefActor, firstApplied)}
          ${exHtml('Échange 2 — ' + CombatManager.#esc(secondAtkActor?.name) + ' attaque', r.second, secondAtkActor, secondDefActor, secondApplied)}
          ${r.killBill?.exchange ? `<div style="margin-top:6px;padding:6px 8px;border:1px solid #e9d5ff;border-radius:8px;background:#faf5ff;color:#581c87;font-weight:800;">Kill Bill — Attaque supplémentaire issue d'un atout de personnage</div>` + exHtml('Kill Bill — ' + CombatManager.#esc((r.killBill.exchange.attackerSide === 'attacker' ? attackerActor : defenderActor)?.name) + " attaque supplémentaire issue d'un atout de personnage", r.killBill.exchange, r.killBill.exchange.attackerSide === 'attacker' ? attackerActor : defenderActor, r.killBill.exchange.defenderSide === 'attacker' ? attackerActor : defenderActor, killBillApplied) : ``}
        </div>
      </div>`;
  }

}


// Auto-init
Hooks.once("ready", () => {
  CombatManager.ensureSocket();
  game.arcane15 = game.arcane15 || {};
  game.arcane15.combat = CombatManager;
  console.log("[ARCANE XV][COMBAT] registered on game.arcane15.combat");

  try {
    window.setTimeout(() => {
      try { AXV_setupChatNativeRepair("ready"); } catch (e) { console.warn("[ARCANE XV][CHAT][READY][ERROR]", e); }
    }, 50);

    game.arcane15.debugChat = () => AXV_debugChat("manual");
  } catch (e) {
    console.warn("[ARCANE XV][CHAT][READY][ERROR]", e);
  }
});

Hooks.on("updateActor", async (actor, changes, options) => {
  try {
    if (options?.axvVitalitySync) return;
    if (actor?.type !== "personnage") return;

    const stats = actor.system?.stats || {};
    const currentVit = Number(stats.vitalite ?? 0);
    const currentMax = Number(stats.vitaliteMax ?? 0);
    const statMalEnPoint = !!stats.malEnPoint;
    const flagMalEnPoint = !!actor.getFlag?.("arcane15", "malEnPoint");

    if (currentVit > 0 && (statMalEnPoint || flagMalEnPoint || Number(stats.blessures || 0) > 0 || stats.dangerMort || stats.inconscient || stats.mort)) {
      await actor.update({
        "system.stats.malEnPoint": false,
        "system.stats.blessures": 0,
        "system.stats.dangerMort": false,
        "system.stats.dangerMortRounds": 0,
        "system.stats.inconscient": false,
        "system.stats.inconscientRounds": 0,
        "system.stats.mort": false,
      }, { axvVitalitySync: true });
      try {
        await actor.setFlag("arcane15", "malEnPoint", false);
        await actor.setFlag("arcane15", "lastDamage", 0);
      } catch (_) {}
      return;
    }


    if (flagMalEnPoint !== statMalEnPoint) {
      try {
        await actor.setFlag("arcane15", "malEnPoint", statMalEnPoint);
      } catch (_) {}
    }
  } catch (error) {
    console.warn("[ARCANE XV][COMBAT] updateActor vitality sync failed", error);
  }
});

// Suppress Foundry's default Combat tracker round notification messages.
// We only want our custom initiative/combat chat cards.
Hooks.on("preCreateChatMessage", (message) => {
  try {
    // Foundry creates messages with flags.core.initiativeRoll or with combatRound content
    const flags = message?.flags?.core || {};
    if (flags.initiativeRoll) {
      console.log("[ARCANE XV][COMBAT] suppressing Foundry initiative roll message");
      return false;
    }
    // Suppress "Round X" type messages from Foundry's Combat tracker
    const content = String(message?.content || "");
    if (content.match(/^<h[234]>.*round\s*\d+/i) || content.match(/^round\s*\d+/i)) {
      console.log("[ARCANE XV][COMBAT] suppressing Foundry round message");
      return false;
    }

    AXV_markAutoscrollIntent("preCreateChatMessage");
  } catch (_) {}
});

// Also suppress combat round updates from the tracker
Hooks.on("updateCombat", (combat, update) => {
  try {
    // Prevent the default round change notification
    if (update?.round !== undefined) {
      combat._surpressRoundNotification = true;
    }
  } catch (_) {}
});

// Hide default Foundry chat header (speaker name, timestamp) for our custom cards.
// Do not force scroll here: repeated renders would trap the user at the bottom of the chat log.
Hooks.on("renderChatMessageHTML", (message, html) => {
  try {
    const el = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
    if (!el) return;

    if (message?.flags?.arcane15?.customCard) {
      const header = el.querySelector(".message-header");
      if (header) header.style.display = "none";

      const sender = el.querySelector(".message-sender");
      if (sender) sender.style.display = "none";

      const content = el.querySelector(".message-content");
      if (content) { content.style.paddingTop = "0"; content.style.marginTop = "0"; }
    }

    AXV_maybeAutoscroll("renderChatMessageHTML");
  } catch (e) {
    console.warn("[ARCANE XV][COMBAT] renderChatMessageHTML hook error", e);
  }
});


function AXV_chatDescribeEl(label, el) {
  if (!el) return { label, missing: true };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    label,
    tag: el.tagName,
    id: el.id || "",
    className: el.className || "",
    overflow: cs.overflow,
    overflowY: cs.overflowY,
    overflowX: cs.overflowX,
    pointerEvents: cs.pointerEvents,
    display: cs.display,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
    rect: { w: Math.round(r.width), h: Math.round(r.height) }
  };
}

function AXV_getChatScroller() {
  return document.querySelector('#chat') || null;
}


let AXV_pendingAutoscroll = false;

function AXV_isChatNearBottom(threshold = 80) {
  const chat = AXV_getChatScroller();
  if (!chat) return true;
  const distance = Math.max(0, (chat.scrollHeight - chat.clientHeight - chat.scrollTop));
  return distance <= threshold;
}

function AXV_markAutoscrollIntent(reason = 'unknown') {
  try {
    AXV_pendingAutoscroll = AXV_isChatNearBottom(80);
    console.log('[ARCANE XV][CHAT][AUTOSCROLL][MARK]', { reason, pending: AXV_pendingAutoscroll, chat: AXV_chatDescribeEl('#chat', AXV_getChatScroller()) });
  } catch (e) {
    console.warn('[ARCANE XV][CHAT][AUTOSCROLL][MARK][ERROR]', e);
  }
}

function AXV_maybeAutoscroll(reason = 'unknown') {
  try {
    const chat = AXV_getChatScroller();
    if (!chat) return;
    if (!AXV_pendingAutoscroll) {
      console.log('[ARCANE XV][CHAT][AUTOSCROLL][SKIP]', { reason, pending: AXV_pendingAutoscroll, chat: AXV_chatDescribeEl('#chat', chat) });
      return;
    }
    AXV_pendingAutoscroll = false;
    requestAnimationFrame(() => {
      try {
        const before = chat.scrollTop;
        chat.scrollTop = chat.scrollHeight;
        console.log('[ARCANE XV][CHAT][AUTOSCROLL][RUN]', { reason, before, after: chat.scrollTop, scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight });
      } catch (e) {
        console.warn('[ARCANE XV][CHAT][AUTOSCROLL][RUN][ERROR]', e);
      }
    });
  } catch (e) {
    console.warn('[ARCANE XV][CHAT][AUTOSCROLL][ERROR]', e);
  }
}

function AXV_repairChatNative(reason = 'unknown') {
  const chat = document.querySelector('#chat');
  if (!chat) {
    console.warn('[ARCANE XV][CHAT][REPAIR] #chat missing', { reason });
    return null;
  }

  // The runtime diagnostics showed that #chat itself is the actual scroll container.
  chat.style.pointerEvents = 'auto';
  chat.style.overflowY = 'auto';
  chat.style.overflowX = 'hidden';
  chat.style.webkitOverflowScrolling = 'touch';

  const chatLog = chat.querySelector('#chat-log, .chat-log');
  if (chatLog) {
    chatLog.style.pointerEvents = 'auto';
    chatLog.style.maxWidth = '100%';
    chatLog.style.boxSizing = 'border-box';
  }

  chat.querySelectorAll('.chat-message, .message-content').forEach(el => {
    el.style.pointerEvents = 'auto';
    el.style.maxWidth = '100%';
    el.style.minWidth = '0';
    el.style.boxSizing = 'border-box';
  });

  console.log('[ARCANE XV][CHAT][REPAIR]', {
    reason,
    chat: AXV_chatDescribeEl('#chat', chat),
    chatLog: AXV_chatDescribeEl('#chat-log', chatLog)
  });

  return chat;
}

function AXV_bindChatDiagnostics() {
  const chat = AXV_getChatScroller();
  if (!chat || chat.dataset.axvChatDiagBound === '1') return;
  chat.dataset.axvChatDiagBound = '1';

  chat.addEventListener('scroll', () => {
    console.log('[ARCANE XV][CHAT][SCROLL]', {
      top: chat.scrollTop,
      max: Math.max(0, chat.scrollHeight - chat.clientHeight)
    });
  }, { passive: true });
}

function AXV_debugChat(reason = 'manual') {
  const chat = document.querySelector('#chat');
  const chatLog = chat?.querySelector?.('#chat-log, .chat-log') || null;
  const rows = [
    AXV_chatDescribeEl('#chat', chat),
    AXV_chatDescribeEl('#chat-log', chatLog)
  ];
  console.log('[ARCANE XV][CHAT][DIAG]', reason, rows);
  return rows;
}

function AXV_setupChatNativeRepair(reason = 'unknown') {
  const chat = AXV_repairChatNative(reason);
  if (!chat) return;
  AXV_bindChatDiagnostics();
}

Hooks.on('changeSidebarTab', (app, tab) => {
  try {
    console.log('[ARCANE XV][CHAT][TAB]', { tab });
    if (tab === 'chat') window.setTimeout(() => AXV_setupChatNativeRepair('changeSidebarTab'), 0);
  } catch (e) {
    console.warn('[ARCANE XV][CHAT][TAB][ERROR]', e);
  }
});

Hooks.on('renderSidebarTab', (app, html) => {
  try {
    const tabName = app?.tabName || app?.options?.id || null;
    console.log('[ARCANE XV][CHAT][RENDER]', { tabName });
    if (tabName === 'chat' || html?.id === 'chat' || html?.[0]?.id === 'chat') {
      window.setTimeout(() => AXV_setupChatNativeRepair('renderSidebarTab'), 0);
    }
  } catch (e) {
    console.warn('[ARCANE XV][CHAT][RENDER][ERROR]', e);
  }
});
