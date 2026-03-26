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

    if (data.type === "axvCombat:end") {
      if (!game.user.isGM) return;
      return CombatManager.#gmEndSession(data);
    }

    if (data.type === "axvCombat:close") {
      return CombatManager.#clientClose(data);
    }
  }

  // ---------------------------
  // API appelé depuis actor-sheet
  // ---------------------------
  static async openAttackFromWeapon(attackerActor, weaponKey) {
    CombatManager.ensureSocket();

    const targets = Array.from(game.user.targets || []);
    const targetToken = targets?.[0] || null;
    if (!targetToken) {
      ui.notifications.error("Combat: aucune cible sélectionnée sur la scène.");
      console.warn("[ARCANE XV][COMBAT] no target selected", { user: game.user?.name });
      return;
    }

    const weapon = attackerActor?.system?.combat?.[weaponKey] || null;
    const weaponName = String(weapon?.nom || "").trim();
    if (!weaponName) {
      ui.notifications.error("Combat: arme vide.");
      console.warn("[ARCANE XV][COMBAT] empty weapon", { weaponKey, attacker: attackerActor?.name });
      return;
    }

    const weaponDamageStr = String(weapon?.degats || "").trim();
    const attackMod = CombatManager.#parseSignedInt(weaponDamageStr);
    const attackerWeapon = CombatManager.#resolveWeaponForActor(attackerActor, weaponKey, {
      weaponKey,
      name: weaponName,
      degats: weaponDamageStr,
      attackMod
    });

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
      resolved: { done: false, revealed: false, result: null }
    };

    CombatManager.#gmSessions.set(sessionId, session);

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

    if (game.user?.isGM) {
      console.warn(`[ARCANE XV][COMBAT] ${actor?.name} n'a aucune arme équipée → Poings (-3). Cochez Équipé sur la fiche.`);
      ui.notifications?.info?.(`${actor?.name} n'a aucune arme équipée. Il combattra à mains nues (Poings -3).`);
    }
    return {
      weaponKey: null,
      name: "Poings",
      degats: "-3",
      attackMod: -3,
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
    const ids = [...new Set((session.picks[role].played || []).filter(c => c && !c.isJoker && !String(c.id).startsWith("virtual-")).map(c => c.id))];
    const handId = actor?.getFlag?.("arcane15", "hand");
    const hand = handId ? game.cards.get(handId) : null;
    for (const id of ids) {
      const card = hand?.cards?.get(id);
      if (!card) continue;
      await CardManager.cycleCard(actor, card);
    }
    await CombatManager.#safeInitDecks(actor);
  }

  static #resetRoundState(session) {
    for (const role of ["attacker", "defender"]) {
      session.picks[role] = { attack: null, defense: null, locked: false, ready: false, played: [], primes: [], penalites: [] };
    }
    session.resolved = { done: false, revealed: false, result: null };
    session.round = Number(session.round || 1) + 1;
  }

  static async #gmPickCard(data) {
    const { sessionId, role, zone, cardId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role) || !["attack", "defense"].includes(zone)) return;
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

    if (checked) {
      if (!list.includes(id)) list.push(id);
    } else {
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
    }

    console.log("[ARCANE XV][COMBAT][GM] pp updated", { sessionId, role, primes: pick.primes, penalites: pick.penalites });
    return CombatManager.#gmBroadcastState(sessionId);
  }


  static async #gmReady(data) {
    const { sessionId, role } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session || !["attacker", "defender"].includes(role)) return;
    const pick = session.picks[role];
    if (pick.locked) return CombatManager.#gmBroadcastState(sessionId);

    const finalized = CombatManager.#finalizeRoundSelection(session, role);
    if (!finalized.ok) {
      session.toast = finalized.toast;
      await CombatManager.#gmBroadcastState(sessionId);
      return;
    }

    if ((pick.primes || []).length > 0 && (pick.penalites || []).length === 0) {
      session.toast = "Choisis au moins une pénalité si tu prends une prime.";
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

    const makeExchange = ({ attackerSide, defenderSide, attackActor, defenseActor, attackCard, defenseCard, attackSkill, attackSkillLabel = "Combat", defenseSkill, weaponMod, protection, weaponName }) => {
      const attackPP = attackerSide === 'attacker' ? ppAtt : ppDef;
      const defensePP = defenderSide === 'attacker' ? ppAtt : ppDef;

      const atkMods = [];
      const defMods = [];
      const atkStateMods = [];
      const defStateMods = [];
      let atkAdj = 0;
      let defAdj = 0;

      if (attackPP.primes.includes('efficacite')) { atkAdj += 1; atkMods.push('Efficacité +1'); }
      if (attackPP.penalites.includes('difficulte')) { atkAdj -= 1; atkMods.push('Difficulté -1'); }
      if (defensePP.primes.includes('prudence')) { defAdj += 1; defMods.push('Prudence +1'); }
      if (defensePP.penalites.includes('danger')) { defAdj -= 1; defMods.push('Danger -1'); }

      const attackVitalite = Number(attackActor?.system?.stats?.vitalite ?? 0);
      const defenseVitalite = Number(defenseActor?.system?.stats?.vitalite ?? 0);
      if (attackVitalite <= 0) { atkAdj -= 1; atkStateMods.push('Mal en point -1'); }
      if (defenseVitalite <= 0) { defAdj -= 1; defStateMods.push('Mal en point -1'); }

      const attackRuntime = attackActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const defenseRuntime = defenseActor?.getFlag?.('arcane15', 'arcanaRuntime') || {};
      const attackAllTestsMalus = Number(attackRuntime?.allTestsMalus?.value || 0);
      const defenseAllTestsMalus = Number(defenseRuntime?.allTestsMalus?.value || 0);
      if (attackAllTestsMalus) { atkAdj -= attackAllTestsMalus; atkStateMods.push(`${attackRuntime?.allTestsMalus?.label || 'Malus arcane'} -${attackAllTestsMalus}`); }
      if (defenseAllTestsMalus) { defAdj -= defenseAllTestsMalus; defStateMods.push(`${defenseRuntime?.allTestsMalus?.label || 'Malus arcane'} -${defenseAllTestsMalus}`); }

      const attackDoublePrimes = !!attackRuntime?.statuses?.doublePrimes;
      const defenseDoublePrimes = !!defenseRuntime?.statuses?.doublePrimes;
      if (attackDoublePrimes && attackPP.primes.includes('efficacite')) { atkAdj += 1; atkMods.push('Maison-dieu : Efficacité doublée'); }
      if (defenseDoublePrimes && defensePP.primes.includes('prudence')) { defAdj += 1; defMods.push('Maison-dieu : Prudence doublée'); }

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
        // Breakdown values for detailed chat display
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
          attacker: { primes: [...attackPP.primes], penalites: [...attackPP.penalites] },
          defender: { primes: [...defensePP.primes], penalites: [...defensePP.penalites] },
          incidents: {
            attacker: attackPP.penalites.includes('risque'),
            defender: defensePP.penalites.includes('risque')
          }
        }
      };
    };

    const first = attackerActsFirst
      ? makeExchange({ attackerSide: 'attacker', defenderSide: 'defender', attackActor: attackerActor, defenseActor: defenderActor, attackCard: aAtk, defenseCard: dDef, attackSkill: atkCombat, attackSkillLabel: atkCombatLabel, defenseSkill: defDefenseSkill, weaponMod: aWeapon.attackMod, protection: defProtection, weaponName: aWeapon.name })
      : makeExchange({ attackerSide: 'defender', defenderSide: 'attacker', attackActor: defenderActor, defenseActor: attackerActor, attackCard: dAtk, defenseCard: aDef, attackSkill: defCombat, attackSkillLabel: defCombatLabel, defenseSkill: atkDefenseSkill, weaponMod: dWeapon.attackMod, protection: atkProtection, weaponName: dWeapon.name });

    const second = attackerActsFirst
      ? makeExchange({ attackerSide: 'defender', defenderSide: 'attacker', attackActor: defenderActor, defenseActor: attackerActor, attackCard: dAtk, defenseCard: aDef, attackSkill: defCombat, attackSkillLabel: defCombatLabel, defenseSkill: atkDefenseSkill, weaponMod: dWeapon.attackMod, protection: atkProtection, weaponName: dWeapon.name })
      : makeExchange({ attackerSide: 'attacker', defenderSide: 'defender', attackActor: attackerActor, defenseActor: defenderActor, attackCard: aAtk, defenseCard: dDef, attackSkill: atkCombat, attackSkillLabel: atkCombatLabel, defenseSkill: defDefenseSkill, weaponMod: aWeapon.attackMod, protection: defProtection, weaponName: aWeapon.name });

    const applyDamage = async (exchange) => {
      if (!exchange.hit || exchange.damage <= 0) return null;
      try {
        const targetActor = exchange.defenderSide === 'attacker' ? attackerActor : defenderActor;

        // Find token document for the target — needed for unlinked tokens
        let targetTokDoc = null;
        if (exchange.defenderSide === 'attacker') {
          targetTokDoc = attackerTokDoc || null;
        } else {
          targetTokDoc = tokDoc;
        }

        const beforeVit = Number(targetActor?.system?.stats?.vitalite ?? 0);
        const beforeBless = Number(targetActor?.system?.stats?.blessures ?? 0);

        console.log('[ARCANE XV][COMBAT][GM] applyDamage', {
          target: targetActor?.name,
          damage: exchange.damage,
          beforeVit,
          beforeBless,
          hasToken: !!targetTokDoc,
          actorId: targetActor?.id
        });

        const updates = {};
        if (beforeVit > 0) {
          const afterVit = Math.max(0, beforeVit - exchange.damage);
          updates['system.stats.vitalite'] = afterVit;
          if (afterVit === 0) {
            try { await targetActor.setFlag('arcane15', 'malEnPoint', true); } catch (_) {}
            try { await targetActor.setFlag('arcane15', 'lastDamage', exchange.damage); } catch (_) {}
          }
        } else {
          updates['system.stats.blessures'] = beforeBless + 1;
          try { await targetActor.setFlag('arcane15', 'malEnPoint', true); } catch (_) {}
          try { await targetActor.setFlag('arcane15', 'lastDamage', exchange.damage); } catch (_) {}
        }

        // Apply update: prefer token actor (for unlinked tokens), fallback to actor
        if (targetTokDoc?.actor) {
          await targetTokDoc.actor.update(updates);
        } else {
          await targetActor.update(updates);
        }

        const updatedActor = targetTokDoc?.actor || targetActor;
        const afterVit = Number(updatedActor?.system?.stats?.vitalite ?? 0);
        const afterBless = Number(updatedActor?.system?.stats?.blessures ?? 0);
        console.log('[ARCANE XV][COMBAT][GM] applyDamage OK', {
          target: targetActor?.name,
          updates,
          afterVit,
          afterBless
        });

        return { target: targetActor.name, beforeVit, beforeBless, updates, damage: exchange.damage };
      } catch (e) {
        console.error('[ARCANE XV][COMBAT][GM] applyDamage FAILED', e, { exchange });
        return null;
      }
    };

    const applied = [];
    const firstApplied = await applyDamage(first); if (firstApplied) applied.push(firstApplied);
    const secondApplied = await applyDamage(second); if (secondApplied) applied.push(secondApplied);

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

    try {
      await CombatManager.#applyCardCycleForRound(session, 'attacker');
      await CombatManager.#applyCardCycleForRound(session, 'defender');
    } catch (e) {
      console.error('[ARCANE XV][COMBAT][GM] card cycle after round failed', e);
    }

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

    if (!session.ended) {
      CombatManager.#resetRoundState(session);
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

    const aSelIds = [aPick.attack, aPick.defense].filter(Boolean);
    const dSelIds = [dPick.attack, dPick.defense].filter(Boolean);

    const attackerPickedVisible = {
      attack: aPick.attack ? (attackerHand.find(c => c.id === aPick.attack) || null) : null,
      defense: aPick.defense ? (attackerHand.find(c => c.id === aPick.defense) || null) : null
    };
    const defenderPickedVisible = {
      attack: dPick.attack ? (defenderHand.find(c => c.id === dPick.attack) || null) : null,
      defense: dPick.defense ? (defenderHand.find(c => c.id === dPick.defense) || null) : null
    };

    attackerHand = attackerHand.filter(c => !aSelIds.includes(c.id));
    defenderHand = defenderHand.filter(c => !dSelIds.includes(c.id));

    const isGM = (role === "gm");
    const attackerSelf = (role === "attacker");
    const defenderSelf = (role === "defender");
    const revealed = !!session.resolved?.revealed;
    const backImg = "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png";

    const hidePicked = (card) => {
      if (!card) return null;
      return { ...card, img: backImg, name: "Carte", value: 0, suit: "", isJoker: false, faceImg: null, rawImg: null };
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
          attack: (attackerSelf || isGM || revealed) ? attackerPickedVisible.attack : hidePicked(attackerPickedVisible.attack),
          defense: (attackerSelf || isGM || revealed) ? attackerPickedVisible.defense : hidePicked(attackerPickedVisible.defense)
        },
        locked: !!aPick.locked,
        ready: !!aPick.ready,
        played: CombatManager.#maskPlayed(aPick.played, (!attackerSelf && !isGM) && !revealed, revealed),
        primes: attackerSelf ? (aPick.primes || []) : [],
        penalites: attackerSelf ? (aPick.penalites || []) : []
      },
      defender: {
        actorId: session.defender.actorId,
        name: session.defender.name,
        sommeMax: Number(defenderActor?.system?.stats?.sommeMax ?? 0),
        restriction: CombatManager.#getRestrictionForRole(session, "defender"),
        hand: defenderSelf ? defenderHand : [],
        handBackCount: defenderSelf ? 0 : defenderHand.length,
        picked: {
          attack: (defenderSelf || isGM || revealed) ? defenderPickedVisible.attack : hidePicked(defenderPickedVisible.attack),
          defense: (defenderSelf || isGM || revealed) ? defenderPickedVisible.defense : hidePicked(defenderPickedVisible.defense)
        },
        locked: !!dPick.locked,
        ready: !!dPick.ready,
        played: CombatManager.#maskPlayed(dPick.played, (!defenderSelf && !isGM) && !revealed, revealed),
        primes: defenderSelf ? (dPick.primes || []) : [],
        penalites: defenderSelf ? (dPick.penalites || []) : []
      },
      resolved: {
        done: !!session.resolved.done,
        revealed: !!session.resolved.revealed,
        result: session.resolved.done ? session.resolved.result : null
      }
    };

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

    // Bouton fantoche requis par DialogV2 — footer masqué, vrais boutons dans .axv-actions
    const buttons = [{ action: "noop", label: " ", default: false, callback: () => false }];

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
      const footer = appEl?.querySelector?.('footer, .dialog-footer, .window-footer, .dialog-buttons, .form-footer');
      if (footer) footer.style.display = 'none';
      try {
        const left = Math.max(24, Math.round((window.innerWidth - 1240) / 2));
        const top  = Math.max(24, Math.round((window.innerHeight - 860) / 2));
        dlg.setPosition?.({ left, top, width: 1220 });
      } catch (_) {}
      try {
        const wc = appEl?.querySelector?.('.window-content');
        if (wc) { wc.style.background = 'rgba(0,0,0,0.92)'; wc.style.backgroundImage = 'none'; wc.style.padding = '8px'; wc.style.overflow = 'auto'; }
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
      #${dialogId} .axv-wrap { width:1180px; max-width:1180px; display:flex; flex-direction:column; gap:5px; }
      #${dialogId} .axv-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; padding:5px 10px; border:1px solid rgba(255,255,255,.18); border-radius:10px; background:#000; }
      #${dialogId} .axv-title { font-weight:900; font-size:14px; }
      #${dialogId} .axv-sub { font-size:11px; opacity:.85; margin-top:2px; }
      #${dialogId} .axv-row { display:flex; gap:8px; }
      #${dialogId} .axv-col { flex:1; border:none; background:transparent; padding:0; }
      #${dialogId} .axv-col h3 { display:none; }
      #${dialogId} .axv-pill { font-size:11px; font-weight:900; padding:3px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.35); white-space:nowrap; }
      #${dialogId} .axv-self-block--green { background:linear-gradient(160deg,#1a4a2e,#0d3320); border:1px solid rgba(60,180,90,.35); border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:6px; }
      #${dialogId} .axv-self-block--red   { background:linear-gradient(160deg,#4a1a1a,#331010); border:1px solid rgba(180,60,60,.35); border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:6px; }
      #${dialogId} .axv-block-header { display:flex; justify-content:space-between; align-items:center; }
      #${dialogId} .axv-block-name { font-weight:900; font-size:13px; }
      #${dialogId} .axv-hand-title { display:flex; justify-content:space-between; font-size:11px; font-weight:700; margin-bottom:3px; opacity:.85; }
      #${dialogId} .axv-hand { display:flex; gap:7px; flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden; padding-bottom:4px; }
      #${dialogId} .axv-hand::-webkit-scrollbar { height:4px; }
      #${dialogId} .axv-hand::-webkit-scrollbar-thumb { background:rgba(255,255,255,.2); border-radius:999px; }
      #${dialogId} .axv-card { width:76px; border-radius:9px; overflow:hidden; border:1px solid rgba(0,0,0,.3); background:#111; cursor:grab; user-select:none; flex:0 0 auto; display:flex; flex-direction:column; }
      #${dialogId} .axv-card img { width:100%; height:102px; object-fit:cover; display:block; }
      #${dialogId} .axv-card-meta { padding:3px 5px 4px; background:rgba(0,0,0,.82); border-top:1px solid rgba(255,255,255,.08); }
      #${dialogId} .axv-card-name { font-size:10px; font-weight:800; line-height:1.1; color:#f6e7db; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${dialogId} .axv-card-val { font-size:10px; color:#f8b18a; }
      #${dialogId} .axv-card[aria-disabled="true"] { opacity:.6; cursor:not-allowed; border-color:rgba(214,73,73,.8); }
      #${dialogId} .axv-card.is-disabled .axv-card-meta { background:rgba(42,8,8,.92); }
      #${dialogId} .axv-card.is-restricted { border:2px solid rgba(255,50,50,.85) !important; }
      #${dialogId} .axv-zones { display:flex; gap:6px; }
      #${dialogId} .axv-zone { flex:1; border:2px dashed rgba(255,255,255,.25); border-radius:10px; padding:6px; height:140px; max-height:140px; overflow:hidden; box-sizing:border-box; background:rgba(0,0,0,.2); }
      #${dialogId} .axv-zone.dragover { border-color:rgba(255,255,255,.6); background:rgba(255,255,255,.07); }
      #${dialogId} .axv-zone-title { font-weight:900; font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; }
      #${dialogId} .axv-zone-slot { display:flex; gap:5px; overflow:hidden; }
      #${dialogId} .axv-mini { font-size:10px; opacity:.75; }
      #${dialogId} .axv-foot { font-size:10px; opacity:.7; }
      #${dialogId} .axv-pp { display:flex; gap:6px; }
      #${dialogId} .axv-pp-box { flex:1; padding:5px 7px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.25); }
      #${dialogId} .axv-pp-box .axv-zone-title { font-size:11px; margin-bottom:2px; }
      #${dialogId} .axv-pp-line { display:flex; gap:5px; align-items:center; margin:2px 0; font-size:11px; opacity:.9; }
      #${dialogId} .axv-pp-warn { margin-top:2px; font-size:11px; font-weight:900; color:#f8b18a; }
      #${dialogId} .axv-result { padding:5px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:#000; font-size:11px; }
      #${dialogId} .axv-result strong { font-weight:900; }
      #${dialogId} .axv-actions { display:flex !important; gap:10px; justify-content:flex-end; align-items:center; padding:7px 10px; background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.5)); border:1px solid rgba(255,255,255,.08); border-radius:10px; }
      #${dialogId} .axv-btn { appearance:none; border:1px solid rgba(248,142,85,.9); background:linear-gradient(180deg,rgba(248,142,85,.25),rgba(82,26,21,.65)); color:#fff; border-radius:9px; padding:7px 16px; font-weight:900; font-size:12px; cursor:pointer; }
      #${dialogId} .axv-btn.secondary { border-color:rgba(255,255,255,.2); background:rgba(255,255,255,.06); }
      #${dialogId} .axv-btn:disabled { opacity:.45; cursor:not-allowed; }
    `;
    wrap.appendChild(styleEl);

    // Boutons pré-injectés — visibles dès l'ouverture, sans attendre le state socket
    let actionsHtml = "";
    if (role === "attacker" || role === "defender") {
      actionsHtml = `<button type="button" class="axv-btn axv-action-btn" data-action="ready">Valider mes cartes</button>`;
    } else if (role === "gm") {
      actionsHtml = `<button type="button" class="axv-btn secondary axv-action-btn" data-action="end">Terminer le combat</button>`;
    }

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
        <div class="axv-actions">${actionsHtml}</div>
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
        Round <strong>${Number(view.round || 1)}</strong> — Initiative : <strong>${CombatManager.#esc(view.initiative.winner === "attacker" ? view.attacker.name : view.defender.name)}</strong>
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
      const pickedAttack = played.find(p => p.zone === "attack") || side.picked?.attack || null;
      const pickedDefense = played.find(p => p.zone === "defense") || side.picked?.defense || null;
      const backImg = "systems/arcane15/assets/axvc01_tarot_v1v1/axvc01__dos-cartes.png";
      const restriction = side.restriction || {};
      const attackOnlyJokerRule = !!restriction.mustJoker && restriction.scope === "attack";
      const choiceJokerRule = !!restriction.mustJoker && (restriction.scope === "choice" || restriction.scope === "attackOrDefense");
      const attackZoneHint = attackOnlyJokerRule
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
                if (hasAttack && !hasDefense) playable = canDefense;
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
      const ppDisabled = side.locked ? "disabled" : "";
      const primesHtml = CombatManager.AXV_PP_PRIMES.map(p => `
        <label class="axv-pp-line"><input type="checkbox" class="axv-pp-check" data-pp-side="${sideKey}" data-pp-kind="prime" data-pp-id="${p.id}" ${primesSel.includes(p.id) ? "checked" : ""} ${ppDisabled}/><span>${CombatManager.#esc(p.label)}</span></label>
      `).join("");
      const pensHtml = CombatManager.AXV_PP_PENALITES.map(p => `
        <label class="axv-pp-line"><input type="checkbox" class="axv-pp-check" data-pp-side="${sideKey}" data-pp-kind="penalite" data-pp-id="${p.id}" ${pensSel.includes(p.id) ? "checked" : ""} ${ppDisabled}/><span>${CombatManager.#esc(p.label)}</span></label>
      `).join("");
      const ppWarn = (!side.locked && primesSel.length > 0 && pensSel.length === 0) ? `<div class="axv-pp-warn">Prime sélectionnée : choisis au moins une pénalité.</div>` : "";

      return `
        <div class="axv-col axv-col--self" data-side="${sideKey}">
          <div class="axv-self-block ${sideKey === "attacker" ? "axv-self-block--red" : "axv-self-block--green"}">
            <div class="axv-block-header">
              <span class="axv-block-name">${CombatManager.#esc(side.name)}</span>
              <span class="axv-pill">${side.ready ? "VALIDÉ ✓" : (side.locked ? "VERROUILLÉ" : "EN COURS")}</span>
            </div>
            ${handHtml}
            <div class="axv-zones">
              <div class="axv-zone" data-zone="${sideKey}:attack">
                <div class="axv-zone-title"><span>Attaque</span><span class="axv-mini">${attackZoneHint}</span></div>
                <div class="axv-zone-slot">${pickedAttack ? CombatManager.#cardHtml(pickedAttack, { draggable: false }) : `<div class="axv-mini">${attackOnlyJokerRule ? "Dépose un joker" : "Dépose une carte"}</div>`}</div>
              </div>
              <div class="axv-zone" data-zone="${sideKey}:defense">
                <div class="axv-zone-title"><span>Défense</span><span class="axv-mini">Somme max : ${sommeMax}</span></div>
                <div class="axv-zone-slot">${pickedDefense ? CombatManager.#cardHtml(pickedDefense, { draggable: false }) : `<div class="axv-mini">Dépose une carte</div>`}</div>
              </div>
            </div>
            <div class="axv-pp">
              <div class="axv-pp-box"><div class="axv-zone-title"><span>Primes</span><span class="axv-mini">(coche)</span></div>${primesHtml}</div>
              <div class="axv-pp-box"><div class="axv-zone-title"><span>Pénalités</span><span class="axv-mini">(si prime)</span></div>${pensHtml}${ppWarn}</div>
            </div>
          </div>
        </div>`;
    };

    let resultHtml = "";
    if (view.resolved?.done && view.resolved?.result) {
      const r = view.resolved.result;
      const line = (label, ex) => `
        <div style="margin-top:8px;">
          <div><strong>${label}</strong></div>
          <div>${CombatManager.#esc(ex.attackerSide === "attacker" ? view.attacker.name : view.defender.name)} : <strong>${ex.atkTotal}</strong> — ${CombatManager.#esc(ex.defenderSide === "attacker" ? view.attacker.name : view.defender.name)} : <strong>${ex.defTotal}</strong></div>
          <div>Marge : <strong>${ex.margin}</strong> — ${ex.hit ? `<strong>TOUCHÉ</strong> (${ex.damage})` : `<strong>PARRÉ / ÉVITÉ</strong>`}</div>
        </div>`;
      resultHtml = `
        <div class="axv-result">
          <div><strong>Résultat du round</strong></div>
          ${line("Attaque vs Défense", r.first)}
          ${line("Défense vs Attaque", r.second)}
        </div>`;
    }

    const side = role === "attacker" ? view.attacker : (role === "defender" ? view.defender : null);
    // Mettre à jour les boutons déjà présents dans .axv-actions (pré-injectés au shell)
    const actionsDiv = root.querySelector(".axv-actions");
    if (actionsDiv) {
      const readyBtn = actionsDiv.querySelector('[data-action="ready"]');
      if (readyBtn && side) { readyBtn.disabled = !!side.locked; readyBtn.textContent = side.locked ? "Cartes validées ✓" : "Valider mes cartes"; }
      if (game.user?.isGM && !actionsDiv.querySelector('[data-action="end"]')) {
        const endBtn = document.createElement("button"); endBtn.type = "button"; endBtn.className = "axv-btn secondary axv-action-btn"; endBtn.dataset.action = "end"; endBtn.textContent = "Terminer le combat"; actionsDiv.appendChild(endBtn);
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
        defender: view.defender
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
        console.log("[ARCANE XV][COMBAT][UI] ready clicked", { sessionId, role });
        await CombatManager.#emit({
          type: "axvCombat:ready",
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

    const hookButtons = () => {
      const footer = dlg.element?.querySelector?.(".dialog-buttons, footer.window-footer, .form-footer");
      if (!footer) return;
      footer.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button");
        if (!btn) return;
        const action = btn.dataset?.button || btn.dataset?.action;
        if (!action) return;
        await runAction(action);
      }, true);
    };

    hookButtons();
  }

  static async #gmEndSession(data) {
    const { sessionId } = data;
    const session = CombatManager.#gmSessions.get(sessionId);
    if (!session) return;
    session.ended = true;
    try {
      const attackerActor = game.actors.get(session.attacker.actorId);
      const defenderActor = game.actors.get(session.defender.actorId);
      await attackerActor?.unsetFlag?.("arcane15", "lastInitiativeCombat");
      await defenderActor?.unsetFlag?.("arcane15", "lastInitiativeCombat");
    } catch (e) {
      console.warn("[ARCANE XV][COMBAT][GM] clear lastInitiativeCombat failed", e);
    }
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

  static #activeGMId() {
    const gm = game.users.find(u => u.active && u.isGM) || game.users.find(u => u.isGM);
    return gm?.id || null;
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
        if (appliedEntry?.updates?.['system.stats.vitalite'] !== undefined) {
          const beforeVit = Number(appliedEntry.beforeVit ?? 0);
          const afterVit = Number(appliedEntry.updates['system.stats.vitalite'] ?? beforeVit);
          const delta = Math.max(0, beforeVit - afterVit);
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} perd ${delta} point${delta > 1 ? 's' : ''} de Vitalité (${beforeVit} → ${afterVit})</div>`;
        } else if (appliedEntry?.updates?.['system.stats.blessures'] !== undefined) {
          const beforeBless = Number(appliedEntry.beforeBless ?? 0);
          const afterBless = Number(appliedEntry.updates['system.stats.blessures'] ?? beforeBless);
          const delta = Math.max(0, afterBless - beforeBless);
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} subit ${delta} blessure${delta > 1 ? 's' : ''} (${beforeBless} → ${afterBless})</div>`;
        } else {
          outcomeHtml = `<div style="color:#b91c1c;font-weight:900;">${defName} subit ${Number(ex.damage || 0)} dégât${Number(ex.damage || 0) > 1 ? 's' : ''}</div>`;
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
              <summary style="cursor:pointer;font-size:15px;font-weight:800;color:#374151;">Détail technique du combat</summary>
              <div style="margin-top:6px;">
                <div style="padding:6px;border-radius:6px;background:#fff7f2;border:1px solid #f0d2c0;margin-bottom:6px;">
                  ${CombatManager.#chatActorBadge(atkActor?.name || ex.attackerSide, atkActor, '#c65d2b')}
                  <div style="display:flex;gap:6px;margin-top:4px;">
                    <div style="font-size:15px;line-height:1.75;">
                      <div>Carte : <strong>${CombatManager.#esc(ex.attackCard?.name || 'Joker')}</strong> (${atkCardVal}) &nbsp;|&nbsp; ${CombatManager.#esc(ex.attackSkillLabel ?? 'Combat')} +${ex.attackSkillVal ?? '?'} &nbsp;|&nbsp; Arme ${signed(weaponMod)}${ex.atkAdj ? ` &nbsp;|&nbsp; PP ${signed(ex.atkAdj)}` : ''}</div>
                      <div style="font-size:18px;font-weight:900;color:#7a3d14;">Total Attaque : ${ex.atkTotal}</div>
                      ${ex.atkMods?.length ? `<div style="color:#7a3d14;font-style:italic;">${CombatManager.#esc(ex.atkMods.join(', '))}</div>` : ''}
                      ${ex.pp?.attacker?.primes?.length ? `<div>Primes : ${fmtPP(ex.pp.attacker.primes)}</div>` : ''}
                      ${ex.pp?.attacker?.penalites?.length ? `<div>Pénalités : ${fmtPP(ex.pp.attacker.penalites)}</div>` : ''}
                    </div>
                  </div>
                </div>

                <div style="padding:6px;border-radius:6px;background:#f4f8ff;border:1px solid #cfdbf6;">
                  ${CombatManager.#chatActorBadge(defActor?.name || ex.defenderSide, defActor, '#4467c4')}
                  <div style="display:flex;gap:6px;margin-top:4px;">
                    <div style="font-size:15px;line-height:1.75;">
                      <div>Carte : <strong>${CombatManager.#esc(ex.defenseCard?.name || 'Joker')}</strong> (${defCardVal}) &nbsp;|&nbsp; Défense +${ex.defenseSkillVal ?? '?'} &nbsp;|&nbsp; Protection +${protVal}${ex.defAdj ? ` &nbsp;|&nbsp; PP ${signed(ex.defAdj)}` : ''}</div>
                      <div style="font-size:18px;font-weight:900;color:#1e4ea1;">Total Défense : ${ex.defTotal}</div>
                      ${ex.defMods?.length ? `<div style="color:#1e4ea1;font-style:italic;">${CombatManager.#esc(ex.defMods.join(', '))}</div>` : ''}
                      ${ex.pp?.defender?.primes?.length ? `<div>Primes : ${fmtPP(ex.pp.defender.primes)}</div>` : ''}
                      ${ex.pp?.defender?.penalites?.length ? `<div>Pénalités : ${fmtPP(ex.pp.defender.penalites)}</div>` : ''}
                    </div>
                  </div>
                </div>

                <div style="margin-top:6px;padding:8px 10px;border-top:1px solid #eee;background:${ex.hit ? '#f0ffe8' : '#f7f7f7'};font-size:15px;line-height:1.6;">
                  <div><strong>${ex.atkTotal}</strong> vs <strong>${ex.defTotal}</strong> → Marge <strong>${ex.margin}</strong> — ${ex.hit ? `<strong style="color:#236c2b;">TOUCHÉ</strong>` : `<strong style="color:#888;">PARRÉ / ÉVITÉ</strong>`}</div>
                  ${ex.hit ? `<div style="font-size:18px;font-weight:900;color:#b91c1c;">Dégâts : ${ex.damage}${ex.damageMods?.length ? ` <span style="font-weight:500;color:#7a3d14;">(${CombatManager.#esc(ex.damageMods.join(', '))})</span>` : ''}</div>` : ''}
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

  chat.addEventListener('wheel', (ev) => {
    console.log('[ARCANE XV][CHAT][WHEEL]', {
      deltaY: ev.deltaY,
      cancelable: ev.cancelable,
      defaultPrevented: ev.defaultPrevented,
      target: ev.target?.className || ev.target?.tagName || null,
      before: chat.scrollTop
    });

    requestAnimationFrame(() => {
      console.log('[ARCANE XV][CHAT][WHEEL][AFTER]', { after: chat.scrollTop });
    });
  }, { passive: true });

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
