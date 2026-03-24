export class AtoutArcaneData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      arcaneId: new fields.StringField({ initial: "" }),
      arcaneNumber: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      linked: new fields.BooleanField({ initial: true }),
      active: new fields.BooleanField({ initial: false }),
      currentEffect: new fields.HTMLField({ initial: "" }),
      heroicEffect: new fields.HTMLField({ initial: "" }),
      heroicCost: new fields.NumberField({ initial: 1, integer: true, min: 0 }),
      sataniste: new fields.StringField({ initial: "" }),
      possessionLevel: new fields.NumberField({ initial: 0, integer: true, min: 0, max: 6 }),
      possessionEffect: new fields.StringField({ initial: "" }),
      lastHeroicAt: new fields.NumberField({ initial: 0, integer: true, min: 0 }),
      notes: new fields.HTMLField({ initial: "" })
    };
  }
}
