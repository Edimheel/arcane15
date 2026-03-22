/**
 * Point d'entrée principal du système Arcane XV
 */
import { PersonnageData, CardData } from "./scripts/actor/data-models.mjs";
import { Arcane15ActorSheet } from "./scripts/actor/actor-sheet.mjs";
import { CardManager } from "./scripts/actor/card-manager.mjs";
import "./scripts/actor/axv-combat.mjs";


Hooks.once("init", () => {
  console.log("Arcane 15 | Initialisation du Système (V13)", {
    systemId: game.system.id,
    systemVersion: game.system.version,
    user: game.user?.name,
    isGM: game.user?.isGM
  });

  // Modèle pour l'Acteur "Personnage"
  CONFIG.Actor.dataModels.personnage = PersonnageData;

  // Modèle pour la Carte "Base"
  CONFIG.Card.dataModels.base = CardData;

  // Feuille de perso
  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  const BaseActor = foundry.documents.BaseActor;

  DocumentSheetConfig.registerSheet(BaseActor, "arcane15", Arcane15ActorSheet, {
    types: ["personnage"],
    makeDefault: true,
    label: "Fiche Personnage Arcane XV"
  });
});

Hooks.once("ready", () => {
  console.log("Arcane 15 | READY", {
    user: game.user?.name,
    isGM: game.user?.isGM,
    channel: `system.${game.system.id}`
  });

  // Socket CardManager côté MJ + joueurs
  CardManager.ensureSocket();
});

/**
 * Hook : Création d'un Acteur
 * Déclenche la génération automatique des piles de cartes (Tarot)
 */
Hooks.on("createActor", async (actor) => {
  try {
    console.log("[ARCANE15] createActor -> initActorDecks", { actor: actor?.name, id: actor?.id });
    await CardManager.initActorDecks(actor);
  } catch (e) {
    console.error("[ARCANE15] createActor initActorDecks ERROR", e);
  }
});

/**
 * CRUCIAL :
 * Quand l’ownership de l’acteur change (on assigne enfin un joueur),
 * on propage ça aux piles Cards (deck/hand/pile).
 */
Hooks.on("updateActor", async (actor, changes, _opts, userId) => {
  try {
    if (!changes?.ownership) return;
    console.log("[ARCANE15] updateActor ownership change detected", {
      actor: actor?.name,
      actorId: actor?.id,
      byUserId: userId,
      changesOwnership: changes.ownership
    });
    await CardManager.syncCardsOwnership(actor);
  } catch (e) {
    console.error("[ARCANE15] updateActor syncCardsOwnership ERROR", e);
  }
});
