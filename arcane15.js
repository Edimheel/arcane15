/**
 * Point d'entrée principal du système Arcane XV
 */
import { PersonnageData, CardData } from "./scripts/actor/data-models.mjs";
import { AtoutArcaneData } from "./scripts/item/data-models.mjs";
import { Arcane15ActorSheet } from "./scripts/actor/actor-sheet.mjs";
import { Arcane15AtoutArcaneSheet } from "./scripts/item/item-sheet.mjs";
import { CardManager } from "./scripts/actor/card-manager.mjs";
import "./scripts/actor/axv-combat.mjs";
import { ArcanaManager } from "./scripts/arcana/axv-arcana-manager.mjs";

Hooks.once("init", () => {
  console.log("Arcane 15 | Initialisation du Système (V13)", {
    systemId: game.system.id,
    systemVersion: game.system.version,
    user: game.user?.name,
    isGM: game.user?.isGM
  });

  CONFIG.Actor.dataModels.personnage = PersonnageData;
  CONFIG.Card.dataModels.base = CardData;
  CONFIG.Item.dataModels.atoutArcane = AtoutArcaneData;

  ArcanaManager.init();
  globalThis.AXVArcanaManager = ArcanaManager;
  game.arcane15 = game.arcane15 || {};
  game.arcane15.ArcanaManager = ArcanaManager;
  game.arcane15.CardManager = CardManager;

  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  const BaseActor = foundry.documents.BaseActor;
  const BaseItem = foundry.documents.BaseItem;

  DocumentSheetConfig.registerSheet(BaseActor, "arcane15", Arcane15ActorSheet, {
    types: ["personnage"],
    makeDefault: true,
    label: "Fiche Personnage Arcane XV"
  });

  DocumentSheetConfig.registerSheet(BaseItem, "arcane15", Arcane15AtoutArcaneSheet, {
    types: ["atoutArcane"],
    makeDefault: true,
    label: "Atout d'arcane majeur"
  });
});

Hooks.once("ready", async () => {
  console.log("Arcane 15 | READY", {
    user: game.user?.name,
    isGM: game.user?.isGM,
    channel: `system.${game.system.id}`
  });

  CardManager.ensureSocket();
  await ArcanaManager.ready();
});

Hooks.on("createActor", async (actor) => {
  try {
    console.log("[ARCANE15] createActor -> initActorDecks", { actor: actor?.name, id: actor?.id });
    await CardManager.initActorDecks(actor);
  } catch (e) {
    console.error("[ARCANE15] createActor initActorDecks ERROR", e);
  }
});

Hooks.on("updateActor", async (actor, changes, _opts, userId) => {
  try {
    if (changes?.ownership) {
      console.log("[ARCANE15] updateActor ownership change detected", {
        actor: actor?.name,
        actorId: actor?.id,
        byUserId: userId,
        changesOwnership: changes.ownership
      });
      await CardManager.syncCardsOwnership(actor);
    }
    if (changes?.items || changes?.system) ArcanaManager.renderPublicBanner();
  } catch (e) {
    console.error("[ARCANE15] updateActor ERROR", e);
  }
});
