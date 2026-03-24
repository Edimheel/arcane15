// systems/arcane15/scripts/actor-sheet.mjs
import { CardManager } from "./card-manager.mjs";
import { CombatManager } from "./axv-combat.mjs";
import { ArcanaManager } from "../arcana/axv-arcana-manager.mjs";
const { DialogV2 } = foundry.applications.api;
console.log("%c[ARCANE XV][SHEET] actor-sheet.mjs loaded (V2-only)", "color:#9b59b6;font-weight:900;");

// Initiative UI is orchestrated by axv-combat (DialogV2). Actor sheet must not open a local dialog.
const AXV_INIT_UI_LOCAL = false;

// FIX CRUCIAL: ActorSheetV2 n'est PAS dans foundry.applications.api chez toi.
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

console.log("[ARCANE XV][SHEET] base classes", {
  hasHandlebarsApplicationMixin: !!HandlebarsApplicationMixin,
  hasActorSheetV2: !!ActorSheetV2
});

const AXV_HAND_SHEET_HOOKS_KEY = "__arcane15HandSheetHooksRegistered";
const AXV_HAND_RENDER_QUEUE = new Map();

function axvCollectCardsContainerIds(docOrDocs) {
  const ids = new Set();
  const docs = Array.isArray(docOrDocs) ? docOrDocs : [docOrDocs];

  for (const doc of docs) {
    if (!doc) continue;

    if (doc.documentName === "Card") {
      const parent = doc.parent;
      if (parent?.documentName === "Cards" && parent.id) ids.add(parent.id);
      continue;
    }

    if (doc.documentName === "Cards" && doc.id) ids.add(doc.id);
  }

  return ids;
}

function axvRenderOpenSheetsForCards(ids) {
  if (!ids?.size) return;

  for (const actor of game.actors ?? []) {
    const handId = actor.getFlag?.("arcane15", "hand");
    const deckId = actor.getFlag?.("arcane15", "deck");
    const pileId = actor.getFlag?.("arcane15", "pile");
    if (!ids.has(handId) && !ids.has(deckId) && !ids.has(pileId)) continue;

    const queued = AXV_HAND_RENDER_QUEUE.get(actor.id);
    if (queued) clearTimeout(queued);

    AXV_HAND_RENDER_QUEUE.set(actor.id, setTimeout(() => {
      AXV_HAND_RENDER_QUEUE.delete(actor.id);
      for (const app of Object.values(actor.apps ?? {})) {
        if (app?.rendered) app.render(false);
      }
    }, 50));
  }
}

function axvRegisterHandSheetHooks() {
  if (globalThis[AXV_HAND_SHEET_HOOKS_KEY]) return;
  globalThis[AXV_HAND_SHEET_HOOKS_KEY] = true;

  const rerenderFromDoc = (doc) => axvRenderOpenSheetsForCards(axvCollectCardsContainerIds(doc));

  for (const hookName of ["createCard", "updateCard", "deleteCard", "createCards", "updateCards", "deleteCards"]) {
    Hooks.on(hookName, (doc) => rerenderFromDoc(doc));
  }
}

axvRegisterHandSheetHooks();

