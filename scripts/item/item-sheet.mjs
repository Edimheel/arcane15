const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class Arcane15AtoutArcaneSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["arcane15", "sheet", "item", "atout-arcane"],
    position: { width: 640, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false }
  };

  static PARTS = {
    sheet: { template: "systems/arcane15/templates/item-atout-arcane-sheet.hbs" }
  };

  async _prepareContext() {
    return {
      item: this.document,
      system: this.document.system,
      isEmbedded: !!this.document.parent,
      canEdit: this.document.isOwner
    };
  }
}
