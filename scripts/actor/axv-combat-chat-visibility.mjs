/**
 * Arcane XV — séparation des cartes de combat Joueurs / MJ.
 *
 * Le moteur de combat continue de produire sa carte technique complète.
 * Ce module intercepte uniquement les cartes de résolution de combat et crée :
 * - une version Joueurs, expurgée des informations techniques réservées au MJ ;
 * - une version MJ, contenant la carte complète d'origine.
 *
 * Les deux messages sont des whispers distincts : les données MJ ne sont donc
 * jamais envoyées dans le document ChatMessage destiné aux joueurs.
 */

const AXV_COMBAT_VISIBILITY_FLAG = "combatVisibilitySplit";

function axvCombatIsResolutionCard(message) {
  const flags = message?.flags?.arcane15 || {};
  if (!flags.customCard || flags[AXV_COMBAT_VISIBILITY_FLAG]) return false;

  const content = String(message?.content || "");
  return content.includes("⚔ Combat —") || content.includes("⚔ Kill Bill");
}

function axvCombatCloneMessageBase(message) {
  return {
    speaker: foundry.utils.deepClone(message?.speaker || { alias: "" }),
    style: message?.style ?? CONST.CHAT_MESSAGE_STYLES?.OTHER ?? 0,
    flags: foundry.utils.deepClone(message?.flags || {})
  };
}

function axvCombatRemoveElement(el) {
  try { el?.remove?.(); } catch (_) {}
}

function axvCombatBuildPlayerHtml(fullHtml) {
  const host = document.createElement("div");
  host.innerHTML = String(fullHtml || "");

  // Le détail technique est strictement réservé au MJ.
  host.querySelectorAll("details").forEach(axvCombatRemoveElement);

  // Supprime les blocs/lignes contenant les informations de calcul internes.
  const gmOnlyPatterns = [
    /^Compétence\s*:/i,
    /^Arme\s*:/i,
    /^Protection\s*:/i,
    /^États\s*:/i,
    /^PP\s*:/i,
    /^Primes\s*:/i,
    /^Pénalités\s*:/i,
    /Primes\/Pénalités/i,
    /Risque\s*\([^)]*\)\s*:\s*incident possible\s*\(MJ décide\)/i
  ];

  const candidates = Array.from(host.querySelectorAll("div, span, p, li"));
  // Parcours du plus profond au plus haut pour ne pas supprimer un conteneur
  // global lorsque seule une ligne enfant contient une donnée MJ.
  candidates
    .sort((a, b) => {
      const depth = (n) => { let d = 0; while (n?.parentElement) { d += 1; n = n.parentElement; } return d; };
      return depth(b) - depth(a);
    })
    .forEach((el) => {
      if (!host.contains(el)) return;
      const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return;

      // Résumé PP du bandeau supérieur : "Nom P: ... / Pén: ..."
      const isPpSummary = /\bP\s*:\s*.*\/\s*Pén\s*:/i.test(text);
      const directMatch = gmOnlyPatterns.some((rx) => rx.test(text));

      if (!isPpSummary && !directMatch) return;

      // Ne supprimer qu'une ligne feuille ou un petit bloc technique,
      // jamais la carte de combat entière.
      const childBlocks = el.querySelectorAll(":scope > div, :scope > p, :scope > span, :scope > li").length;
      if (childBlocks <= 2 || el.tagName === "SPAN" || el.tagName === "P" || el.tagName === "LI") {
        axvCombatRemoveElement(el);
      }
    });

  // Nettoie les conteneurs devenus vides après retrait des données MJ.
  Array.from(host.querySelectorAll("div, span"))
    .reverse()
    .forEach((el) => {
      if (!host.contains(el)) return;
      const hasMedia = !!el.querySelector("img, strong");
      const text = String(el.textContent || "").trim();
      if (!hasMedia && !text && el.children.length === 0) axvCombatRemoveElement(el);
    });

  return host.innerHTML;
}

async function axvCombatCreateSplitMessages(message) {
  const gmIds = (game.users || []).filter((u) => u.isGM).map((u) => u.id);
  const playerIds = (game.users || []).filter((u) => !u.isGM).map((u) => u.id);
  const base = axvCombatCloneMessageBase(message);
  const fullHtml = String(message?.content || "");
  const playerHtml = axvCombatBuildPlayerHtml(fullHtml);

  if (playerIds.length) {
    const playerFlags = foundry.utils.deepClone(base.flags || {});
    playerFlags.arcane15 ||= {};
    playerFlags.arcane15[AXV_COMBAT_VISIBILITY_FLAG] = true;
    playerFlags.arcane15.combatVisibility = "player";

    await ChatMessage.create({
      ...base,
      content: playerHtml,
      whisper: playerIds,
      blind: false,
      flags: playerFlags
    });
  }

  if (gmIds.length) {
    const gmFlags = foundry.utils.deepClone(base.flags || {});
    gmFlags.arcane15 ||= {};
    gmFlags.arcane15[AXV_COMBAT_VISIBILITY_FLAG] = true;
    gmFlags.arcane15.combatVisibility = "gm";

    await ChatMessage.create({
      ...base,
      content: fullHtml,
      whisper: gmIds,
      blind: false,
      flags: gmFlags
    });
  }

  console.log("[ARCANE XV][COMBAT][CHAT][VISIBILITY] split card created", {
    players: playerIds.length,
    gms: gmIds.length,
    playerLength: playerHtml.length,
    gmLength: fullHtml.length
  });
}

Hooks.on("preCreateChatMessage", (message) => {
  try {
    if (!game.user?.isGM) return;
    if (!axvCombatIsResolutionCard(message)) return;

    // Annule le message unique d'origine. Les deux cartes distinctes sont
    // créées juste après, avec un flag anti-récursion.
    queueMicrotask(() => {
      axvCombatCreateSplitMessages(message).catch((error) => {
        console.error("[ARCANE XV][COMBAT][CHAT][VISIBILITY] split failed", error);
      });
    });

    return false;
  } catch (error) {
    console.error("[ARCANE XV][COMBAT][CHAT][VISIBILITY] preCreate error", error);
  }
});