export class Arcane15ActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["arcane15", "sheet", "actor"],
    position: { width: 1180, height: 980 },
    window: { resizable: true },
    tabs: [{
      navSelector: ".sheet-tabs",
      contentSelector: ".sheet-body",
      initial: "competences",
      group: "primary"
    }],
    form: {
      submitOnChange: true,
      closeOnSubmit: false
      // IMPORTANT: pas de handler custom ici -> on laisse ActorSheetV2 gérer les updates
    }
  };

  static PARTS = {
    sheet: { template: "systems/arcane15/templates/actor-sheet.hbs" }
  };

  async _prepareContext(options) {
    const actor = this.document;

    const canViewHand = actor.isOwner && !(game.user?.isGM && actor.hasPlayerOwner);

    const context = {
      actor,
      system: actor.system,
      source: actor.toObject(),
      canViewHand,
      cards: [],
      enrichedDescription: {
        arcanes: "",
        equipement: "",
        notes: ""
      },
      enrichedAtoutsPersonnage: "",
      characterAtoutCards: ArcanaManager.getCharacterAtouts(actor),
      arcaneAtouts: ArcanaManager.getActorArcana(actor),
      canManageArcana: actor.isOwner || game.user?.isGM
    };

    const enrichOptions = {
      secrets: actor.isOwner,
      rollData: actor.getRollData?.() ?? {},
      relativeTo: actor
    };

    context.enrichedDescription.arcanes = await TextEditor.enrichHTML(actor.system?.description?.arcanes ?? "", enrichOptions);
    context.enrichedDescription.equipement = await TextEditor.enrichHTML(actor.system?.description?.equipement ?? "", enrichOptions);
    context.enrichedDescription.notes = await TextEditor.enrichHTML(actor.system?.description?.notes ?? "", enrichOptions);
    context.enrichedAtoutsPersonnage = await TextEditor.enrichHTML(actor.system?.atouts?.personnage ?? "", enrichOptions);

    // Main (hand) si déjà initialisée
    const handId = actor.getFlag("arcane15", "hand");
    if (canViewHand && handId) {
      const hand = game.cards.get(handId);
      if (hand) {
        // On prépare un tableau exploitable côté HBS
        context.cards = hand.cards.contents
          .map(c => {
            const v = Number(c.flags?.arcane15?.value ?? 0);
            const suit = c.flags?.arcane15?.suit ?? "";
            const img = CardManager._getCardImg?.(c) || c.img || "icons/svg/hazard.svg";
            const name = CardManager._getCardName?.(c) || c.name || "Carte";
            const isJoker = CardManager._isJoker?.(c) ?? false;
            return { id: c.id, value: v, suit, img, name, isJoker };
          })
          .sort((a, b) => {
            // Joker d’abord (valeur 0) puis croissant
            if (a.isJoker && !b.isJoker) return -1;
            if (!a.isJoker && b.isJoker) return 1;
            return a.value - b.value;
          });
      }
    }

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    console.log("[ARCANE XV][SHEET] render", {
      actor: this.document?.name,
      user: game.user?.name,
      isGM: game.user?.isGM
    });

    // FIX ONGLET VIDE : on force l’activation et l’affichage des .tab
    this.#manageTabs();
    try {
      ArcanaManager.bindSheet(this);
    } catch (e) {
      console.error("[ARCANE XV][ARCANA] bindSheet failed", e);
    }

    // --- Portrait click → FilePicker ---
    const portrait = this.element.querySelector(".character-portrait[data-edit='img']");
    if (portrait) {
      portrait.addEventListener("click", async () => {
        const fp = new FilePicker({
          type: "image",
          current: this.document.img || "",
          callback: async (path) => {
            try {
              await this.document.update({ img: path });
            } catch (e) {
              console.error("[ARCANE XV][SHEET] portrait update failed", e);
              ui.notifications?.error?.("Impossible de mettre à jour le portrait.");
            }
          }
        });
        fp.browse();
      });
    }

    // --- Skill roll ---
    this.element.querySelectorAll(".skill-roll").forEach(label => {
      label.addEventListener("click", this.#onSkillRoll.bind(this));
    });

    // --- Skill change / focus restore ---
    this.element.querySelectorAll(".score-input").forEach(input => {
      input.addEventListener("focusin", this.#onSkillFocus.bind(this));
      input.addEventListener("keydown", this.#onSkillKeyDown.bind(this));
      input.addEventListener("change", this.#onSkillChange.bind(this));
    });

    // --- La main affichée sur la fiche est purement informative : pas de clic ---

    // --- Rich text : contenu visible hors édition, éditeur explicite au clic ---
    this.element.querySelectorAll(".axv-richtext-box").forEach(box => {
      const toggle = box.querySelector(".axv-richtext-toggle");
      const editor = box.querySelector("prose-mirror");
      const display = box.querySelector(".axv-richtext-display");
      const source = box.querySelector(".axv-richtext-source");
      if (!toggle || !editor || !display || !source) return;

      const closeEditor = () => {
        editor.removeAttribute("open");
        editor.hidden = true;
        display.hidden = false;
        toggle.textContent = "Modifier";
      };

      const openEditor = () => {
        editor.value = String(source.value ?? "");
        editor.hidden = false;
        display.hidden = true;
        editor.setAttribute("open", "");
        toggle.textContent = "Fermer";
        requestAnimationFrame(() => {
          editor.value = String(source.value ?? "");
          const editable = editor.querySelector('[contenteditable="true"]');
          editable?.focus?.();
        });
      };

      closeEditor();

      if (!toggle.dataset.axvRichtextBound) {
        toggle.dataset.axvRichtextBound = "1";

        toggle.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (editor.hidden) openEditor();
          else closeEditor();
        });

        editor.addEventListener("open", () => {
          toggle.textContent = "Fermer";
        });

        editor.addEventListener("close", () => {
          closeEditor();
        });

        editor.addEventListener("save", async () => {
          const path = String(editor.getAttribute("name") ?? "").trim();
          if (!path) return;

          const value = String(editor.value ?? "");
          source.value = value;

          try {
            const enriched = await TextEditor.enrichHTML(value, {
              secrets: this.document.isOwner,
              rollData: this.document.getRollData?.() ?? {},
              relativeTo: this.document
            });

            display.innerHTML = enriched || "";
            await this.document.update({ [path]: value });
            closeEditor();
          } catch (e) {
            console.error("[ARCANE XV][SHEET][RICHTEXT] save failed", e);
            ui.notifications?.error?.("Impossible d'enregistrer le texte enrichi.");
          }
        });
      }
    });

    // --- Réapplique la valeur courante des selects de compétence d'arme ---
    this.element.querySelectorAll("select.axv-weapon-skill").forEach(sel => {
      const current = String(sel.dataset.current ?? "").trim();
      sel.value = current;

      if (!sel.dataset.axvWeaponSkillBound) {
        sel.dataset.axvWeaponSkillBound = "1";
        sel.addEventListener("change", async (ev) => {
          try {
            ev.stopPropagation();
            const input = ev.currentTarget;
            const value = String(input?.value ?? "").trim();
            const nameAttr = String(input?.getAttribute?.("name") ?? "").trim();
            let updatePath = nameAttr;

            if (!updatePath) {
              const row = input.closest("tr");
              const anyInput = row?.querySelector?.('input[name^="system.combat.arme"][name$=".nom"]');
              const found = String(anyInput?.getAttribute?.("name") ?? "");
              const m = found.match(/system\.combat\.(arme\d+)\.nom/);
              if (m?.[1]) updatePath = `system.combat.${m[1]}.competence`;
            }

            if (!updatePath) {
              console.warn("[ARCANE XV][SHEET][COMBAT] weapon skill change unresolved path", {
                actor: this.document?.name,
                value,
                outerHTML: input?.outerHTML || ""
              });
              return;
            }

            const updates = { [updatePath]: value };
            const currentPath = String(input?.dataset?.currentPath ?? "").trim();
            if (currentPath && currentPath !== updatePath) updates[currentPath] = value;

            console.log("[ARCANE XV][SHEET][COMBAT] weapon skill change", {
              actor: this.document?.name,
              updatePath,
              value,
              updates
            });

            input.dataset.current = value;
            await this.document.update(updates);
          } catch (e) {
            console.error("[ARCANE XV][SHEET][COMBAT][ERROR] weapon skill change", e);
            ui.notifications?.error?.("Erreur mise à jour compétence d'arme (voir console).");
          }
        });
      }
    });

    // --- Delegation combat icon (anti-doublon) ---
    if (!this._axvDelegatedClickBound) {
      this._axvDelegatedClickBound = this.#onDelegatedClick.bind(this);
      this.element.addEventListener("click", this._axvDelegatedClickBound);
      console.log("[ARCANE XV][SHEET] delegation .axv-weapon-attack bound");
    }

    // --- Initiative (clic sur la stat INITIATIVE) ---
    if (!this._axvInitClickBound) {
      const initInput = this.element.querySelector('input[name="system.stats.initiative"]');
      const initBox = initInput?.closest?.('.stat-box') || null;
      if (initBox) {
        this._axvInitClickBound = this.#onInitiativeBoxClick.bind(this);
        initBox.addEventListener("click", this._axvInitClickBound);
        console.log("[ARCANE XV][SHEET] initiative box click bound");
      } else {
        console.warn("[ARCANE XV][SHEET] initiative box not found in DOM");
      }
    }

    this.#restorePendingViewState();
  }

  #onSkillFocus(event) {
    this.#captureViewState(event.currentTarget);
  }

  #onSkillKeyDown(event) {
    if (event.key !== "Enter") return;
    this.#captureViewState(event.currentTarget);
    event.preventDefault();
    event.currentTarget?.blur?.();
  }

  #captureViewState(input) {
    const scrollContainer = this.#getScrollContainer();
    this._axvPendingViewState = {
      skillKey: String(input?.dataset?.key ?? "").trim(),
      scrollTop: scrollContainer?.scrollTop ?? 0,
      scrollLeft: scrollContainer?.scrollLeft ?? 0,
      selectionStart: typeof input?.selectionStart === "number" ? input.selectionStart : null,
      selectionEnd: typeof input?.selectionEnd === "number" ? input.selectionEnd : null
    };
  }

  #getScrollContainer() {
    const body = this.element?.querySelector?.('[data-axv-scroll-root="1"], .sheet-body') || null;
    const windowContent = this.element?.closest?.(".window-content") || null;
    const candidates = [body, windowContent].filter(Boolean);
    return candidates.find(el => (el.scrollHeight - el.clientHeight) > 4) || candidates[0] || null;
  }

  #restorePendingViewState() {
    const state = this._axvPendingViewState;
    if (!state) return;

    this._axvPendingViewState = null;

    requestAnimationFrame(() => {
      try {
        const scrollContainer = this.#getScrollContainer();
        if (scrollContainer) {
          scrollContainer.scrollTop = Number.isFinite(state.scrollTop) ? state.scrollTop : 0;
          scrollContainer.scrollLeft = Number.isFinite(state.scrollLeft) ? state.scrollLeft : 0;
        }

        if (!state.skillKey) return;

        const selector = `.score-input[data-key="${CSS.escape(state.skillKey)}"]`;
        const input = this.element?.querySelector?.(selector);
        if (!input) return;

        input.focus({ preventScroll: true });

        if (state.selectionStart !== null && typeof input.setSelectionRange === "function") {
          input.setSelectionRange(
            state.selectionStart,
            state.selectionEnd ?? state.selectionStart
          );
        }
      } catch (e) {
        console.warn("[ARCANE XV][SHEET][SKILL] restore view state failed", e);
      }
    });
  }

  async #onInitiativeBoxClick(ev) {
    try {
      ev.preventDefault();

      const actor = this.document;

      // Cible requise
      const targets = Array.from(game.user?.targets ?? []);
      const target = targets[0] || null;
      if (!target) {
        ui.notifications?.error?.("Initiative: pas de cible.");
        return;
      }

      console.log("[ARCANE XV][SHEET][INIT] click", { actor: actor.name, target: target.name });

      const sessionId = await CombatManager.startInitiative(actor, null, target, { chainCombat: false, source: "initiative" });
      if (!sessionId) return;

      

      // UI initiative: uniquement via axv-combat (DialogV2). Ici on attend.
      if (!AXV_INIT_UI_LOCAL) {
        ui.notifications?.info?.("Initiative: choix de carte demandé.");
        return;
      }
// Construire la liste de cartes (avec images)
      const handId = actor.getFlag("arcane15", "hand");
      const hand = handId ? game.cards.get(handId) : null;
      if (!hand) {
        ui.notifications?.warn?.("Initiative: main introuvable.");
        return;
      }

      const cards = hand.cards.contents
        .map(c => {
          const v = Number(c.flags?.arcane15?.value ?? 0);
          const suit = c.flags?.arcane15?.suit ?? "";
          const img = CardManager._getCardImg?.(c) || c.img || "icons/svg/hazard.svg";
          const name = CardManager._getCardName?.(c) || c.name || "Carte";
          const isJoker = CardManager._isJoker?.(c) ?? false;
          return { id: c.id, value: v, suit, img, name, isJoker };
        })
        .sort((a, b) => {
          if (a.isJoker && !b.isJoker) return -1;
          if (!a.isJoker && b.isJoker) return 1;
          return a.value - b.value;
        });

      const reflexesTotal = Number(actor?.system?.competences?.reflexes?.total ?? actor?.system?.competences?.reflexes?.val ?? 0);

      const cardsHtml = cards.map(c => {
        const badge = c.isJoker ? "JOKER" : `${c.value}${c.suit ? " • " + c.suit : ""}`;
        return `
          <button type="button" class="axv-init-card" data-card-id="${c.id}"
            style="display:flex;flex-direction:column;gap:0.25rem;align-items:center;justify-content:center;padding:0.35rem;border:1px solid rgba(255,255,255,0.18);border-radius:10px;background:rgba(0,0,0,0.12);cursor:pointer;">
            <img src="${c.img}" alt="${c.name}" style="width:72px;height:108px;object-fit:cover;border-radius:6px;"/>
            <div style="font-weight:700;font-size:0.82rem;text-align:center;line-height:1.1;">${c.name}</div>
            <div style="font-size:0.78rem;opacity:0.92;">${badge}</div>
          </button>
        `;
      }).join("");

      const dialogId = `axv-init-local-${sessionId}-${actor.id}-${game.user.id}`;
      const html = `
        <div id="${dialogId}" style="display:flex;flex-direction:column;gap:0.6rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
            <div style="opacity:0.9;">Réflexes: <b>${reflexesTotal}</b></div>
            <div style="opacity:0.9;">Choisis une carte pour l'initiative.</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">${cardsHtml}</div>
          <div style="margin-top:0.25rem;font-size:0.8rem;opacity:0.85;">Rappel: Initiative = Réflexes + valeur de la carte. (Option B: en cas d'égalité, relancer.)</div>
        </div>
      `;

      const dlg = new DialogV2({
        window: { title: `Initiative — ${actor.name}` },
        content: html,
        buttons: [{ action: "close", label: "Fermer", default: true }],
        rejectClose: false
      });

      await dlg.render({ force: true });

      try {
        const wc = dlg.element?.closest?.(".app")?.querySelector?.(".window-content");
        if (wc) {
          wc.style.background = "rgba(0,0,0,0.85)";
          wc.style.backdropFilter = "blur(2px)";
        }
      } catch (_) {}

      dlg.element?.addEventListener?.("click", async (e) => {
        const btn = e.target?.closest?.(".axv-init-card");
        if (!btn) return;
        e.preventDefault();

        const cardId = btn.dataset.cardId;
        console.log("[ARCANE XV][SHEET][INIT] choose", { actor: actor.name, sessionId, cardId });
        try {
          await CombatManager.submitInitiativeChoice(sessionId, "attacker", actor.id, cardId);
        } catch (err) {
          console.error("[ARCANE XV][SHEET][INIT][ERROR] submit", err);
        }
        try { dlg.close(); } catch (_) {}
      });

    } catch (e) {
      console.error("[ARCANE XV][SHEET][INIT][ERROR]", e);
      ui.notifications?.error?.("Erreur initiative (voir console)." );
    }
  }

  async #onSkillRoll(event) {
    const interactiveTarget = event.target?.closest?.('input, textarea, select, option, button, [contenteditable=""], [contenteditable="true"]');
    if (interactiveTarget) {
      console.log("[ARCANE XV][SHEET][SKILL] interactive field click ignored", {
        actor: this.document?.name,
        tag: interactiveTarget.tagName,
        name: interactiveTarget.getAttribute?.("name") || ""
      });
      return;
    }

    event.preventDefault();
    const skillKey = event.currentTarget?.dataset?.key;
    console.log("[ARCANE XV][SHEET][SKILL] click", { actor: this.document?.name, skillKey });
    if (!skillKey) return;

    try {
      await CardManager.rollSkill(this.document, skillKey);
    } catch (e) {
      console.error("[ARCANE XV][SHEET][SKILL][ERROR]", e);
      ui.notifications?.error?.("Erreur compétence (voir console).");
    }
  }

  async #onCardClick(event) {
    event.preventDefault();
    const cardId = event.currentTarget?.dataset?.id;
    console.log("[ARCANE XV][SHEET][HAND] click", { actor: this.document?.name, cardId });
    if (!cardId) return;

    try {
      await CardManager.playCard(this.document, cardId);
    } catch (e) {
      console.error("[ARCANE XV][SHEET][HAND][ERROR]", e);
      ui.notifications?.error?.("Erreur carte (voir console).");
    }
  }

  async #onSkillChange(event) {
    const input = event.target;
    const skillKey = input?.dataset?.key;
    const newTotal = Number(input?.value ?? 0);

    this.#captureViewState(input);

    if (!skillKey) return;

    const current = this.document.system?.competences?.[skillKey];
    if (!current) return;

    const isSpecialized = !!current.specialisation;
    const newBase = isSpecialized ? (newTotal - 2) : newTotal;

    console.log("[ARCANE XV][SHEET][SKILL] change", {
      actor: this.document?.name,
      skillKey,
      newTotal,
      isSpecialized,
      newBase
    });

    try {
      await this.document.update({ [`system.competences.${skillKey}.val`]: newBase });
    } catch (e) {
      console.error("[ARCANE XV][SHEET][SKILL][ERROR] update", e);
      ui.notifications?.error?.("Erreur update compétence (voir console).");
    }
  }

  async #onDelegatedClick(ev) {
    try {
      const atk = ev.target?.closest?.(".axv-weapon-attack");
      if (!atk) return;

      ev.preventDefault();

      const actor = this.document;
      const targetTag = ev.target?.tagName;
      const currentTargetTag = atk?.tagName;

      console.log("[ARCANE XV][SHEET][COMBAT] click attack icon", {
        actor: actor?.name,
        user: game.user?.name,
        isGM: game.user?.isGM,
        targetTag,
        currentTargetTag
      });

      // Debug dataset / attributs
      console.log("[ARCANE XV][SHEET][COMBAT] atk element debug", {
        outerHTML: atk.outerHTML,
        dataset: atk.dataset,
        attr_data_weapon_key: atk.getAttribute("data-weapon-key"),
        attr_data_weaponKey: atk.getAttribute("data-weaponKey"),
        attr_data_weapon: atk.getAttribute("data-weapon")
      });

      // 1) weaponKey depuis dataset / attributs (HBS doit fournir data-weapon-key)
      let weaponKey =
        atk.dataset?.weaponKey ||
        atk.getAttribute("data-weapon-key") ||
        atk.getAttribute("data-weaponKey") ||
        atk.dataset?.weapon ||
        atk.getAttribute("data-weapon") ||
        "";

      // 2) fallback: résoudre via la ligne (tr) si besoin
      if (!weaponKey) {
        const tr = atk.closest("tr");
        const inp = tr?.querySelector?.('input[name^="system.combat.arme"][name$=".nom"]');
        const found = inp?.getAttribute?.("name") || "";
        const m = found.match(/system\.combat\.(arme\d+)\.nom/);
        if (m?.[1]) {
          weaponKey = m[1];
          console.log("[ARCANE XV][SHEET][COMBAT] weaponKey fallback by row", {
            foundInputName: found,
            resolved: weaponKey
          });
        }
      }

      if (!weaponKey) {
        console.error("[ARCANE XV][SHEET][COMBAT][ERROR] weaponKey missing", { atk });
        ui.notifications?.error?.("Combat: weaponKey manquant sur le bouton.");
        return;
      }

      const weapon = actor.system?.combat?.[weaponKey];
      console.log("[ARCANE XV][SHEET][COMBAT] weapon resolved", { weaponKey, weapon });

      if (!weapon || !weapon.nom) {
        ui.notifications?.error?.("Combat: arme introuvable (ou vide).");
        return;
      }

      // Cible: token sélectionné/targeté (cible “T” Foundry)
      const targets = Array.from(game.user?.targets ?? []);
      const target = targets[0] || null;

      console.log("[ARCANE XV][SHEET][COMBAT] target resolve", {
        targetsCount: targets.length,
        targetName: target?.name,
        targetId: target?.id
      });

      if (!target) {
        ui.notifications?.error?.("Combat: aucune cible sélectionnée sur la scène.");
        return;
      }

      // Interprétation simple de "degats" pour préparer l’UI (ex: "+1", "-1", "2")
      const rawDegats = String(weapon.degats ?? "").trim();
      const parsedAttackMod = Number.parseInt(rawDegats.replace(/[^\d\-+]/g, ""), 10);
      const attackMod = Number.isFinite(parsedAttackMod) ? parsedAttackMod : 0;

      const weaponRawSnapshot = foundry?.utils?.deepClone
        ? foundry.utils.deepClone(weapon)
        : JSON.parse(JSON.stringify(weapon ?? {}));
      console.log("[ARCANE XV][SHEET][COMBAT] weapon raw snapshot", {
        weaponKey,
        weapon: weaponRawSnapshot
      });

      const row = atk.closest("tr");
      const selectSkill = row?.querySelector?.('select[name^="system.combat.' + weaponKey + '."][name*="compet"], select[name^="system.combat.' + weaponKey + '."][name*="skill"], select.axv-weapon-skill');
      const selectedOption = selectSkill?.selectedOptions?.[0] ?? null;
      const selectedValue = String(selectSkill?.value ?? "").trim();
      const selectedLabel = String(selectedOption?.textContent ?? "").trim();

      const rawSkillLabel = String(
        selectedLabel ||
        selectedValue ||
        weapon.skillLabel ||
        weapon.competenceLabel ||
        weapon.combatLabel ||
        weapon.skill ||
        weapon.competence ||
        weapon.competenceCombat ||
        weapon.combatSkill ||
        weapon.typeCombat ||
        ""
      ).trim();

      const rawSkillKey = String(
        weapon.skillKey ||
        weapon.competenceKey ||
        weapon.combatSkillKey ||
        selectedValue ||
        rawSkillLabel ||
        ""
      ).trim();

      const weaponPayload = {
        weaponKey,
        name: weapon.nom,
        degats: rawDegats,    // conservé tel quel
        attackMod,            // utile pour l’UI / calcul d’attaque si tu t’en sers ainsi
        portee: weapon.portee ?? "",
        munitions: weapon.munitions ?? "",
        skillLabel: rawSkillLabel,
        skillKey: rawSkillKey,
        competence: rawSkillLabel,
        competenceLabel: rawSkillLabel,
        combatLabel: rawSkillLabel,
        skill: rawSkillLabel,
        competenceKey: rawSkillKey,
        combatSkillKey: rawSkillKey
      };

      console.log("[ARCANE XV][SHEET][COMBAT] weapon payload", weaponPayload);

      // Lancement interface combat (logique dans axv-combat.mjs)
      if (!CombatManager?.openAttackFromWeapon) {
        console.error("[ARCANE XV][SHEET][COMBAT][ERROR] CombatManager.openAttackFromWeapon missing", { CombatManager });
        ui.notifications?.error?.("Combat: CombatManager indisponible (voir console).");
        return;
      }

      // Mémorise l'arme utilisée (utile pour l'ouverture du combat après initiative)
      try {
        await actor.setFlag("arcane15", "lastWeaponKey", weaponKey);
      } catch (e) {
        console.warn("[ARCANE XV][SHEET][COMBAT] cannot set lastWeaponKey", e);
      }

      await CombatManager.openAttackFromWeapon(actor, weaponKey);
} catch (e) {
      console.error("[ARCANE XV][SHEET][COMBAT][ERROR]", e);
      ui.notifications?.error?.("Erreur combat (voir console).");
    }
  }


  async _onDrop(event) {
    const handled = await ArcanaManager.handleActorSheetDrop(this, event);
    if (handled) return handled;
    return super._onDrop?.(event);
  }

  // ============================================================
  // FIX ONGLET VIDE — gestion tabs minimale
  // ============================================================
  #manageTabs() {
    const tabs = this.element.querySelectorAll(".sheet-tabs .item");
    const contents = this.element.querySelectorAll(".sheet-body .tab");

    console.log("[ARCANE XV][SHEET] manageTabs", {
      tabs: tabs.length,
      contents: contents.length
    });

    const activate = (tabName) => {
      console.log("[ARCANE XV][SHEET] activate tab", { tabName });

      tabs.forEach(t => {
        const on = t.dataset.tab === tabName;
        t.classList.toggle("active", on);
      });

      contents.forEach(c => {
        const on = c.dataset.tab === tabName;
        c.classList.toggle("active", on);
        c.style.display = on ? "block" : "none";
      });

      this._lastActiveTab = tabName;
    };

    tabs.forEach(tab => {
      tab.addEventListener("click", (ev) => {
        ev.preventDefault();
        const name = ev.currentTarget.dataset.tab;
        console.log("[ARCANE XV][SHEET] tab click", { name });
        activate(name);
      });
    });

    const initial = this._lastActiveTab || "competences";
    activate(initial);
  }
}