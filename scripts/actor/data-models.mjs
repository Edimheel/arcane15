/**
 * Définition des Modèles de Données (Data Models) pour Arcane XV
 * Compatible Foundry V13
 */

/**
 * Modèle de données pour l'Acteur "Personnage"
 */
export class PersonnageData extends foundry.abstract.TypeDataModel {
  
  static defineSchema() {
    const fields = foundry.data.fields;

    // Helper pour créer une compétence standard
    const skill = () => new fields.SchemaField({
      label: new fields.StringField({initial: ""}), // Pour les précisions (ex: Art (Peinture))
      val: new fields.NumberField({initial: 0, integer: true, min: 0}),
      specialisation: new fields.BooleanField({initial: false})
    });

    // Helper pour créer une arme
    const weapon = () => new fields.SchemaField({
      nom: new fields.StringField({initial: ""}),
      degats: new fields.StringField({initial: ""}),
      portee: new fields.StringField({initial: ""}),
      munitions: new fields.StringField({initial: ""}),
      skillKey: new fields.StringField({initial: ""})
    });

    return {
      // --- BIOGRAPHIE ---
      biographie: new fields.SchemaField({
        nom: new fields.StringField({initial: ""}),
        profession: new fields.StringField({initial: ""}),
        unSecret: new fields.StringField({initial: ""}),
        unePassion: new fields.StringField({initial: ""}),
        unTic: new fields.StringField({initial: ""})
      }),

      // --- STATISTIQUES ---
      stats: new fields.SchemaField({
        destin: new fields.NumberField({initial: 0, integer: true}),
        vitalite: new fields.NumberField({initial: 10, integer: true}),
        blessures: new fields.NumberField({initial: 0, integer: true}),
        // Champs ajoutés pour le Header
        sommeMax: new fields.NumberField({initial: 12, integer: true}), 
        initiative: new fields.NumberField({initial: 0, integer: true}),
        protection: new fields.NumberField({initial: 0, integer: true}) 
      }),

      // --- COMBAT (4 Armes) ---
      combat: new fields.SchemaField({
        arme1: weapon(),
        arme2: weapon(),
        arme3: weapon(),
        arme4: weapon()
      }),

      // --- DESCRIPTION & NOTES ---
      description: new fields.SchemaField({
        arcanes: new fields.HTMLField({initial: ""}),
        equipement: new fields.HTMLField({initial: ""}),
        notes: new fields.HTMLField({initial: ""})
      }),

      // --- ATOUTS ---
      atouts: new fields.SchemaField({
        personnage: new fields.HTMLField({initial: ""})
      }),

      // --- COMPÉTENCES (Liste complète) ---
      competences: new fields.SchemaField({
        // Colonne 1
        acrobatie: skill(),
        art1: skill(), art2: skill(), art3: skill(),
        athletisme: skill(),
        autorite: skill(),
        combat1: skill(), combat2: skill(), combat3: skill(),
        connaissance1: skill(), connaissance2: skill(), connaissance3: skill(),
        defense: skill(),
        discretion: skill(),
        documentation: skill(),
        
        // Colonne 2
        intelligence: skill(),
        eloquence: skill(),
        langue1: skill(), langue2: skill(), langue3: skill(),
        muscle: skill(),
        perception: skill(),
        pilotage1: skill(), pilotage2: skill(), pilotage3: skill(),
        psychologie: skill(),
        reflexes: skill(),
        resistance: skill(),
        soins: skill(),
        survie: skill(),
        technique1: skill(), technique2: skill(),
        tir: skill(),
        volonte: skill()
      })
    };
  }

  /**
   * Calculs automatiques (appelés avant le rendu de la fiche)
   */
  prepareDerivedData() {
    // Calcul du score total des compétences (Base + 2 si Spécialisation)
    for (const [key, skill] of Object.entries(this.competences)) {
      skill.total = skill.specialisation ? (skill.val + 2) : skill.val;
    }
  }
}

/**
 * Modèle de données pour la Carte "Base" (Tarot)
 * Indispensable pour que Foundry V13 accepte la création des cartes.
 */
export class CardData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
        // On définit un schéma vide pour permettre le stockage des données système
        // sans imposer de contraintes strictes. Les données réelles (valeur, suite)
        // sont stockées dans les 'flags' pour plus de souplesse.
        return {};
    }
}