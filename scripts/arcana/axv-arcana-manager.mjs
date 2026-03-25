
import { CardManager } from "../actor/card-manager.mjs";

const { DialogV2 } = foundry.applications.api;

const ARCANA_IMAGE_ROOT = "/systems/arcane15/assets/axvc01_tarot_v1v1";

const POSSESSION_EFFECTS = {
  0: "Aucun signe.",
  1: "Contact. Rien de perceptible pour le personnage.",
  2: "Rêves réalistes, confusion au réveil, sensation de présence.",
  3: "Voix, lapsus, pensées et comportements étrangers.",
  4: "Hallucinations diurnes, troubles plus nets de la réalité.",
  5: "Trous noirs et prises de contrôle ponctuelles.",
  6: "Possession majeure : le sataniste impose son objectif."
};

const ARCANA_DEFINITIONS = [
  { arcaneId: "mat", arcaneNumber: 0, name: "Le Mat", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane00_mat.png`, sataniste: "Alphonse Blatty / cadeau de Satan", currentEffect: "Lorsqu’un test du personnage a obtenu une marge d’échec de 5 ou plus, le joueur peut piocher une nouvelle carte et choisir de la jouer à la place de la carte initiale. Si elle n’est pas jouée, elle est défaussée.", heroicEffect: "Dépenser 1 point de Destin pour dupliquer l’effet héroïque d’un autre atout d’arcane majeur utilisé à ce round ou au round précédent.", heroicCost: 1 },
  { arcaneId: "bateleur", arcaneNumber: 1, name: "Le Bateleur", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane01_bateleur.png`, sataniste: "Aucun (Roi de Deniers)", currentEffect: "Lors d’un test d’Intellect, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Dépenser 1 point de Destin pour désactiver un arcane majeur dont la présence est ressentie. Son propriétaire ne peut pas le réactiver durant la scène.", heroicCost: 1 },
  { arcaneId: "papesse", arcaneNumber: 2, name: "La Papesse", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane02_papesse.png`, sataniste: "Romuald Pon", currentEffect: "Lors d’un test de Connaissance, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Dépenser 1 point de Destin après avoir feuilleté un livre durant cinq minutes pour en connaître le contenu comme après une lecture attentive.", heroicCost: 1 },
  { arcaneId: "imperatrice", arcaneNumber: 3, name: "L’Impératrice", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane03_imperatrice.png`, sataniste: "Bernadette Meffret", currentEffect: "Lors d’un test d’Éloquence, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Dépenser 1 point de Destin et cibler une personne qui vous voit. Elle doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour d’elle ; en cas d’échec, elle vous considère comme un ami durant toute la scène.", heroicCost: 1 },
  { arcaneId: "empereur", arcaneNumber: 4, name: "L’Empereur", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane04_empereur.png`, sataniste: "Alexandre Lomax", currentEffect: "Lors d’un test d’Autorité, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Dépenser 1 point de Destin pour donner un ordre simple à une personne devant vous. Elle doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour d’elle ; en cas d’échec, elle obéit.", heroicCost: 1 },
  { arcaneId: "pape", arcaneNumber: 5, name: "Le Pape", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane05_pape.png`, sataniste: "Jean-Baptiste Dècre", currentEffect: "Dans la villa des Limbes, les quatre spectres d’Offémont ne s’en prennent pas au porteur et le considèrent comme un invité.", heroicEffect: "Dans la villa des Limbes, dépenser 1 point de Destin pour faire apparaître un spectre d’Offémont au round suivant dans la pièce.", heroicCost: 1 },
  { arcaneId: "amoureux", arcaneNumber: 6, name: "L’Amoureux", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane06_amoureux.png`, sataniste: "Basilis", currentEffect: "Le personnage transfère ses points de Vitalité à un individu qu’il voit ou à qui il peut parler, au rythme de 1 point par round.", heroicEffect: "Dépenser 1 point de Destin pour percevoir ce qu’entend et ce que voit un individu lié à un arcane majeur activé, à condition de connaître sa cible et la nature de l’arcane auquel cet individu est lié. La durée est égale à la valeur d’une carte piochée, en minutes.", heroicCost: 1 },
  { arcaneId: "chariot", arcaneNumber: 7, name: "Le Chariot", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane07_chariot.png`, sataniste: "André Malet", currentEffect: "Lors d’un test de Pilotage, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Dépenser 1 point de Destin pour obtenir un bonus égal à une carte piochée lors d’un test de Technique.", heroicCost: 1 },
  { arcaneId: "justice", arcaneNumber: 8, name: "La Justice", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane08_justice.png`, sataniste: "Claude Barnard", currentEffect: "Lors d’un test de Résistance, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Le personnage vient d’être blessé. Il dépense 1 point de Destin : son agresseur perd immédiatement le même nombre de points de Vitalité que lui.", heroicCost: 1 },
  { arcaneId: "ermite", arcaneNumber: 9, name: "L’Hermite", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane09_hermite.png`, sataniste: "Jean-Marie Belami", currentEffect: "Lors d’un test de Perception, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Le personnage dépense 1 point de Destin et pose une question à un individu avec lequel il converse directement ou à travers un appareil. La personne ciblée doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour de lui ; en cas d’échec, elle répond en toute franchise à la question posée.", heroicCost: 1 },
  { arcaneId: "roue-fortune", arcaneNumber: 10, name: "La Roue de fortune", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane10_roue-fortune.png`, sataniste: "Loubens Ligondé", currentEffect: "Lors d’un test de Défense, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée. Si la nouvelle valeur fait dépasser le maximum de la somme des cartes, la valeur de l’autre carte est réduite jusqu’à revenir à ce maximum.", heroicEffect: "Le personnage dépense 1 point de Destin et recommence un test qu’il vient de rater. Il bénéficie aussi d’un bonus de +2 au résultat final de ce test.", heroicCost: 1 },
  { arcaneId: "force", arcaneNumber: 11, name: "La Force", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane11_force.png`, sataniste: "Édouard Brochant", currentEffect: "Lors d’un test de Muscles, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Les animaux hésitent à s’en prendre au personnage durant un combat. Ils doivent réussir chaque round un test de Volonté difficulté 10 + 2 par arcane majeur activé autour d’eux pour l’attaquer.", heroicCost: 1 },
  { arcaneId: "pendu", arcaneNumber: 12, name: "Le Pendu", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane12_pendu.png`, sataniste: "Bonnie Gottfried", currentEffect: "Tant que l’arcane est actif, tous les individus s’approchant du propriétaire de la carte ressentent un malaise indéfinissable et cherchent inconsciemment à s’éloigner. Il leur faut réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour d’eux pour interagir normalement avec lui.", heroicEffect: "Le propriétaire fixe quelqu’un à moins d’une dizaine de mètres. L’individu ciblé doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour de lui. En cas d’échec, la victime entre dans un état de confusion et subit durant la scène un malus égal à la valeur d’une carte piochée.", heroicCost: 1 },
  { arcaneId: "sans-nom", arcaneNumber: 13, name: "L’Arcane-sans-nom", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane13_sans-nom.png`, sataniste: "Kurt Laëmmle", currentEffect: "Les dégâts occasionnés par le personnage sont majorés de 2 points.", heroicEffect: "Le personnage désigne un individu situé à moins d’une dizaine de mètres. La cible doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour de lui. En cas d’échec, elle est terrorisée et subit un malus de -2 à tous ses tests durant la scène.", heroicCost: 1 },
  { arcaneId: "temperance", arcaneNumber: 14, name: "La Tempérance", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane14_temperance.png`, sataniste: "Eva Longchamp", currentEffect: "La personne liée à l’arcane de la Tempérance ne peut pas être la cible d’un pouvoir issu d’un arcane du tarot de Seth.", heroicEffect: "Durant toute la scène, il est difficile de s’en prendre physiquement au porteur : tout agresseur doit réussir un test de Volonté difficulté 10 + 2 par arcane majeur activé autour de lui pour l’attaquer. L’effet cesse si le porteur tente de blesser quelqu’un.", heroicCost: 1 },
  { arcaneId: "diable", arcaneNumber: 15, name: "Le Diable", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane15_diable.png`, sataniste: "Satan / final", currentEffect: "Carte de fin de campagne. Son usage relève du dénouement de l’arc narratif n°6.", heroicEffect: "Pouvoirs à gérer par le MJ lors du final. Non automatisé ici.", heroicCost: 1 },
  { arcaneId: "maison-dieu", arcaneNumber: 16, name: "La Maison-dieu", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane16_maison-dieu.png`, sataniste: "Jean Talmont", currentEffect: "Lors d’un test de Combat, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée. Ajuster ensuite l’autre carte pour ne pas dépasser la somme maximale.", heroicEffect: "Le personnage désigne une cible engagée dans un combat. Pour elle et durant toute la durée de l’affrontement, les effets des primes sont doublés.", heroicCost: 1 },
  { arcaneId: "etoile", arcaneNumber: 17, name: "L’Étoile", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane17_etoile.png`, sataniste: "Viviane Carol-Bussac", currentEffect: "Lors d’un test de Volonté, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Le personnage parle à un individu durant une minute dans un environnement calme. La cible s’endort profondément pendant au moins une heure ; les conditions de réveil restent normales.", heroicCost: 1 },
  { arcaneId: "lune", arcaneNumber: 18, name: "La Lune", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane18_lune.png`, sataniste: "Anne Holmais", currentEffect: "Lors d’un test de Discrétion, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Durant la nuit, le porteur de la carte se fond dans l’obscurité et semble disparaître. L’effet héroïque prend fin lorsqu’il revient en pleine lumière ou tente de porter une attaque.", heroicCost: 1 },
  { arcaneId: "soleil", arcaneNumber: 19, name: "Le Soleil", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane19_soleil.png`, sataniste: "Hermanus Noor", currentEffect: "La somme des cartes du personnage est augmentée de 2.", heroicEffect: "Durant toute la scène, le personnage voit dans l’obscurité comme en plein jour.", heroicCost: 1 },
  { arcaneId: "jugement", arcaneNumber: 20, name: "Le Jugement", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane20_jugement.png`, sataniste: "Charles Moritz", currentEffect: "Lors d’un test de Psychologie, si le résultat final ne convient pas, le joueur peut une fois piocher une carte et la substituer à la carte initialement jouée.", heroicEffect: "Durant une minute, le personnage perçoit les pensées superficielles de son interlocuteur.", heroicCost: 1 },
  { arcaneId: "monde", arcaneNumber: 21, name: "Le Monde", img: `${ARCANA_IMAGE_ROOT}/axvc01_arcane21_monde.png`, sataniste: "Marco Ottaviani", currentEffect: "Le propriétaire de la carte peut ouvrir toutes les portes des pièces de la villa des Limbes sans aucune contrainte.", heroicEffect: "Dans la villa des Limbes, la prochaine porte ouverte par le personnage mène à la clairière du parc d’Offémont où s’élevait jadis la villa Hérodiade.", heroicCost: 1 }
];

const PERSONAL_ATOUT_DEFINITIONS = [
  {
    key: "remy-julienne",
    name: "Rémy Julienne",
    currentEffect: "Lorsque vous choisissez la pénalité Risque, vous obtenez deux primes au lieu d’une.",
    heroicEffect: "1 point de Destin : faites un test d’Art (Comédie) / 12. En cas de réussite, vous regagnez tous les points de Vitalité perdus durant ce round. En cas d’échec, seulement la moitié, arrondie à l’inférieur."
  },
  {
    key: "kill-bill",
    name: "Kill Bill",
    currentEffect: "Vos dommages à mains nues passent à -1 au lieu de -3.",
    heroicEffect: "1 point de Destin : vous portez immédiatement une deuxième attaque au corps à corps."
  },
  {
    key: "jusquici-tout-va-bien",
    name: "Jusqu’ici tout va bien",
    currentEffect: "Lors d’un test de Volonté, si le résultat final ne vous convient pas, vous pouvez une fois piocher une carte et la substituer à la carte initialement jouée.",
    heroicEffect: "1 point de Destin : vous faites appel aux membres de la petite délinquance de votre ancien quartier pour obtenir quelque chose d’illégal durant cette séance, comme une arme à feu ou de la drogue. Effet limité à une fois par séance."
  },
  {
    key: "larnacoeur",
    name: "L’arnacoeur",
    currentEffect: "Vous pouvez utiliser votre compétence Art (Comédie) pour obtenir quelque chose de quelqu’un si vous réussissez un test d’Opposition active contre la Volonté de votre cible.",
    heroicEffect: "1 point de Destin : lors d’un combat, vous embobinez votre adversaire. Au début de chaque round, faites un test d’Art (Comédie) en opposition avec la Psychologie de la cible. En cas de réussite, vous obtenez deux primes gratuites."
  },
  {
    key: "actor-studio",
    name: "Actor Studio",
    currentEffect: "Lorsque vous voulez vous introduire dans un milieu particulier et passer pour un habitué, faites un test d’Art (Comédie) contre une difficulté décidée par le meneur. En cas de réussite, vous êtes comme un poisson dans l’eau.",
    heroicEffect: "1 point de Destin : piochez une carte. Vous obtenez un bonus égal à sa valeur à votre résultat final lors d’un test de Connaissance."
  },
  {
    key: "boite-de-chocolats",
    name: "La vie, c’est comme une boîte de chocolats",
    currentEffect: "Lorsque vous échouez à un test alors que vous aviez dépensé 1 point de Destin, piochez une carte : si vous tirez un 7 ou une carte supérieure, vous récupérez le point de Destin perdu.",
    heroicEffect: "1 point de Destin : par une parole ou une simple attitude, vous redonnez de l’énergie à vos compagnons. Tous ceux qui ne sont pas mal en point piochent une carte et regagnent sa valeur en points de Vitalité."
  },
  {
    key: "keyser-soze",
    name: "Keyser Söze",
    currentEffect: "Vous pouvez utiliser votre compétence Art (Comédie) pour faire croire à n’importe qui que vous n’êtes pas l’auteur d’un fait, dans les limites de la logique. Faites un test d’Opposition active contre la Volonté de votre cible.",
    heroicEffect: "1 point de Destin : durant un combat, les ennemis ne vous prennent pas pour cible, sauf si vous cherchez à les blesser ou si vous êtes leur dernier adversaire."
  },
  {
    key: "monte-cristo",
    name: "Le Comte de Monte-Cristo",
    currentEffect: "Lorsque vous piochez un as, vous pouvez le placer directement dans la défausse et piocher une nouvelle carte à la place.",
    heroicEffect: "1 point de Destin : piochez une carte. Vous obtenez un bonus égal à sa valeur à votre résultat final lors d’un test de Volonté."
  },
  {
    key: "dame-de-shanghai",
    name: "La dame de Shanghai",
    currentEffect: "Vous pouvez utiliser votre compétence Art (Comédie) pour déclencher du désir chez un interlocuteur. Faites une Opposition active contre sa Volonté. En cas de réussite, vous obtenez durant toute la scène un bonus égal à la marge de réussite à vos tests d’Éloquence, d’Autorité ou de Psychologie contre cette personne.",
    heroicEffect: "1 point de Destin : vous attirez l’attention de l’ensemble de vos interlocuteurs durant une scène. Piochez une carte. Vous obtenez un bonus à vos tests d’Éloquence, de Psychologie et d’Autorité égal à sa valeur."
  },
  {
    key: "marquise-de-merteuil",
    name: "Marquise de Merteuil",
    currentEffect: "Au cours d’une discussion avec un individu, faites une Opposition active de Psychologie. En cas de réussite, vous obtenez un bonus égal à la marge de réussite durant la scène pour toutes les futures actions en opposition contre lui, en combat comme pour les tests sociaux.",
    heroicEffect: "1 point de Destin : vous faites profiter à vos compagnons de cette prime, s’ils sont en contact direct avec vous."
  }
];

const ARCANA_BY_ID = new Map(ARCANA_DEFINITIONS.map(a => [a.arcaneId, a]));
const PERSONAL_BY_KEY = new Map(PERSONAL_ATOUT_DEFINITIONS.map(a => [a.key, a]));


const POSSESSION_SCALES = {
  papesse: {
    1: "Contact. Rien de particulier.",
    2: "Dans la bibliothèque : rêve de la bibliothèque de la villa Hérodiade, discussion oubliée avec Gabriel d’Offémont, réveil oppressé.",
    3: "Bibliophilie : ajoute le domaine Bibliophilie à Connaissance tant que la possession dure.",
    4: "Le livre noir : découvre un livre noir au pentagramme argenté qui semble ouvrir sur un abîme avant de redevenir banal.",
    5: "Dans la bibliothèque 2 : se réveille de nuit dans la bibliothèque de la villa Hérodiade, un livre noir en main.",
    6: "L’ami d’Hermanus : cherche à joindre la descendance d’Hermanus Noor via Serpents et échelles."
  },
  empereur: {
    1: "Contact. Rien de particulier.",
    2: "Le jury : rêve d’une salle d’audience et d’un jury composé des autres membres du club de la Salamandre.",
    3: "Le droit, ça me connaît ! : ajoute le domaine Droit à Connaissance tant que la possession dure.",
    4: "Garde-robe : découvre dans un placard des robes d’avocat brûlées et imprégnées d’odeur de fumée.",
    5: "Où es-tu Viviane ? : cherche à localiser puis dérober l’arcane de l’Étoile.",
    6: "Sur les lieux de l’incendie : retourne aussitôt à Saint-Crépin-aux-Bois pour comprendre l’incendie de la villa Hérodiade."
  },
  amoureux: {
    1: "Contact. Rien de particulier.",
    2: "Camisole : cauchemar d’asile, camisole de force, bain glacé et médecin nommé Corbin.",
    3: "Le serpent : croit percevoir un serpent noir qui rôde dans son logement ou son véhicule.",
    4: "Un joli dessin ! : dessine en somnambule un arcane majeur du tarot de Seth sur un mur.",
    5: "Perdu sur les quais de Seine : reprend conscience devant l’ancien immeuble de Basilis, quai Henry IV à Paris.",
    6: "Le collectionneur : tente de reconstituer le tarot de Seth, éventuellement avec Bernadette Meffret."
  },
  chariot: {
    1: "Contact. Rien de particulier.",
    2: "L’écurie : rêve d’un immense cheval noir aux yeux écarlates et aux naseaux en flammes.",
    3: "Le tirage de cartes : entend une voix qui dicte un tirage de tarot et souffle qu’un autre PJ va le trahir.",
    4: "Le tirage de cartes 2 : hallucination d’un salon tendu de velours violet où Charles Moritz l’attend.",
    5: "Vous êtes là ? : se réveille de nuit devant l’appartement de Vincent Fichet en appelant Charles.",
    6: "Le Jugement : cherche Charles Moritz et tente de voler l’arcane du Jugement."
  },
  justice: {
    1: "Contact. Rien de particulier.",
    2: "La photographie des vingt : rêve de la photo de groupe des porteurs d’arcanes, tous aux yeux écarlates.",
    3: "Le procès : entend les échos d’un procès et croit devoir se défendre d’une accusation grave.",
    4: "Un cadavre dans mon lit : hallucination du corps de Pierre Veilleur, deuxième mari de Claude Barnard.",
    5: "Attention, poison ! : découvre chez lui de la mort au rat qu’il est certain de ne pas avoir achetée.",
    6: "L’empoisonneuse : cherche à éliminer les compagnons de son hôte en empoisonnant nourriture ou boisson."
  },
  ermite: {
    1: "Contact. Rien de particulier.",
    2: "Désert : série de rêves dans un immense désert, avec réveils assoiffés.",
    3: "Arabian night : se met brusquement à parler arabe sans s’en rendre compte.",
    4: "Le laboratoire : la porte de la villa des Limbes ouvre un instant sur le laboratoire d’un alchimiste.",
    5: "Iblis : se réveille au milieu d’un cercle et trace en arabe une phrase tirée de la sourate d’Iblis.",
    6: "L’adorateur du Diable : pénètre dans la villa des Limbes et cherche la chambre du Diable."
  },
  "roue-fortune": {
    1: "Contact. Rien de particulier.",
    2: "Vaudou : rêve d’une cérémonie vaudou, tambours et oufo aux murs blanchis à la chaux.",
    3: "Black Magic Jazz Band : développe une obsession pour ce groupe et se renseigne sur ses anciens membres.",
    4: "Bonnie : croit être suivi dans la journée par Bonnie Gottfried.",
    5: "Le Pendu : cherche à s’emparer de l’arcane du Pendu pendant un trou noir.",
    6: "La libération : tente de libérer Bonnie de la lame du Pendu par un rituel vaudou."
  },
  force: {
    1: "Contact. Rien de particulier.",
    2: "Le temple : rêve d’une cérémonie occulte dans le temple des Naassènes.",
    3: "Incantations : entend des formules rituelles familières liées aux cérémonies des Naassènes.",
    4: "Une nouvelle carte : une carte du tarot prend brièvement l’apparence d’un honneur du temple.",
    5: "La cérémonie, c’est ici ? : reprend conscience juste avant d’entrer dans la boutique Serpents et échelles.",
    6: "Dans le rang : rejoint immédiatement la propriétaire de Serpents et échelles, Hans Varg et ses sbires."
  },
  "sans-nom": {
    1: "Contact. Rien de particulier.",
    2: "Prison : rêve des couloirs d’une prison et découvre ses poings couverts de sang.",
    3: "Sprechen Sie Deutsch ? : se met à parler allemand brutalement.",
    4: "Dernière rencontre : hallucination d’un prisonnier amaigri qui lui reproche de revenir le tourmenter.",
    5: "Doom Art : reprend conscience dans la galerie Doom Art en discutant en allemand avec Maxime von Grave.",
    6: "Laëmmle et Varg : cherche aussitôt à s’allier à Hans Varg et à ses partisans."
  },
  temperance: {
    1: "Contact. Rien de particulier.",
    2: "Hôpital : rêve récurrent où il déambule d’une chambre à l’autre comme un membre du personnel.",
    3: "Une voix dans la nuit : se réveille en psalmodiant une invocation au maître des esclandres.",
    4: "L’abbé : croit être suivi par un ecclésiastique en soutane qui disparaît dès qu’il l’approche.",
    5: "J’ai péché : reprend conscience dans un confessionnal, persuadé qu’une présence l’écoute derrière la grille.",
    6: "À la recherche du maître : cherche l’abbé Dècre et sent que l’arcane du Pape se trouve dans la villa des Limbes."
  },
  "maison-dieu": {
    1: "Contact. Rien de particulier.",
    2: "Enfermé : rêve d’être coincé dans un espace minuscule, peut-être un cercueil.",
    3: "Clés, grilles et portes : entend pendant des heures serrures, grilles et claquements métalliques.",
    4: "Coups de poing : assiste à une bagarre nocturne et reçoit l’ordre de servir Gabriel d’Offémont sous l’apparence du Roi de Deniers.",
    5: "Agression : reprend conscience dans la rue, tuméfié et couvert de sang, après une nuit perdue.",
    6: "Un nouveau patron : tente de reprendre contact avec Gabriel d’Offémont à Saint-Crépin-aux-Bois et rejoint les Ullmann."
  },
  etoile: {
    1: "Contact. Rien de particulier.",
    2: "Miroir, mon beau miroir : rêve d’une galerie de miroirs et y voit le reflet d’une femme blonde inconnue.",
    3: "Cris d’enfants : entend des enfants l’appeler ou se disputer dans une pièce voisine.",
    4: "La comtesse sanglante : s’invente soudain des liens entre l’enquête en cours et Élisabeth Báthory.",
    5: "Serpents et échelles : conduit son corps d’emprunt à la boutique pour y retrouver le Cercle des Naassènes et d’autres âmes liées aux arcanes.",
    6: "Un autre corps ? : commence par se scarifier puis envisage le suicide pour quitter ce corps jugé indigne."
  },
  lune: {
    1: "Contact. Rien de particulier.",
    2: "Le rêve de Marie Bonnano : refait les mêmes rêves que Marie Bonnano autour de la ferme et du puits en Sologne.",
    3: "Docteur Freud : gagne +3 en Psychologie, jusqu’à un maximum de 10, tant que l’influence dure.",
    4: "La possédée : vision brève d’une adolescente sanglée sur son lit, hurlant à s’en arracher la gorge.",
    5: "Vers la Sologne : tente de rejoindre la propriété de Sologne et reprend conscience en route vers Neung-sur-Beuvron.",
    6: "En Sologne : rejoint la ferme de Sologne pour faire le point, au risque d’un affrontement avec Christophe Holmais."
  },
  soleil: {
    1: "Contact. Rien de particulier.",
    2: "Dear Aleister : rêve d’un entretien en bord de mer avec Aleister Crowley, entouré de dessins et de cartes.",
    3: "L’alchimiste : développe une passion pour l’alchimie, rassemble des ouvrages occultes et se réjouit à Serpents et échelles.",
    4: "Le manuscrit : trouve chez lui un manuscrit néerlandais de L’Œuvre au rouge écrit de sa propre main.",
    5: "Un appel dans la nuit : se réveille en pleine conversation avec Fiona Noor, convaincue d’échanger avec Hermanus revenu des morts.",
    6: "La famille Noor : rejoint Fiona à Serpents et échelles pour reprendre sa place au sein du Cercle des Naassènes."
  },
  jugement: {
    1: "Contact. Rien de particulier.",
    2: "Une main gantée : rêve d’un tirage de tarot face à une cartomancienne gantée de noir aux bracelets étincelants.",
    3: "La fête : entend une fête des années 1930 chez les voisins et des voix qui l’invitent à rejoindre Charles.",
    4: "Sépia : revit la scène de la photo retrouvée chez Vincent Fichet, aux côtés de Kurt Laëmmle.",
    5: "Que s’est-il passé ? : erre, persuadé d’avoir perdu mémoire et raison, puis finit dans un hôpital.",
    6: "Hérodiade : se rend à Saint-Crépin-aux-Bois et tente de pénétrer dans le parc de la villa Hérodiade."
  }
};

const POSSESSION_SCALE_ALIASES = {
  "romuald pon": "papesse",
  "alexandre lomax": "empereur",
  "basilis": "amoureux",
  "andre mallet": "chariot",
  "andre malet": "chariot",
  "claude barnard": "justice",
  "jean marie belami": "ermite",
  "loubens ligonde": "roue-fortune",
  "edouard brochant": "force",
  "kurt laemmle": "sans-nom",
  "eva longchamp": "temperance",
  "jean talmont": "maison-dieu",
  "viviane carol bussac": "etoile",
  "anne holmais": "lune",
  "hermanus noor": "soleil",
  "charles moritz": "jugement",
  "bonnie gottfried": "pendu",
  "bernadette meffret": "imperatrice",
  "jean baptiste decre": "pape",
  "marco ottaviani": "monde",
  "satan": "diable"
};

function resolvePossessionScaleArcaneId(itemOrArcaneId, sataniste = "") {
  const directArcaneId = typeof itemOrArcaneId === "string"
    ? itemOrArcaneId
    : (itemOrArcaneId?.system?.arcaneId ?? itemOrArcaneId?.arcaneId ?? "");
  if (directArcaneId && (POSSESSION_SCALES[directArcaneId] || ARCANA_BY_ID.has(directArcaneId))) {
    return directArcaneId;
  }
  const satanisteName = normalizeText(sataniste || itemOrArcaneId?.system?.sataniste || itemOrArcaneId?.sataniste || "");
  return POSSESSION_SCALE_ALIASES[satanisteName] || directArcaneId || "";
}

function getFallbackPossessionEffect(arcaneId, level = 0) {
  if (level <= 0) return POSSESSION_EFFECTS[0];
  if (arcaneId === "imperatrice") {
    return level === 1
      ? "Contact. Rien de particulier."
      : "Aucune échelle de possession dans le livre : Bernadette Meffret possède déjà un PNJ.";
  }
  if (arcaneId === "pape") {
    return level === 1
      ? "Contact. Rien de particulier."
      : "Aucune échelle de possession dans le livre : les PJ ne peuvent normalement pas obtenir cette carte avant la fin de la campagne.";
  }
  if (arcaneId === "pendu") {
    if (level === 1) return "Contact. Rien de particulier.";
    if (level < 6) return "Arcane particulièrement dangereux : la folie de Bonnie Gottfried imprègne le porteur. Le livre ne donne pas d’échelle standard de possession pour cet arcane.";
    return "Pas de possession standard : l’esprit de Bonnie Gottfried ne peut pas posséder un PJ à la manière des autres satanistes.";
  }
  if (arcaneId === "monde") {
    return level === 1
      ? "Contact. Rien de particulier."
      : "Aucune échelle de possession dans le livre : les PJ ne peuvent normalement pas obtenir cette carte avant la fin de la campagne.";
  }
  if (arcaneId === "diable") {
    return "Arcane de fin de campagne : possession et effets à gérer manuellement par le MJ.";
  }
  if (arcaneId === "mat" || arcaneId === "bateleur") {
    return level === 1
      ? "Contact. Rien de particulier."
      : "Pas d’échelle de possession dédiée dans le livre de base pour cet arcane.";
  }
  return POSSESSION_EFFECTS[Math.min(6, Math.max(1, Number(level) || 1))] || POSSESSION_EFFECTS[6];
}

function getPossessionEffectForArcane(itemOrArcaneId, level = 0, sataniste = "") {
  const numericLevel = Math.max(0, Math.min(6, Number(level) || 0));
  if (numericLevel <= 0) return POSSESSION_EFFECTS[0];
  const arcaneId = resolvePossessionScaleArcaneId(itemOrArcaneId, sataniste);
  const scale = POSSESSION_SCALES[arcaneId];
  if (scale?.[numericLevel]) return scale[numericLevel];
  return getFallbackPossessionEffect(arcaneId, numericLevel);
}


function getPersistedPossessionState(itemOrArcaneLike) {
  const flags = itemOrArcaneLike?.getFlag?.("arcane15", "possession")
    ?? itemOrArcaneLike?.flags?.arcane15?.possession
    ?? itemOrArcaneLike?._source?.flags?.arcane15?.possession
    ?? {};
  const system = itemOrArcaneLike?.system ?? itemOrArcaneLike?._source?.system ?? {};
  const arcaneId = String(flags.arcaneId ?? system.arcaneId ?? itemOrArcaneLike?.arcaneId ?? "");
  const def = ARCANA_BY_ID.get(arcaneId) ?? {};
  const sataniste = String(flags.sataniste ?? system.sataniste ?? itemOrArcaneLike?.sataniste ?? def.sataniste ?? "");
  const rawLevel = flags.level ?? flags.possessionLevel ?? system.possessionLevel ?? itemOrArcaneLike?.possessionLevel ?? 0;
  const possessionLevel = Math.max(0, Math.min(6, Number(rawLevel) || 0));
  const computedEffect = getPossessionEffectForArcane(arcaneId || itemOrArcaneLike, possessionLevel, sataniste);
  const possessionEffect = String(flags.effect ?? flags.possessionEffect ?? system.possessionEffect ?? itemOrArcaneLike?.possessionEffect ?? computedEffect ?? "");
  return { arcaneId, sataniste, possessionLevel, possessionEffect, computedEffect };
}

function getStoredPossessionStartedAt(itemOrArcaneLike) {
  const raw = itemOrArcaneLike?.getFlag?.("arcane15", "possession")?.startedAt
    ?? itemOrArcaneLike?.flags?.arcane15?.possession?.startedAt
    ?? itemOrArcaneLike?._source?.flags?.arcane15?.possession?.startedAt
    ?? 0;
  const value = Number(raw) || 0;
  return value > 0 ? value : 0;
}

function getPossessionStartedAt(itemOrArcaneLike, { preferNow = false } = {}) {
  const stored = getStoredPossessionStartedAt(itemOrArcaneLike);
  if (stored > 0) return stored;

  const candidates = [
    itemOrArcaneLike?.system?.lastHeroicAt,
    itemOrArcaneLike?._source?.system?.lastHeroicAt,
    itemOrArcaneLike?._stats?.modifiedTime,
    itemOrArcaneLike?._source?._stats?.modifiedTime,
    itemOrArcaneLike?.parent?._stats?.modifiedTime,
    itemOrArcaneLike?.actor?._stats?.modifiedTime
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate) || 0;
    if (numeric > 0) return numeric;
  }

  return preferNow ? Date.now() : 0;
}

function getChangedPossessionLevel(changed, fallbackLevel = 0) {
  const flagLevel = foundry.utils.getProperty(changed, "flags.arcane15.possession.level");
  const flagAlt = foundry.utils.getProperty(changed, "flags.arcane15.possession.possessionLevel");
  const systemLevel = foundry.utils.getProperty(changed, "system.possessionLevel");
  const raw = flagLevel ?? flagAlt ?? systemLevel;
  if (raw === undefined) return Math.max(0, Math.min(6, Number(fallbackLevel) || 0));
  return Math.max(0, Math.min(6, Number(raw) || 0));
}

function buildPossessionPersistenceUpdate(itemOrArcaneLike, level, sataniste = undefined) {
  const current = getPersistedPossessionState(itemOrArcaneLike);
  const arcaneId = String(current.arcaneId || itemOrArcaneLike?.system?.arcaneId || itemOrArcaneLike?.arcaneId || "");
  const def = ARCANA_BY_ID.get(arcaneId) ?? {};
  const nextSataniste = String(sataniste ?? current.sataniste ?? def.sataniste ?? "");
  const nextLevel = Math.max(0, Math.min(6, Number(level) || 0));
  const nextEffect = getPossessionEffectForArcane(arcaneId || itemOrArcaneLike, nextLevel, nextSataniste);
  return {
    arcaneId,
    sataniste: nextSataniste,
    possessionLevel: nextLevel,
    possessionEffect: nextEffect,
    updateData: {
      "flags.arcane15.possession.arcaneId": arcaneId,
      "flags.arcane15.possession.sataniste": nextSataniste,
      "flags.arcane15.possession.level": nextLevel,
      "flags.arcane15.possession.effect": nextEffect,
      "system.possessionLevel": nextLevel,
      "system.possessionEffect": nextEffect,
      "system.sataniste": nextSataniste
    }
  };
}

function getActorActivePossessionState(actorLike) {
  const raw = actorLike?.getFlag?.("arcane15", "possession")
    ?? actorLike?.flags?.arcane15?.possession
    ?? actorLike?._source?.flags?.arcane15?.possession
    ?? actorLike?.getFlag?.("arcane15", "activePossession")
    ?? actorLike?.flags?.arcane15?.activePossession
    ?? actorLike?._source?.flags?.arcane15?.activePossession
    ?? {};

  const sourceArcaneId = String(raw.sourceArcaneId ?? raw.arcaneId ?? "");
  const sourceSataniste = String(raw.sourceSataniste ?? raw.sataniste ?? "");
  const level = Math.max(0, Math.min(6, Number(raw.level ?? raw.possessionLevel ?? 0) || 0));
  const arcane = String(raw.arcane ?? ARCANA_BY_ID.get(sourceArcaneId)?.name ?? "");
  const currentEffectText = String(
    raw.currentEffectText
      ?? raw.effect
      ?? raw.possessionEffect
      ?? getPossessionEffectForArcane(sourceArcaneId, level, sourceSataniste)
      ?? ""
  );
  const lastChangeAt = Math.max(0, Number(raw.lastChangeAt ?? raw.lastShiftAt ?? 0) || 0);
  const startedAt = Math.max(0, Number(raw.startedAt ?? 0) || 0);

  return {
    sourceItemId: String(raw.sourceItemId ?? ""),
    sourceItemUuid: String(raw.sourceItemUuid ?? ""),
    sourceArcaneId,
    arcane,
    sourceSataniste,
    sataniste: sourceSataniste,
    level,
    startedAt,
    lastChangeAt,
    lastShiftAt: lastChangeAt,
    currentEffectText,
    effect: currentEffectText
  };
}

function buildActorActivePossessionUpdate(actorLike, item, { previousState = null, level = null, startedAt = null, lastChangeAt = null, sourceArcaneId = null, sourceSataniste = null } = {}) {
  const previous = previousState ?? getActorActivePossessionState(actorLike);
  const fallbackArcaneId = String(sourceArcaneId ?? item?.system?.arcaneId ?? item?.arcaneId ?? previous.sourceArcaneId ?? "");
  const fallbackDef = ARCANA_BY_ID.get(fallbackArcaneId) ?? {};
  const nextLevel = Math.max(0, Math.min(6, Number(level ?? getPersistedPossessionState(item).possessionLevel ?? previous.level ?? 0) || 0));
  const nextSataniste = String(sourceSataniste ?? item?.system?.sataniste ?? previous.sourceSataniste ?? fallbackDef.sataniste ?? "");
  const sameSource = String(previous.sourceItemId ?? "") === String(item?.id ?? "")
    && String(previous.sourceArcaneId ?? "") === String(fallbackArcaneId ?? "");
  const resolvedStartedAt = Math.max(0, Number(startedAt ?? (sameSource && Number(previous.startedAt || 0) > 0 ? previous.startedAt : (nextLevel > 0 ? Date.now() : 0))) || 0);
  const resolvedLastChangeAt = Math.max(0, Number(lastChangeAt ?? (sameSource && Number(previous.lastChangeAt || 0) > 0 ? previous.lastChangeAt : (nextLevel > 0 ? Date.now() : 0))) || 0);
  const arcaneName = String(item?.name ?? fallbackDef.name ?? previous.arcane ?? "");
  const effect = String(getPossessionEffectForArcane(fallbackArcaneId || item, nextLevel, nextSataniste) || "");

  const next = {
    sourceItemId: String(item?.id ?? previous.sourceItemId ?? ""),
    sourceItemUuid: String(item?.uuid ?? previous.sourceItemUuid ?? ""),
    sourceArcaneId: fallbackArcaneId,
    arcane: arcaneName,
    sourceSataniste: nextSataniste,
    sataniste: nextSataniste,
    level: nextLevel,
    startedAt: resolvedStartedAt,
    lastChangeAt: resolvedLastChangeAt,
    lastShiftAt: resolvedLastChangeAt,
    currentEffectText: effect,
    effect
  };

  return {
    state: next,
    updateData: {
      "flags.arcane15.possession.sourceItemId": next.sourceItemId,
      "flags.arcane15.possession.sourceItemUuid": next.sourceItemUuid,
      "flags.arcane15.possession.sourceArcaneId": next.sourceArcaneId,
      "flags.arcane15.possession.arcane": next.arcane,
      "flags.arcane15.possession.sourceSataniste": next.sourceSataniste,
      "flags.arcane15.possession.sataniste": next.sourceSataniste,
      "flags.arcane15.possession.level": next.level,
      "flags.arcane15.possession.currentEffectText": next.currentEffectText,
      "flags.arcane15.possession.effect": next.currentEffectText,
      "flags.arcane15.possession.startedAt": next.startedAt,
      "flags.arcane15.possession.lastChangeAt": next.lastChangeAt,
      "flags.arcane15.activePossession.sourceItemId": next.sourceItemId,
      "flags.arcane15.activePossession.sourceItemUuid": next.sourceItemUuid,
      "flags.arcane15.activePossession.sourceArcaneId": next.sourceArcaneId,
      "flags.arcane15.activePossession.arcane": next.arcane,
      "flags.arcane15.activePossession.sourceSataniste": next.sourceSataniste,
      "flags.arcane15.activePossession.sataniste": next.sourceSataniste,
      "flags.arcane15.activePossession.level": next.level,
      "flags.arcane15.activePossession.currentEffectText": next.currentEffectText,
      "flags.arcane15.activePossession.effect": next.currentEffectText,
      "flags.arcane15.activePossession.startedAt": next.startedAt,
      "flags.arcane15.activePossession.lastChangeAt": next.lastChangeAt,
      "flags.arcane15.activePossession.lastShiftAt": next.lastChangeAt
    }
  };
}

function buildClearActorActivePossessionUpdate() {
  return {
    sourceItemId: "",
    sourceItemUuid: "",
    sourceArcaneId: "",
    arcane: "",
    sourceSataniste: "",
    sataniste: "",
    level: 0,
    startedAt: 0,
    lastChangeAt: 0,
    lastShiftAt: 0,
    currentEffectText: "",
    effect: "",
    updateData: {
      "flags.arcane15.possession.sourceItemId": "",
      "flags.arcane15.possession.sourceItemUuid": "",
      "flags.arcane15.possession.sourceArcaneId": "",
      "flags.arcane15.possession.arcane": "",
      "flags.arcane15.possession.sourceSataniste": "",
      "flags.arcane15.possession.sataniste": "",
      "flags.arcane15.possession.level": 0,
      "flags.arcane15.possession.currentEffectText": "",
      "flags.arcane15.possession.effect": "",
      "flags.arcane15.possession.startedAt": 0,
      "flags.arcane15.possession.lastChangeAt": 0,
      "flags.arcane15.activePossession.sourceItemId": "",
      "flags.arcane15.activePossession.sourceItemUuid": "",
      "flags.arcane15.activePossession.sourceArcaneId": "",
      "flags.arcane15.activePossession.arcane": "",
      "flags.arcane15.activePossession.sourceSataniste": "",
      "flags.arcane15.activePossession.sataniste": "",
      "flags.arcane15.activePossession.level": 0,
      "flags.arcane15.activePossession.currentEffectText": "",
      "flags.arcane15.activePossession.effect": "",
      "flags.arcane15.activePossession.startedAt": 0,
      "flags.arcane15.activePossession.lastChangeAt": 0,
      "flags.arcane15.activePossession.lastShiftAt": 0
    }
  };
}

function buildActorPossessionComparable(state) {
  return {
    sourceItemId: String(state?.sourceItemId ?? ""),
    sourceItemUuid: String(state?.sourceItemUuid ?? ""),
    sourceArcaneId: String(state?.sourceArcaneId ?? ""),
    arcane: String(state?.arcane ?? ""),
    sourceSataniste: String(state?.sourceSataniste ?? state?.sataniste ?? ""),
    level: Number(state?.level ?? 0) || 0,
    startedAt: Number(state?.startedAt ?? 0) || 0,
    lastChangeAt: Number(state?.lastChangeAt ?? state?.lastShiftAt ?? 0) || 0,
    currentEffectText: String(state?.currentEffectText ?? state?.effect ?? "")
  };
}


function getActorPossessionCandidates(actorLike) {
  return (actorLike?.items ?? [])
    .filter(item => item?.type === "atoutArcane")
    .map(item => {
      const state = getPersistedPossessionState(item);
      if (Number(state.possessionLevel || 0) <= 0) return null;
      const startedAt = getPossessionStartedAt(item, { preferNow: false });
      const lastActivityAt = Number(item?.system?.lastHeroicAt ?? item?._source?.system?.lastHeroicAt ?? 0) || 0;
      const modifiedAt = Number(item?._stats?.modifiedTime ?? item?._source?._stats?.modifiedTime ?? 0) || 0;
      return {
        item,
        sourceItemId: String(item?.id ?? ""),
        sourceItemUuid: String(item?.uuid ?? ""),
        sourceArcaneId: String(state.arcaneId ?? ""),
        arcane: String(item?.name ?? ARCANA_BY_ID.get(state.arcaneId)?.name ?? ""),
        sataniste: String(state.sataniste ?? ""),
        level: Math.max(0, Math.min(6, Number(state.possessionLevel) || 0)),
        effect: String(getPossessionEffectForArcane(state.arcaneId || item, state.possessionLevel, state.sataniste) || state.possessionEffect || ""),
        startedAt,
        lastActivityAt,
        modifiedAt
      };
    })
    .filter(Boolean);
}

function sortActorPossessionCandidates(a, b) {
  const shiftA = Number(a?.lastChangeAt ?? a?.lastShiftAt ?? 0) || 0;
  const shiftB = Number(b?.lastChangeAt ?? b?.lastShiftAt ?? 0) || 0;
  if (shiftB !== shiftA) return shiftB - shiftA;
  const startA = Number(a?.startedAt ?? 0) || 0;
  const startB = Number(b?.startedAt ?? 0) || 0;
  if (startB !== startA) return startB - startA;
  const activityA = Number(a?.lastActivityAt ?? a?.modifiedAt ?? 0) || 0;
  const activityB = Number(b?.lastActivityAt ?? b?.modifiedAt ?? 0) || 0;
  if (activityB !== activityA) return activityB - activityA;
  const levelA = Number(a?.level ?? a?.palier ?? 0) || 0;
  const levelB = Number(b?.level ?? b?.palier ?? 0) || 0;
  if (levelB !== levelA) return levelB - levelA;
  return `${a?.actor ?? ""} ${a?.arcane ?? ""}`.localeCompare(`${b?.actor ?? ""} ${b?.arcane ?? ""}`, "fr", { sensitivity: "base" });
}


const ARCANA_NAME_ALIASES = {
  "le mat": "mat",
  "mat": "mat",
  "le bateleur": "bateleur",
  "la papesse": "papesse",
  "l imperatrice": "imperatrice",
  "l’imperatrice": "imperatrice",
  "l'empereur": "empereur",
  "l empereur": "empereur",
  "le pape": "pape",
  "l amoureux": "amoureux",
  "l’amoureux": "amoureux",
  "le chariot": "chariot",
  "la justice": "justice",
  "l ermite": "ermite",
  "l’ermite": "ermite",
  "la roue de fortune": "roue-fortune",
  "la force": "force",
  "le pendu": "pendu",
  "l arcane sans nom": "sans-nom",
  "l’arcane sans nom": "sans-nom",
  "l arcane-sans-nom": "sans-nom",
  "l’arcane-sans-nom": "sans-nom",
  "la temperance": "temperance",
  "le diable": "diable",
  "la maison dieu": "maison-dieu",
  "la maison-dieu": "maison-dieu",
  "l etoile": "etoile",
  "l’étoile": "etoile",
  "la lune": "lune",
  "le soleil": "soleil",
  "le jugement": "jugement",
  "le monde": "monde"
};

const DEFAULT_ARCANA_BY_ACTOR = new Map([
  ["chloe barnard", ["justice"]],
  ["chloé barnard", ["justice"]],
  ["romeo deville", ["amoureux"]],
  ["roméo deville", ["amoureux"]],
  ["eugene ndiaye", ["sans-nom"]],
  ["eugène ndiaye", ["sans-nom"]],
  ["marvin vaillant", ["roue-fortune"]],
  ["loren young", ["etoile"]],
  ["marie bonnano", ["lune"]],
  ["christophe holmais", ["lune"]],
  ["vincent fichet", ["jugement"]],
  ["liana ferrand", ["imperatrice"]],
  ["julien tournus", ["soleil"]],
  ["hans varg", ["soleil"]],
  ["iris ullman", ["papesse", "empereur", "chariot", "ermite", "force", "temperance", "maison-dieu"]],
  ["urbain ullman", ["pape"]]
]);

const DEFAULT_CHARACTER_ATOUTS_BY_ACTOR = new Map([
  ["chloe barnard", ["remy-julienne", "kill-bill"]],
  ["chloé barnard", ["remy-julienne", "kill-bill"]],
  ["romeo deville", ["jusquici-tout-va-bien", "larnacoeur"]],
  ["roméo deville", ["jusquici-tout-va-bien", "larnacoeur"]],
  ["eugene ndiaye", ["actor-studio", "boite-de-chocolats"]],
  ["eugène ndiaye", ["actor-studio", "boite-de-chocolats"]],
  ["marvin vaillant", ["keyser-soze", "monte-cristo"]],
  ["loren young", ["dame-de-shanghai", "marquise-de-merteuil"]]
]);


const SKILL_SUBSTITUTION_ARCANA = {
  intelligence: ["bateleur"],
  eloquence: ["imperatrice"],
  autorite: ["empereur"],
  resistance: ["justice"],
  perception: ["ermite"],
  defense: ["roue-fortune"],
  muscle: ["force"],
  volonte: ["etoile"],
  discretion: ["lune"],
  psychologie: ["jugement"],
  tir: ["maison-dieu"],
  combat1: ["maison-dieu"],
  combat2: ["maison-dieu"],
  combat3: ["maison-dieu"]
};

const PREFIX_SUBSTITUTION_ARCANA = [
  { prefix: "connaissance", arcaneIds: ["papesse"] },
  { prefix: "pilotage", arcaneIds: ["chariot"] },
  { prefix: "technique", arcaneIds: [] }
];

const ARCANA_AUTOMATION_LABELS = {
  mat: "Guidé : duplication héroïque via rappel MJ/chat.",
  bateleur: "Auto : substitution sur Intelligence après le jet.",
  papesse: "Auto : substitution sur Connaissance après le jet.",
  imperatrice: "Auto : substitution sur Éloquence ; héroïque via test de Volonté de la cible.",
  empereur: "Auto : substitution sur Autorité ; héroïque via test de Volonté de la cible.",
  pape: "Manuel : effets contextuels à la villa des Limbes.",
  amoureux: "Guidé : transfert/vision à jouer au cas par cas.",
  chariot: "Auto : substitution sur Pilotage ; héroïque = bonus stocké pour le prochain test de Technique.",
  justice: "Auto : substitution sur Résistance ; héroïque = riposte de Vitalité sur cible choisie.",
  ermite: "Auto : substitution sur Perception ; héroïque via test de Volonté de la cible.",
  "roue-fortune": "Auto : substitution sur Défense ; héroïque = relance du dernier échec avec +2.",
  force: "Auto : substitution sur Muscle ; héroïque guidé contre les animaux.",
  pendu: "Guidé : malaise passif ; héroïque = malus global sur échec de Volonté de la cible.",
  "sans-nom": "Passif : +2 dégâts signalés ; héroïque = terreur et malus -2 sur échec de Volonté.",
  temperance: "Guidé : immunité aux pouvoirs ; héroïque = sanctuaire de scène.",
  diable: "Manuel : final de campagne.",
  "maison-dieu": "Auto : substitution sur Combat ; héroïque = état 'primes doublées' sur une cible.",
  etoile: "Auto : substitution sur Volonté ; héroïque = sommeil sur échec de Volonté.",
  lune: "Auto : substitution sur Discrétion ; héroïque = état 'fondu dans l'obscurité'.",
  soleil: "Passif : Somme +2 appliquée ; héroïque = vision nocturne de scène.",
  jugement: "Auto : substitution sur Psychologie ; héroïque = lecture de pensées guidée.",
  monde: "Manuel : effets contextuels à la villa des Limbes."
};

function gmWhisperIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

function normalizeText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'"]/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function capitalized(str) {
  return String(str || "").charAt(0).toUpperCase() + String(str || "").slice(1);
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function axvPossessionLog(scope, message, data) {
  try {
    const prefix = `[ARCANE XV][POSSESSION][${scope}] ${message}`;
    if (data === undefined) console.log(prefix);
    else console.log(prefix, data);
  } catch (_err) {}
}

function axvPossessionSnapshot(item) {
  if (!item) return null;
  const state = getPersistedPossessionState(item);
  const startedAt = getStoredPossessionStartedAt(item);
  const modifiedAt = Number(item?._stats?.modifiedTime ?? item?._source?._stats?.modifiedTime ?? 0) || 0;
  return {
    actor: item.actor?.name ?? item.parent?.name ?? null,
    actorId: item.actor?.id ?? item.parent?.id ?? null,
    item: item.name ?? null,
    itemId: item.id ?? null,
    arcaneId: state.arcaneId,
    sataniste: state.sataniste,
    palier: state.possessionLevel,
    effet: state.possessionEffect,
    startedAt,
    startedAtIso: startedAt > 0 ? new Date(startedAt).toISOString() : null,
    modifiedAt,
    modifiedAtIso: modifiedAt > 0 ? new Date(modifiedAt).toISOString() : null,
    systemLevel: Number(item.system?.possessionLevel ?? 0) || 0,
    flagLevel: Number(item.flags?.arcane15?.possession?.level ?? item.flags?.arcane15?.possession?.possessionLevel ?? 0) || 0
  };
}

export class ArcanaManager {
  static #bannerNode = null;
  static #possessionTrackerApp = null;
  static #possessionTrackerOpenStamp = 0;
  static #syncingPossessionEffectItems = new Set();
  static #syncingActivePossessionActors = new Set();

  static init() {
    Hooks.on("getSceneControlButtons", controls => ArcanaManager.injectSceneControl(controls));
    Hooks.on("preUpdateItem", (item, changed, options = {}) => {
      if (item?.type !== "atoutArcane" || !(item?.actor ?? item?.parent)) return;
      axvPossessionLog("HOOK:preUpdateItem", "préparation mise à jour", {
        before: axvPossessionSnapshot(item),
        changed: foundry.utils.deepClone(changed)
      });
      ArcanaManager.preparePossessionTrackingUpdate(item, changed, options);
      axvPossessionLog("HOOK:preUpdateItem", "changed après préparation", {
        actor: item.actor?.name ?? item.parent?.name ?? null,
        item: item.name ?? null,
        changed: foundry.utils.deepClone(changed),
        options: {
          axvPreviousPossessionLevel: options.axvPreviousPossessionLevel,
          axvPreviousPossessionStartedAt: options.axvPreviousPossessionStartedAt
        }
      });
    });
    Hooks.on("createItem", (item, _data, options = {}) => {
      if (item?.type !== "atoutArcane" || !(item?.actor ?? item?.parent)) return;
      axvPossessionLog("HOOK:createItem", "item créé", { snapshot: axvPossessionSnapshot(item), options });
      void ArcanaManager.ensureItemPossessionEffectUpToDate(item, options);
      void ArcanaManager.syncActivePossessionForActor(item?.actor ?? item?.parent ?? null, { sourceItem: item, changed: _data, options, reason: "createItem" });
      ArcanaManager.syncPassiveActorBonuses(item);
      ArcanaManager.refreshUIForActor(item?.actor ?? item?.parent ?? null);
    });
    Hooks.on("updateItem", (item, _changed, options = {}) => {
      if (item?.type !== "atoutArcane" || !(item?.actor ?? item?.parent)) return;
      axvPossessionLog("HOOK:updateItem", "item mis à jour", {
        snapshot: axvPossessionSnapshot(item),
        changed: foundry.utils.deepClone(_changed),
        options
      });
      if (!options?.axvSkipPossessionEffectSync) void ArcanaManager.ensureItemPossessionEffectUpToDate(item, options);
      void ArcanaManager.syncActivePossessionForActor(item?.actor ?? item?.parent ?? null, { sourceItem: item, changed: _changed, options, reason: "updateItem" });
      ArcanaManager.syncPassiveActorBonuses(item);
      ArcanaManager.refreshUIForActor(item?.actor ?? item?.parent ?? null);
    });
    Hooks.on("deleteItem", (item) => {
      if (item?.type !== "atoutArcane" || !(item?.actor ?? item?.parent)) return;
      axvPossessionLog("HOOK:deleteItem", "item supprimé", { snapshot: axvPossessionSnapshot(item) });
      void ArcanaManager.syncActivePossessionForActor(item?.actor ?? item?.parent ?? null, { sourceItem: item, reason: "deleteItem" });
      ArcanaManager.syncPassiveActorBonuses(item);
      ArcanaManager.refreshUIForActor(item?.actor ?? item?.parent ?? null);
    });
    Hooks.on("createActor", () => ArcanaManager.renderPublicBanner());
    Hooks.on("updateActor", () => ArcanaManager.renderPublicBanner());
    Hooks.on("canvasReady", () => ArcanaManager.renderPublicBanner());
    Hooks.on("renderSceneControls", () => setTimeout(() => {
      ArcanaManager.renderPublicBanner();
      ArcanaManager.ensurePossessionButtonDom();
    }, 0));
    Hooks.on("renderSidebarTab", () => setTimeout(() => ArcanaManager.renderPublicBanner(), 0));
    Hooks.on("canvasReady", () => setTimeout(() => ArcanaManager.ensurePossessionButtonDom(), 50));
    Hooks.on("ready", () => setTimeout(() => ArcanaManager.ensurePossessionButtonDom(), 200));
    Hooks.on("renderChatMessageHTML", (message, html) => ArcanaManager.#bindChatButtons(message, html));
    Hooks.on("renderChatMessage", (message, html) => ArcanaManager.#bindChatButtons(message, html));
    ArcanaManager.#bindGlobalChatDelegation();
  }

  static async ready() {
    await ArcanaManager.#migrateLegacyCharacterAtouts();
    await ArcanaManager.ensureWorldArcanaItems();
    await ArcanaManager.seedLegacyArcanaOnActors();
    for (const actor of game.actors ?? []) {
      if (actor.type !== "personnage") continue;
      await ArcanaManager.syncPassiveActorBonuses(actor);
      await ArcanaManager.migrateLegacyActorPossession(actor);
      for (const item of actor.items.filter(i => i.type === "atoutArcane")) {
        await ArcanaManager.ensureItemPossessionEffectUpToDate(item);
        axvPossessionLog("READY", "état possession après synchronisation", axvPossessionSnapshot(item));
      }
      await ArcanaManager.syncActivePossessionForActor(actor, { reason: "ready" });
    }
    ArcanaManager.#ensureBannerNode();
    ArcanaManager.renderPublicBanner();
  }

  static getCharacterAtouts(actor) {
    const text = String(actor.system?.atouts?.personnage ?? actor._source?.system?.atouts?.personnage ?? "").trim();
    const normalized = normalizeText(text);
    const keys = new Set();
    for (const def of PERSONAL_ATOUT_DEFINITIONS) {
      if (normalized.includes(normalizeText(def.name))) keys.add(def.key);
    }
    if (!keys.size) {
      for (const key of DEFAULT_CHARACTER_ATOUTS_BY_ACTOR.get(normalizeText(actor.name)) ?? []) keys.add(key);
    }
    return [...keys].map(k => PERSONAL_BY_KEY.get(k)).filter(Boolean);
  }

  static getActorArcana(actor) {
    const actorPossession = getActorActivePossessionState(actor);
    return actor.items
      .filter(i => i.type === "atoutArcane")
      .sort((a, b) => {
        const ad = ARCANA_BY_ID.get(a.system?.arcaneId);
        const bd = ARCANA_BY_ID.get(b.system?.arcaneId);
        const aa = a.system?.active ? 0 : 1;
        const ba = b.system?.active ? 0 : 1;
        if (aa !== ba) return aa - ba;
        return Number(ad?.arcaneNumber ?? a.system?.arcaneNumber ?? 0) - Number(bd?.arcaneNumber ?? b.system?.arcaneNumber ?? 0);
      })
      .map(i => {
        const def = ARCANA_BY_ID.get(i.system?.arcaneId) ?? {};
        const sameSource = Number(actorPossession.level || 0) > 0 && (
          String(actorPossession.sourceItemId ?? "") === String(i.id ?? "")
          || (String(actorPossession.sourceArcaneId ?? "") && String(actorPossession.sourceArcaneId ?? "") === String(i.system?.arcaneId ?? ""))
        );
        const possessionLevel = sameSource ? Number(actorPossession.level || 0) : 0;
        const sataniste = sameSource
          ? (actorPossession.sourceSataniste || def.sataniste || "")
          : (i.system?.sataniste || def.sataniste || "");
        const possessionEffect = sameSource
          ? (actorPossession.currentEffectText || getPossessionEffectForArcane(i.system?.arcaneId, possessionLevel, sataniste))
          : getPossessionEffectForArcane(i.system?.arcaneId, 0, sataniste);
        return {
          id: i.id,
          arcaneId: i.system?.arcaneId,
          name: i.name || def.name || "Arcane majeur",
          img: i.img || def.img || "icons/svg/card-joker.svg",
          active: !!i.system?.active,
          linked: i.system?.linked !== false,
          currentEffect: i.system?.currentEffect || def.currentEffect || "",
          heroicEffect: i.system?.heroicEffect || def.heroicEffect || "",
          sataniste,
          possessionLevel,
          possessionEffect,
          heroicCost: Number(i.system?.heroicCost ?? 1),
          automationSummary: ARCANA_AUTOMATION_LABELS[i.system?.arcaneId] || "Automatisation partielle.",
          statusBadges: ArcanaManager.getArcanaStatusBadges(actor, i)
        };
      });
  }

  static getArcanaStatusBadges(actor, item) {
    const runtime = actor.getFlag?.("arcane15", "arcanaRuntime") || {};
    const badges = [];
    if (item.system?.arcaneId === "soleil" && item.system?.active) badges.push("Somme +2 active");
    if (item.system?.arcaneId === "sans-nom" && item.system?.active) badges.push("Dégâts +2 signalés");
    if (item.system?.arcaneId === "temperance" && runtime?.statuses?.temperanceSanctuary) badges.push("Sanctuaire actif");
    if (item.system?.arcaneId === "lune" && runtime?.statuses?.shadowBlend) badges.push("Fondu dans l’obscurité");
    if (item.system?.arcaneId === "soleil" && runtime?.statuses?.darkvision) badges.push("Vision nocturne active");
    if (item.system?.arcaneId === "chariot" && runtime?.pendingTechniqueBonus?.value) badges.push(`Technique +${Number(runtime.pendingTechniqueBonus.value)}`);
    return badges;
  }

  static getSkillModifiers(actor, skillKey) {
    const runtime = actor.getFlag?.("arcane15", "arcanaRuntime") || {};
    const labels = [];
    const consume = [];
    let net = 0;

    const pendingTechnique = runtime?.pendingTechniqueBonus;
    if (pendingTechnique?.value && String(skillKey || "").startsWith("technique")) {
      const bonus = Number(pendingTechnique.value || 0);
      if (bonus) {
        net += bonus;
        labels.push(`${pendingTechnique.label || 'Bonus Technique'} +${bonus}`);
        consume.push("pendingTechniqueBonus");
      }
    }

    const globalMalus = Number(runtime?.allTestsMalus?.value || 0);
    if (globalMalus) {
      net -= globalMalus;
      labels.push(`${runtime?.allTestsMalus?.label || 'Malus arcane'} -${globalMalus}`);
    }

    return { net, labels, consume };
  }

  static async consumeSkillModifiers(actor, consume = []) {
    if (!consume?.length) return;
    const unique = uniq(consume);
    const runtime = foundry.utils.deepClone(actor.getFlag?.("arcane15", "arcanaRuntime") || {});
    let dirty = false;
    for (const key of unique) {
      if (!foundry.utils.hasProperty(runtime, key)) continue;
      foundry.utils.unsetProperty(runtime, key);
      dirty = true;
    }
    if (dirty) await actor.setFlag("arcane15", "arcanaRuntime", runtime);
  }

  static getRollActionButtons(actor, skillKey, context = {}) {
    const options = ArcanaManager.#getSubstitutionArcana(actor, skillKey);
    if (!options.length) return "";
    const attrs = [
      `data-axv-roll-skill="${foundry.utils.escapeHTML(String(skillKey || ""))}"`,
      `data-axv-roll-difficulty="${Number(context.difficulty ?? 0)}"`,
      `data-axv-roll-skill-total="${Number(context.skillTotal ?? 0)}"`,
      `data-axv-roll-original-card="${Number(context.cardValue ?? 0)}"`,
      `data-axv-roll-original-final="${Number(context.finalTotal ?? 0)}"`,
      `data-axv-roll-skill-name="${foundry.utils.escapeHTML(String(context.skillName || skillKey || ""))}"`
    ].join(" ");
    return `<div class="axv-roll-actions">${options.map(item => `<button type="button" class="axv-roll-action-btn" data-axv-arcana-substitute data-actor-id="${actor.id}" data-item-id="${item.id}" ${attrs}>Substitution — ${foundry.utils.escapeHTML(item.name)}</button>`).join("")}</div>`;
  }

  static #getSubstitutionArcana(actor, skillKey) {
    return actor.items.filter(item => item.type === "atoutArcane" && item.system?.active && ArcanaManager.#arcaneMatchesSkill(item.system?.arcaneId, skillKey));
  }

  static #arcaneMatchesSkill(arcaneId, skillKey) {
    const key = String(skillKey || "").trim();
    if (!key) return false;
    const direct = SKILL_SUBSTITUTION_ARCANA[key] || [];
    if (direct.includes(arcaneId)) return true;
    for (const entry of PREFIX_SUBSTITUTION_ARCANA) {
      if (key.startsWith(entry.prefix) && entry.arcaneIds.includes(arcaneId)) return true;
    }
    return false;
  }

  static async syncPassiveActorBonuses(source) {
    const actor = source?.documentName === "Actor"
      ? source
      : (source?.actor ?? source?.parent ?? null);
    if (!actor) return;
    if (!actor?.isOwner && !game.user?.isGM) return;

    const previousSum = Number(actor.getFlag?.("arcane15", "arcaneAppliedSommeBonus") ?? 0);
    const nextSum = actor.items.filter(i => i.type === "atoutArcane" && i.system?.active && i.system?.arcaneId === "soleil").length * 2;
    const updates = {};
    if (previousSum !== nextSum) {
      const currentStored = Number(actor.system?.stats?.sommeMax ?? 0);
      updates["system.stats.sommeMax"] = Math.max(0, currentStored - previousSum + nextSum);
    }
    if (Object.keys(updates).length) await actor.update(updates);
    if (previousSum !== nextSum) await actor.setFlag("arcane15", "arcaneAppliedSommeBonus", nextSum);

    const previousDmg = Number(actor.getFlag?.("arcane15", "arcaneDamageBonus") ?? 0);
    const nextDmg = actor.items.filter(i => i.type === "atoutArcane" && i.system?.active && i.system?.arcaneId === "sans-nom").length * 2;
    if (previousDmg !== nextDmg) await actor.setFlag("arcane15", "arcaneDamageBonus", nextDmg);
  }

  static async resetLegacyItemPossession(actor) {
    if (!actor || actor.type !== "personnage") return false;
    let changedAny = false;
    for (const item of (actor.items ?? [])) {
      if (item?.type !== "atoutArcane") continue;
      const def = ARCANA_BY_ID.get(item.system?.arcaneId) ?? {};
      const zeroSataniste = String(item.system?.sataniste ?? def.sataniste ?? "");
      const zeroEffect = getPossessionEffectForArcane(item.system?.arcaneId || def.arcaneId || item, 0, zeroSataniste);
      const currentFlag = item.getFlag?.("arcane15", "possession") ?? item.flags?.arcane15?.possession ?? {};
      const updates = {};
      if (Number(item.system?.possessionLevel ?? 0) !== 0) updates["system.possessionLevel"] = 0;
      if (String(item.system?.possessionEffect ?? "") !== String(zeroEffect)) updates["system.possessionEffect"] = zeroEffect;
      if (String(currentFlag?.arcaneId ?? "") !== String(item.system?.arcaneId ?? def.arcaneId ?? "")) updates["flags.arcane15.possession.arcaneId"] = String(item.system?.arcaneId ?? def.arcaneId ?? "");
      if (String(currentFlag?.sataniste ?? "") !== zeroSataniste) updates["flags.arcane15.possession.sataniste"] = zeroSataniste;
      if (Number(currentFlag?.level ?? currentFlag?.possessionLevel ?? 0) !== 0) updates["flags.arcane15.possession.level"] = 0;
      if (String(currentFlag?.effect ?? currentFlag?.possessionEffect ?? "") !== String(zeroEffect)) updates["flags.arcane15.possession.effect"] = zeroEffect;
      if (Number(currentFlag?.startedAt ?? 0) !== 0) updates["flags.arcane15.possession.startedAt"] = 0;
      if (Object.keys(updates).length) {
        changedAny = true;
        await item.update(updates, { axvSkipPossessionEffectSync: true, axvSkipActorPossessionSync: true });
      }
    }
    return changedAny;
  }

  static async migrateLegacyActorPossession(actor, { force = false } = {}) {
    if (!actor || actor.type !== "personnage") return null;
    const current = getActorActivePossessionState(actor);
    if (!force && Number(current.level || 0) > 0) {
      await ArcanaManager.resetLegacyItemPossession(actor);
      return current;
    }
    const candidates = getActorPossessionCandidates(actor).sort(sortActorPossessionCandidates);
    const chosen = candidates[0] ?? null;
    if (!chosen) {
      if (Number(current.level || 0) > 0 || force) {
        const clear = buildClearActorActivePossessionUpdate();
        await actor.update(clear.updateData, { axvSkipActorPossessionSync: true });
      }
      await ArcanaManager.resetLegacyItemPossession(actor);
      return buildClearActorActivePossessionUpdate();
    }
    const desired = buildActorActivePossessionUpdate(actor, chosen.item, {
      previousState: current,
      level: chosen.level,
      startedAt: chosen.startedAt || Date.now(),
      lastChangeAt: Date.now(),
      sourceArcaneId: chosen.sourceArcaneId,
      sourceSataniste: chosen.sataniste
    });
    const prevComparable = buildActorPossessionComparable(current);
    const nextComparable = buildActorPossessionComparable(desired.state);
    if (JSON.stringify(prevComparable) !== JSON.stringify(nextComparable)) {
      await actor.update(desired.updateData, { axvSkipActorPossessionSync: true });
    }
    await ArcanaManager.resetLegacyItemPossession(actor);
    return desired.state;
  }

  static preparePossessionTrackingUpdate(item, changed, options = {}) {
    if (!item || item.type !== "atoutArcane") return;

    const previousState = getPersistedPossessionState(item);
    const previousLevel = previousState.possessionLevel;
    const nextLevel = getChangedPossessionLevel(changed, previousLevel);
    const currentStartedAt = getPossessionStartedAt(item, { preferNow: false });
    const explicitStartedAt = foundry.utils.getProperty(changed, "flags.arcane15.possession.startedAt");

    options.axvPreviousPossessionLevel = previousLevel;
    options.axvPreviousPossessionStartedAt = currentStartedAt;

    axvPossessionLog("PREPARE", "transition détectée", {
      actor: item.actor?.name ?? item.parent?.name ?? null,
      item: item.name ?? null,
      previousLevel,
      nextLevel,
      currentStartedAt,
      explicitStartedAt,
      previousState
    });

    if (explicitStartedAt !== undefined) {
      axvPossessionLog("PREPARE", "startedAt explicite conservé", {
        actor: item.actor?.name ?? item.parent?.name ?? null,
        item: item.name ?? null,
        explicitStartedAt
      });
      return;
    }

    if (previousLevel <= 0 && nextLevel > 0) {
      const ts = Date.now();
      foundry.utils.setProperty(changed, "flags.arcane15.possession.startedAt", ts);
      axvPossessionLog("PREPARE", "nouvelle possession détectée", {
        actor: item.actor?.name ?? item.parent?.name ?? null,
        item: item.name ?? null,
        startedAt: ts,
        startedAtIso: new Date(ts).toISOString()
      });
      return;
    }

    if (previousLevel > 0 && nextLevel > 0) {
      if (currentStartedAt > 0) {
        foundry.utils.setProperty(changed, "flags.arcane15.possession.startedAt", currentStartedAt);
        axvPossessionLog("PREPARE", "possession déjà active, startedAt conservé", {
          actor: item.actor?.name ?? item.parent?.name ?? null,
          item: item.name ?? null,
          startedAt: currentStartedAt,
          startedAtIso: new Date(currentStartedAt).toISOString()
        });
      }
      return;
    }

    if (previousLevel > 0 && nextLevel <= 0) {
      foundry.utils.setProperty(changed, "flags.arcane15.possession.startedAt", 0);
      axvPossessionLog("PREPARE", "fin de possession détectée", {
        actor: item.actor?.name ?? item.parent?.name ?? null,
        item: item.name ?? null
      });
    }
  }

  static async ensureItemPossessionEffectUpToDate(item, options = {}) {
    if (!item || item.type !== "atoutArcane") return false;
    if (options?.axvSkipPossessionEffectSync) {
      axvPossessionLog("SYNC", "sync ignorée par option", { snapshot: axvPossessionSnapshot(item), options });
      return false;
    }

    const syncKey = item.uuid ?? item.id ?? foundry.utils.randomID();
    if (ArcanaManager.#syncingPossessionEffectItems.has(syncKey)) {
      axvPossessionLog("SYNC", "sync ignorée car déjà en cours", { snapshot: axvPossessionSnapshot(item) });
      return false;
    }

    const def = ARCANA_BY_ID.get(item.system?.arcaneId) ?? {};
    const sataniste = String(item.system?.sataniste ?? def.sataniste ?? "");
    const zeroEffect = getPossessionEffectForArcane(item.system?.arcaneId || def.arcaneId || item, 0, sataniste);
    const currentFlag = item.getFlag?.("arcane15", "possession") ?? item.flags?.arcane15?.possession ?? {};
    const updates = {};
    if (Number(item.system?.possessionLevel ?? 0) !== 0) updates["system.possessionLevel"] = 0;
    if (String(item.system?.possessionEffect ?? "") !== String(zeroEffect)) updates["system.possessionEffect"] = zeroEffect;
    if (String(currentFlag?.arcaneId ?? "") !== String(item.system?.arcaneId ?? def.arcaneId ?? "")) updates["flags.arcane15.possession.arcaneId"] = String(item.system?.arcaneId ?? def.arcaneId ?? "");
    if (String(currentFlag?.sataniste ?? "") !== sataniste) updates["flags.arcane15.possession.sataniste"] = sataniste;
    if (Number(currentFlag?.level ?? currentFlag?.possessionLevel ?? 0) !== 0) updates["flags.arcane15.possession.level"] = 0;
    if (String(currentFlag?.effect ?? currentFlag?.possessionEffect ?? "") !== String(zeroEffect)) updates["flags.arcane15.possession.effect"] = zeroEffect;
    if (Number(currentFlag?.startedAt ?? 0) !== 0) updates["flags.arcane15.possession.startedAt"] = 0;

    axvPossessionLog("SYNC", "normalisation legacy item possession", {
      before: axvPossessionSnapshot(item),
      target: { possessionLevel: 0, possessionEffect: zeroEffect, sataniste },
      updates
    });

    if (!Object.keys(updates).length) return false;

    ArcanaManager.#syncingPossessionEffectItems.add(syncKey);
    try {
      await item.update(updates, { axvSkipPossessionEffectSync: true, axvSkipActorPossessionSync: true });
      return true;
    } catch (err) {
      console.warn("[ARCANE XV][POSSESSION] impossible de normaliser l'état legacy de possession de l'item", err);
      return false;
    } finally {
      ArcanaManager.#syncingPossessionEffectItems.delete(syncKey);
    }
  }

  static async syncActivePossessionForActor(source, { sourceItem = null, changed = null, options = {}, forceSource = false, reason = "sync" } = {}) {
    const actor = source?.actor ?? source?.parent ?? source ?? null;
    if (!actor || actor.type !== "personnage") return null;
    if (options?.axvSkipActorPossessionSync) return getActorActivePossessionState(actor);

    const actorKey = String(actor.uuid ?? actor.id ?? actor.name ?? foundry.utils.randomID());
    if (ArcanaManager.#syncingActivePossessionActors.has(actorKey)) {
      axvPossessionLog("ACTIVE", "sync ignorée car déjà en cours", { actor: actor.name, actorId: actor.id, reason });
      return getActorActivePossessionState(actor);
    }

    const previous = getActorActivePossessionState(actor);
    const currentSourceItem = Number(previous.level || 0) > 0
      ? (actor.items.get(previous.sourceItemId) ?? actor.items.find(i => i.type === "atoutArcane" && String(i.system?.arcaneId ?? "") === String(previous.sourceArcaneId ?? "")) ?? null)
      : null;
    const legacyCandidates = getActorPossessionCandidates(actor).sort(sortActorPossessionCandidates);
    const sourceLegacyCandidate = sourceItem ? legacyCandidates.find(candidate => String(candidate.sourceItemId ?? "") === String(sourceItem.id ?? "")) ?? null : null;
    const touchesLegacyPossession = !!changed && (
      foundry.utils.hasProperty(changed, "system.possessionLevel")
      || foundry.utils.hasProperty(changed, "system.possessionEffect")
      || foundry.utils.hasProperty(changed, "system.sataniste")
      || foundry.utils.hasProperty(changed, "flags.arcane15.possession")
    );
    const changedLevel = touchesLegacyPossession ? getChangedPossessionLevel(changed, sourceLegacyCandidate?.level ?? 0) : 0;
    const changedStartedAt = Number(foundry.utils.getProperty(changed, "flags.arcane15.possession.startedAt") ?? 0) || 0;

    let desired = null;
    let chosenDescriptor = null;

    if (forceSource && sourceItem) {
      const sameAsPrevious = String(previous.sourceItemId ?? "") === String(sourceItem.id ?? "")
        || (String(previous.sourceArcaneId ?? "") && String(previous.sourceArcaneId ?? "") === String(sourceItem.system?.arcaneId ?? ""));
      const nextLevel = sameAsPrevious && Number(previous.level || 0) > 0
        ? Number(previous.level || 0)
        : Math.max(1, Number(getPersistedPossessionState(sourceItem).possessionLevel || 1));
      desired = buildActorActivePossessionUpdate(actor, sourceItem, {
        previousState: previous,
        level: nextLevel,
        startedAt: sameAsPrevious ? previous.startedAt : Date.now(),
        lastChangeAt: Date.now(),
        sourceArcaneId: sourceItem.system?.arcaneId,
        sourceSataniste: sourceItem.system?.sataniste
      });
      chosenDescriptor = { mode: "forceSource", sourceItem: sourceItem.name, nextLevel };
    } else if (Number(previous.level || 0) > 0 && currentSourceItem) {
      desired = buildActorActivePossessionUpdate(actor, currentSourceItem, {
        previousState: previous,
        level: previous.level,
        startedAt: previous.startedAt,
        lastChangeAt: previous.lastChangeAt,
        sourceArcaneId: previous.sourceArcaneId,
        sourceSataniste: previous.sourceSataniste
      });
      chosenDescriptor = { mode: "actorSource", sourceItem: currentSourceItem.name, level: previous.level };
    } else if (touchesLegacyPossession && sourceItem && changedLevel > 0) {
      desired = buildActorActivePossessionUpdate(actor, sourceItem, {
        previousState: previous,
        level: changedLevel,
        startedAt: changedStartedAt || Date.now(),
        lastChangeAt: Date.now(),
        sourceArcaneId: sourceItem.system?.arcaneId,
        sourceSataniste: sourceItem.system?.sataniste
      });
      chosenDescriptor = { mode: "legacyChange", sourceItem: sourceItem.name, changedLevel };
    } else if (legacyCandidates.length) {
      const chosen = legacyCandidates[0];
      desired = buildActorActivePossessionUpdate(actor, chosen.item, {
        previousState: previous,
        level: chosen.level,
        startedAt: chosen.startedAt || Date.now(),
        lastChangeAt: Date.now(),
        sourceArcaneId: chosen.sourceArcaneId,
        sourceSataniste: chosen.sataniste
      });
      chosenDescriptor = { mode: "legacyMigration", sourceItem: chosen.item?.name ?? null, level: chosen.level };
    } else {
      desired = buildClearActorActivePossessionUpdate();
      chosenDescriptor = { mode: "clear" };
    }

    axvPossessionLog("ACTIVE", "évaluation possession acteur", {
      actor: actor.name,
      actorId: actor.id,
      actorUuid: actor.uuid ?? null,
      reason,
      previous,
      sourceItem: sourceItem ? axvPossessionSnapshot(sourceItem) : null,
      touchesLegacyPossession,
      changedLevel,
      changedStartedAt,
      legacyCandidates: legacyCandidates.map(candidate => ({
        sourceItemId: candidate.sourceItemId,
        sourceArcaneId: candidate.sourceArcaneId,
        arcane: candidate.arcane,
        sataniste: candidate.sataniste,
        level: candidate.level,
        startedAt: candidate.startedAt,
        lastActivityAt: candidate.lastActivityAt,
        modifiedAt: candidate.modifiedAt
      })),
      chosenDescriptor,
      desired: desired?.state ?? desired
    });

    const currentComparable = buildActorPossessionComparable(previous);
    const nextComparable = buildActorPossessionComparable(desired?.state ?? desired);
    if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) {
      return desired?.state ?? desired;
    }

    ArcanaManager.#syncingActivePossessionActors.add(actorKey);
    try {
      await actor.update(desired.updateData, { axvSkipActorPossessionSync: true });
      await ArcanaManager.resetLegacyItemPossession(actor);
      return desired?.state ?? desired;
    } catch (err) {
      console.warn("[ARCANE XV][POSSESSION] impossible de synchroniser la possession active de l'acteur", err);
      return previous;
    } finally {
      ArcanaManager.#syncingActivePossessionActors.delete(actorKey);
    }
  }

  static #refreshRenderedActorSheets(actor) {
    if (!actor) return;

    const actorId = actor?.id ?? null;
    const actorName = normalizeText(actor?.name ?? "");
    const trackingKey = ArcanaManager.#getPossessionTrackingKey(actor);

    try {
      if (actor.sheet?.rendered) actor.sheet.render(false);
    } catch (_err) {}

    for (const app of Object.values(ui.windows ?? {})) {
      try {
        const doc = app?.document ?? app?.object ?? null;
        if (!doc) continue;
        const docActor = doc?.actor ?? doc?.parent ?? doc;
        const docId = docActor?.id ?? doc?.id ?? null;
        const docName = normalizeText(docActor?.name ?? doc?.name ?? "");
        const docTrackingKey = ArcanaManager.#getPossessionTrackingKey(docActor);
        const sameActor = (docId && actorId && docId === actorId)
          || (docTrackingKey && trackingKey && docTrackingKey === trackingKey)
          || (docName && actorName && docName === actorName);
        if (!sameActor) continue;
        if (typeof app.render === "function") app.render(false);
      } catch (_err) {}
    }
  }

  static #getPossessionTrackerRows() {
    const trackedActors = ArcanaManager.#getPossessionTrackedActors();
    const grouped = new Map();

    const sortRows = (a, b) => {
      const changeDelta = (Number(b?.lastChangeAt ?? b?.lastShiftAt ?? 0) || 0) - (Number(a?.lastChangeAt ?? a?.lastShiftAt ?? 0) || 0);
      if (changeDelta !== 0) return changeDelta;
      return sortActorPossessionCandidates(a, b);
    };

    for (const actor of trackedActors) {
      const trackingKey = ArcanaManager.#getPossessionTrackingKey(actor);
      const actorPossession = getActorActivePossessionState(actor);
      axvPossessionLog("TRACKER", "candidats pour le suivi", {
        actor: actor.name,
        actorId: actor.id,
        actorUuid: actor.uuid ?? null,
        isTokenActor: !!actor.isToken,
        trackingKey,
        actorPossession
      });
      if (Number(actorPossession.level || 0) <= 0 || !String(actorPossession.sourceArcaneId || "")) continue;
      const def = ARCANA_BY_ID.get(actorPossession.sourceArcaneId) ?? {};
      const row = {
        trackingKey,
        actorId: actor.id,
        actorUuid: actor.uuid ?? null,
        isTokenActor: !!actor.isToken,
        actor: foundry.utils.escapeHTML(actor.name || ""),
        arcane: foundry.utils.escapeHTML(actorPossession.arcane || def.name || ""),
        sataniste: foundry.utils.escapeHTML(actorPossession.sourceSataniste || def.sataniste || ""),
        palier: Math.max(0, Math.min(6, Number(actorPossession.level) || 0)),
        effet: foundry.utils.escapeHTML(actorPossession.currentEffectText || getPossessionEffectForArcane(actorPossession.sourceArcaneId, actorPossession.level, actorPossession.sourceSataniste) || ""),
        startedAt: Number(actorPossession.startedAt || 0) || 0,
        lastChangeAt: Number(actorPossession.lastChangeAt || 0) || 0,
        lastShiftAt: Number(actorPossession.lastChangeAt || 0) || 0,
        sourceItemId: String(actorPossession.sourceItemId ?? ""),
        sourceArcaneId: String(actorPossession.sourceArcaneId ?? "")
      };
      if (!grouped.has(trackingKey)) grouped.set(trackingKey, []);
      grouped.get(trackingKey).push(row);
    }

    const rows = [...grouped.entries()]
      .map(([trackingKey, candidates]) => {
        const sorted = [...candidates].sort(sortRows);
        const chosen = sorted[0] ?? null;
        axvPossessionLog("TRACKER", "choix final pour le personnage", { trackingKey, candidates: sorted, chosen });
        return chosen;
      })
      .filter(Boolean)
      .sort(sortRows);

    axvPossessionLog("TRACKER", "lignes finales du suivi", { trackedActorCount: trackedActors.length, uniqueCharacterCount: grouped.size, rows });
    return { trackedActors, rows };
  }

  static #getApplicationElement(app) {
    const el = app?.element ?? null;
    if (!el) return null;
    if (el instanceof HTMLElement) return el;
    if (Array.isArray(el)) return el[0] ?? null;
    if (el?.jquery) return el[0] ?? null;
    if (typeof el.get === "function") return el.get(0) ?? null;
    return null;
  }

  static refreshPossessionTracker() {
    const app = ArcanaManager.#possessionTrackerApp;
    if (!app || app?.closing || !app?.rendered) return;

    const { trackedActors, rows } = ArcanaManager.#getPossessionTrackerRows();
    axvPossessionLog("TRACKER", "rafraîchissement fenêtre", { trackedActors: trackedActors.length, rows });
    const content = ArcanaManager.#buildPossessionTrackerContent(rows, trackedActors.length);
    const root = ArcanaManager.#getApplicationElement(app);
    const host = root?.querySelector?.(".window-content") ?? null;

    if (host) {
      host.innerHTML = content;
      return;
    }

    try {
      app.render(true);
    } catch (_err) {}
  }

  static refreshUIForActor(source) {
    const actor = source?.actor ?? source?.parent ?? source ?? null;
    const relatedActors = new Map();
    const addRelated = candidate => {
      if (!candidate) return;
      const key = String(candidate.uuid ?? candidate.id ?? "").trim() || `rel:${relatedActors.size}`;
      if (relatedActors.has(key)) return;
      relatedActors.set(key, candidate);
    };
    addRelated(actor);
    const actorNameKey = normalizeText(actor?.name ?? "");
    const trackingKey = actor ? ArcanaManager.#getPossessionTrackingKey(actor) : "";
    for (const candidate of (game.actors?.contents ?? [])) {
      if (!candidate) continue;
      const sameTrackingKey = trackingKey && ArcanaManager.#getPossessionTrackingKey(candidate) === trackingKey;
      const sameName = actorNameKey && normalizeText(candidate.name ?? "") === actorNameKey;
      if (sameTrackingKey || sameName) addRelated(candidate);
    }
    for (const token of (canvas?.tokens?.placeables ?? [])) {
      const candidate = token?.actor ?? null;
      if (!candidate) continue;
      const sameTrackingKey = trackingKey && ArcanaManager.#getPossessionTrackingKey(candidate) === trackingKey;
      const sameName = actorNameKey && normalizeText(candidate.name ?? "") === actorNameKey;
      if (sameTrackingKey || sameName) addRelated(candidate);
    }

    axvPossessionLog("UI", "rafraîchissement UI acteur", {
      actor: actor?.name ?? null,
      actorId: actor?.id ?? null,
      trackingKey,
      relatedActors: [...relatedActors.values()].map(a => ({
        actor: a?.name ?? null,
        actorId: a?.id ?? null,
        actorUuid: a?.uuid ?? null,
        isTokenActor: !!a?.isToken,
        trackingKey: ArcanaManager.#getPossessionTrackingKey(a),
        actorPossession: getActorActivePossessionState(a), activeArcana: a?.items?.filter?.(i => i.type === "atoutArcane").map(i => ({ ...axvPossessionSnapshot(i), displayLevel: (String(getActorActivePossessionState(a).sourceItemId ?? "") === String(i.id ?? "") || String(getActorActivePossessionState(a).sourceArcaneId ?? "") === String(i.system?.arcaneId ?? "")) ? Number(getActorActivePossessionState(a).level || 0) : 0 })) ?? []
      }))
    });
    queueMicrotask(() => {
      ArcanaManager.renderPublicBanner();
      ArcanaManager.refreshPossessionTracker();
      for (const candidate of relatedActors.values()) ArcanaManager.#refreshRenderedActorSheets(candidate);
    });
    setTimeout(() => {
      ArcanaManager.renderPublicBanner();
      ArcanaManager.refreshPossessionTracker();
    }, 25);
  }

  static bindSheet(sheet) {
    const root = sheet.element;
    if (!root) return;

    const panel = root.querySelector("[data-arcana-dropzone]");
    if (panel && !panel.dataset.axvArcanaBound) {
      panel.dataset.axvArcanaBound = "1";
      panel.addEventListener("dragenter", ev => { ev.preventDefault(); panel.dataset.dropActive = "1"; });
      panel.addEventListener("dragover", ev => { ev.preventDefault(); panel.dataset.dropActive = "1"; });
      panel.addEventListener("dragleave", () => { delete panel.dataset.dropActive; });
      panel.addEventListener("drop", () => { delete panel.dataset.dropActive; });
    }

    root.querySelectorAll(".axv-arcana-activate").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); ArcanaManager.requestActivation(sheet.document, ev.currentTarget.dataset.itemId); });
    });
    root.querySelectorAll(".axv-arcana-deactivate").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); ArcanaManager.deactivateArcane(sheet.document, ev.currentTarget.dataset.itemId); });
    });
    root.querySelectorAll(".axv-arcana-heroic").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); ArcanaManager.useHeroicEffect(sheet.document, ev.currentTarget.dataset.itemId); });
    });
    root.querySelectorAll(".axv-arcana-remove").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); ArcanaManager.removeArcaneFromActor(sheet.document, ev.currentTarget.dataset.itemId); });
    });
  }

  static async handleActorSheetDrop(sheet, event) {
    const data = TextEditor.getDragEventData(event);
    if (!data || data.type !== "Item") return false;
    const dropped = data.uuid ? await fromUuid(data.uuid) : game.items.get(data.id);
    if (!dropped || dropped.type !== "atoutArcane") return false;
    event.preventDefault();
    event.stopPropagation();
    await ArcanaManager.addArcaneToActor(sheet.document, dropped);
    return true;
  }

  static async #migrateLegacyCharacterAtouts() {
    if (!game.user?.isGM) return;
    for (const actor of game.actors ?? []) {
      if (actor.type !== "personnage") continue;
      const updates = {};
      const legacy = String(actor._source?.system?.description?.atouts ?? "").trim();
      const current = String(actor.system?.atouts?.personnage ?? "").trim();
      if (legacy && !current) updates["system.atouts.personnage"] = legacy;
      if (!legacy && !current) {
        const defaults = DEFAULT_CHARACTER_ATOUTS_BY_ACTOR.get(normalizeText(actor.name)) ?? [];
        if (defaults.length) {
          updates["system.atouts.personnage"] = defaults.map(k => PERSONAL_BY_KEY.get(k)?.name).filter(Boolean).join("\n");
        }
      }
      if (Object.prototype.hasOwnProperty.call(actor._source?.system?.description ?? {}, "atouts")) {
        updates["system.description.-=atouts"] = null;
      }
      if (Object.keys(updates).length) {
        try { await actor.update(updates); } catch (err) { console.warn("[ARCANE XV][ARCANA] migration atouts legacy", actor.name, err); }
      }
    }
  }

  static async #ensureWorldArcanaFolder() {
    if (!game.user?.isGM) return null;
    let folder = game.folders?.find(f => f.type === "Item" && !f.folder && f.name === "Atouts d'arcane majeur") ?? null;
    if (!folder) {
      folder = await Folder.create({ name: "Atouts d'arcane majeur", type: "Item", color: "#7a0019", sorting: "a" });
    }
    return folder;
  }

  static async ensureWorldArcanaItems() {
    if (!game.user?.isGM) return;
    const folder = await ArcanaManager.#ensureWorldArcanaFolder();
    const existing = game.items.filter(i => i.type === "atoutArcane");
    const byId = new Map(existing.map(i => [i.system?.arcaneId, i]));
    const toCreate = [];

    for (const def of ARCANA_DEFINITIONS) {
      const item = byId.get(def.arcaneId);
      const systemData = {
        arcaneId: def.arcaneId,
        arcaneNumber: def.arcaneNumber,
        linked: true,
        active: false,
        currentEffect: def.currentEffect,
        heroicEffect: def.heroicEffect,
        heroicCost: def.heroicCost,
        sataniste: def.sataniste,
        possessionLevel: 0,
        possessionEffect: getPossessionEffectForArcane(def.arcaneId, 0, def.sataniste),
        lastHeroicAt: 0,
        notes: ""
      };
      const possessionFlags = {
        arcaneId: def.arcaneId,
        sataniste: def.sataniste,
        level: 0,
        effect: getPossessionEffectForArcane(def.arcaneId, 0, def.sataniste),
        startedAt: 0
      };
      if (!item) {
        toCreate.push({ name: def.name, type: "atoutArcane", img: def.img, folder: folder?.id ?? null, system: systemData, flags: { arcane15: { possession: possessionFlags } } });
        continue;
      }
      const updates = {};
      if (item.name !== def.name) updates.name = def.name;
      if (item.img !== def.img) updates.img = def.img;
      if ((item.folder?.id ?? item.folder) !== (folder?.id ?? null) && folder?.id) updates.folder = folder.id;
      for (const [k, v] of Object.entries(systemData)) {
        if (JSON.stringify(item.system?.[k]) !== JSON.stringify(v)) updates[`system.${k}`] = v;
      }
      if (JSON.stringify(item.flags?.arcane15?.possession ?? null) !== JSON.stringify(possessionFlags)) updates["flags.arcane15.possession"] = possessionFlags;
      if (Object.keys(updates).length) await item.update(updates);
    }

    if (toCreate.length) await Item.createDocuments(toCreate);
  }

  static #suggestArcanaIdsForActor(actor) {
    const found = [];
    const actorNameKey = normalizeText(actor.name);
    found.push(...(DEFAULT_ARCANA_BY_ACTOR.get(actorNameKey) ?? []));
    const legacy = `${actor.system?.description?.arcanes ?? ""} ${actor._source?.system?.description?.arcanes ?? ""}`;
    const normLegacy = normalizeText(legacy);
    for (const [label, id] of Object.entries(ARCANA_NAME_ALIASES)) {
      if (normLegacy.includes(normalizeText(label))) found.push(id);
    }
    return uniq(found);
  }

  static async seedLegacyArcanaOnActors() {
    if (!game.user?.isGM) return;
    for (const actor of game.actors ?? []) {
      if (actor.type !== "personnage") continue;
      const desired = ArcanaManager.#suggestArcanaIdsForActor(actor);
      if (!desired.length) continue;
      const current = new Set(actor.items.filter(i => i.type === "atoutArcane").map(i => i.system?.arcaneId));
      for (const arcaneId of desired) {
        if (current.has(arcaneId)) continue;
        const source = game.items.find(i => i.type === "atoutArcane" && i.system?.arcaneId === arcaneId);
        if (source) {
          try {
            await ArcanaManager.addArcaneToActor(actor, source, { silent: true });
          } catch (err) {
            console.warn("[ARCANE XV][ARCANA] seed actor arcana failed", actor.name, arcaneId, err);
          }
        }
      }
    }
  }

  static async addArcaneToActor(actor, sourceItem, { silent = false } = {}) {
    const source = sourceItem.toObject ? sourceItem.toObject() : sourceItem;
    const arcaneId = source.system?.arcaneId;
    if (!arcaneId) return ui.notifications?.error?.("Atout invalide : arcaneId manquant.");
    if (actor.items.some(i => i.type === "atoutArcane" && i.system?.arcaneId === arcaneId)) {
      if (!silent) ui.notifications?.warn?.("Cet arcane est déjà lié à ce personnage.");
      return;
    }
    const count = actor.items.filter(i => i.type === "atoutArcane").length;
    if (count >= 4) {
      if (!silent) ui.notifications?.warn?.("Un personnage ne peut être lié qu’à quatre arcanes majeurs au maximum.");
      return;
    }
    const def = ARCANA_BY_ID.get(arcaneId) || {};
    const createSataniste = source.system?.sataniste ?? def.sataniste ?? "";
    const createEffect = getPossessionEffectForArcane(arcaneId, 0, createSataniste);
    const createData = {
      name: source.name || def.name || "Arcane majeur",
      type: "atoutArcane",
      img: source.img || def.img || "icons/svg/card-joker.svg",
      system: {
        ...(source.system || {}),
        arcaneId,
        arcaneNumber: Number(source.system?.arcaneNumber ?? def.arcaneNumber ?? 0),
        linked: true,
        active: false,
        currentEffect: source.system?.currentEffect ?? def.currentEffect ?? "",
        heroicEffect: source.system?.heroicEffect ?? def.heroicEffect ?? "",
        heroicCost: Number(source.system?.heroicCost ?? def.heroicCost ?? 1),
        sataniste: createSataniste,
        possessionLevel: 0,
        possessionEffect: createEffect,
        lastHeroicAt: 0,
        notes: source.system?.notes ?? ""
      },
      flags: {
        arcane15: {
          possession: {
            arcaneId,
            sataniste: createSataniste,
            level: 0,
            effect: createEffect,
            startedAt: 0
          }
        }
      }
    };
    await actor.createEmbeddedDocuments("Item", [createData]);
  }

  static async removeArcaneFromActor(actor, itemId) {
    const item = actor.items.get(itemId);
    if (!item) return;
    await item.delete();
  }


  static async #resolveActorAndItem(ref = {}) {
    let actor = null;
    let item = null;

    const itemUuid = ref.itemUuid ?? null;
    const actorUuid = ref.actorUuid ?? null;
    const itemId = ref.itemId ?? null;
    const actorId = ref.actorId ?? null;

    if (itemUuid && typeof fromUuid === "function") {
      try { item = await fromUuid(itemUuid); } catch (_) { item = null; }
      actor = item?.actor ?? item?.parent ?? actor;
    }

    if (!actor && actorUuid && typeof fromUuid === "function") {
      try { actor = await fromUuid(actorUuid); } catch (_) { actor = null; }
    }

    if (!actor && actorId) {
      actor = game.actors?.get?.(actorId) ?? null;
    }

    if (!item && actor && itemId) {
      item = actor.items?.get?.(itemId) ?? null;
    }

    if (!item && itemId) {
      const worldItem = game.items?.get?.(itemId) ?? null;
      if (worldItem && (worldItem.actor || worldItem.parent)) {
        item = worldItem;
        actor = item.actor ?? item.parent ?? actor;
      }
    }

    return { actor: actor ?? null, item: item ?? null };
  }

  static async requestActivation(actor, itemId) {
    const item = actor.items.get(itemId);
    if (!item) return;
    if (item.system?.active) return ui.notifications?.info?.(`${item.name} est déjà actif.`);
    const result = await ArcanaManager.#rollFixedSkill(actor, "volonte", {
      title: `${actor.name} — Activation de ${item.name}`,
      subtitle: "Test de Volonté / 12 pour activer l’arcane majeur.",
      difficulty: 12,
      chatTitle: `${actor.name} active ${item.name}`,
      chatNote: "Activation d’arcane majeur"
    });
    if (!result) return;
    if (result.success) {
      await item.update({ "system.active": true });
      const refreshedActor = game.actors.get(actor.id) ?? actor;
      const refreshedItem = refreshedActor.items.get(item.id) ?? item;
      await ArcanaManager.syncPassiveActorBonuses(refreshedActor);
      await ArcanaManager.#postPublicArcanaMessage(refreshedActor, refreshedItem, false, "activation réussie");
      ArcanaManager.refreshUIForActor(refreshedActor);
      return;
    }
    await ArcanaManager.#postActivationFailureForGM(actor, item, result);
  }

  static async confirmActivationByGM(actorRef, itemRef, messageId, approved, actorUuid = null, itemUuid = null) {
    if (!game.user?.isGM) return;

    const refs = (typeof actorRef === "object" && actorRef)
      ? actorRef
      : { actorId: actorRef, itemId: itemRef, actorUuid, itemUuid };

    const resolved = await ArcanaManager.#resolveActorAndItem(refs);
    const actor = resolved.actor;
    const item = resolved.item;
    if (!actor || !item) return;

    if (approved) {
      await item.update({ "system.active": true });
      const refreshed = await ArcanaManager.#resolveActorAndItem({
        actorUuid: actor.uuid,
        itemUuid: item.uuid,
        actorId: actor.id,
        itemId: item.id
      });
      const refreshedActor = refreshed.actor ?? actor;
      const refreshedItem = refreshed.item ?? item;
      await ArcanaManager.syncPassiveActorBonuses(refreshedActor);
      await ArcanaManager.#postPublicArcanaMessage(refreshedActor, refreshedItem, false, "activation validée par le MJ (hors stress)");
      ArcanaManager.refreshUIForActor(refreshedActor);
      setTimeout(() => ArcanaManager.refreshUIForActor(refreshedActor), 75);
      setTimeout(() => ArcanaManager.renderPublicBanner(), 75);
    }

    const msg = messageId ? game.messages.get(messageId) : null;
    if (msg) {
      const status = approved ? "Activation validée par le MJ." : "Activation refusée par le MJ.";
      await msg.update({
        content: `<div class="axv-arcana-gm-card"><div><strong>${actor.name}</strong> — ${item.name}</div><div style="margin-top:6px;">${status}</div></div>`
      });
    }
  }

  static async deactivateArcane(actor, itemId) {
    const refs = {
      actorUuid: actor?.uuid ?? null,
      actorId: actor?.id ?? null,
      itemId
    };

    const resolved = await ArcanaManager.#resolveActorAndItem(refs);
    const liveActor = resolved.actor ?? actor ?? null;
    const item = resolved.item ?? liveActor?.items?.get?.(itemId) ?? actor?.items?.get?.(itemId) ?? null;
    if (!liveActor || !item) return;
    if (!item.system?.active) return;

    // Retire immédiatement la carte du bandeau pour éviter tout état visuel figé
    // pendant le cycle d'update Foundry.
    ArcanaManager.#removeBannerCard(item, liveActor);

    await item.update({ "system.active": false, "system.lastHeroicAt": 0 });

    const refreshed = await ArcanaManager.#resolveActorAndItem({
      actorUuid: liveActor?.uuid ?? null,
      actorId: liveActor?.id ?? null,
      itemUuid: item?.uuid ?? null,
      itemId: item?.id ?? itemId
    });

    const refreshedActor = refreshed.actor ?? liveActor;
    const refreshedItem = refreshed.item ?? item;
    await ArcanaManager.syncPassiveActorBonuses(refreshedActor);
    await ArcanaManager.#postPublicArcanaMessage(refreshedActor, refreshedItem, false, "désactivation");
    ArcanaManager.refreshUIForActor(refreshedActor);
    queueMicrotask(() => ArcanaManager.renderPublicBanner());
    setTimeout(() => ArcanaManager.renderPublicBanner(), 25);
    setTimeout(() => ArcanaManager.renderPublicBanner(), 100);
    setTimeout(() => {
      const node = document.getElementById("axv-arcana-banner");
      if (node && !node.querySelector(".axv-banner-card")) {
        node.innerHTML = "";
        node.hidden = true;
        node.style.display = "none";
      }
    }, 120);
  }

  static async useHeroicEffect(actor, itemId) {
    const item = actor.items.get(itemId);
    if (!item) return;
    if (!item.system?.active) return ui.notifications?.warn?.("L’arcane doit être actif pour utiliser l’effet héroïque.");
    const cost = Number(item.system?.heroicCost ?? 1);
    const destin = Number(actor.system?.stats?.destin ?? 0);
    if (destin < cost) return ui.notifications?.warn?.("Pas assez de points de Destin.");

    await actor.update({ "system.stats.destin": destin - cost });
    await item.update({ "system.lastHeroicAt": Date.now() });
    const refreshedActor = game.actors.get(actor.id) ?? actor;
    const refreshedItem = refreshedActor.items.get(item.id) ?? item;
    await ArcanaManager.#postPublicArcanaMessage(refreshedActor, refreshedItem, true, "effet héroïque");
    ArcanaManager.refreshUIForActor(refreshedActor);
    await ArcanaManager.#applyHeroicAutomation(actor, item);

    const possessionDiff = ArcanaManager.computePossessionDifficulty(actor);
    const result = await ArcanaManager.#rollFixedSkill(actor, "volonte", {
      title: `${actor.name} — Test de Possession (${item.name})`,
      subtitle: `Effet héroïque : ${item.name} — difficulté ${possessionDiff}`,
      difficulty: possessionDiff,
      chatTitle: `${actor.name} — test de Possession`,
      chatNote: `Après usage héroïque de ${item.name}`
    });
    if (!result) return;
    await ArcanaManager.#postPossessionResistanceRollForGM(actor, item, result, possessionDiff);
    if (!result.success) await ArcanaManager.increasePossession(actor, item);
  }

  static computePossessionDifficulty(actor) {
    return 8 + (2 * ArcanaManager.countNearbyActiveArcana(actor));
  }

  static countNearbyActiveArcana(actor, rangeMeters = 10) {
    const activeItems = (game.actors?.contents ?? []).flatMap(a => a.items.filter(i => i.type === "atoutArcane" && i.system?.active));
    const sourceToken = actor.getActiveTokens?.(true, true)?.[0] ?? null;
    if (!sourceToken || !canvas?.scene) return activeItems.length;
    const rangePx = (rangeMeters / Number(canvas.scene.grid.distance || 1)) * Number(canvas.scene.grid.size || 100);
    let count = 0;
    for (const item of activeItems) {
      const tokens = item.parent?.getActiveTokens?.(true, true) ?? [];
      const near = tokens.some(t => {
        const dx = (t.center?.x ?? t.x) - (sourceToken.center?.x ?? sourceToken.x);
        const dy = (t.center?.y ?? t.y) - (sourceToken.center?.y ?? sourceToken.y);
        return Math.hypot(dx, dy) <= rangePx + 1;
      });
      if (near) count += 1;
    }
    return count;
  }


  static async #applyHeroicAutomation(actor, item) {
    const arcaneId = item.system?.arcaneId;
    switch (arcaneId) {
      case "chariot":
        return ArcanaManager.#applyChariotHeroic(actor, item);
      case "roue-fortune":
        return ArcanaManager.#applyRoueFortuneHeroic(actor, item);
      case "justice":
        return ArcanaManager.#applyJusticeHeroic(actor, item);
      case "imperatrice":
      case "empereur":
      case "ermite":
      case "pendu":
      case "sans-nom":
      case "etoile":
      case "maison-dieu":
      case "jugement":
        return ArcanaManager.#applyTargetedHeroic(actor, item);
      case "temperance":
        return ArcanaManager.#setSceneStatus(actor, { temperanceSanctuary: true }, `${actor.name} est désormais protégé par La Tempérance pour la scène.`);
      case "lune":
        return ArcanaManager.#setSceneStatus(actor, { shadowBlend: true }, `${actor.name} se fond désormais dans l’obscurité.`);
      case "soleil":
        return ArcanaManager.#setSceneStatus(actor, { darkvision: true }, `${actor.name} voit désormais dans l’obscurité comme en plein jour.`);
      case "pape":
      case "amoureux":
      case "force":
      case "diable":
      case "monde":
      case "mat":
      case "papesse":
      default:
        return ArcanaManager.#postGuidedHeroicNote(actor, item);
    }
  }

  static async #postGuidedHeroicNote(actor, item) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${item.name}</strong> : effet héroïque déclenché. Cet effet reste guidé / manuel dans le système. Référence : ${item.system?.heroicEffect || ""}</div></div>`
    });
  }

  static async #setSceneStatus(actor, patch, label) {
    const runtime = foundry.utils.deepClone(actor.getFlag?.("arcane15", "arcanaRuntime") || {});
    runtime.statuses ||= {};
    Object.assign(runtime.statuses, patch);
    await actor.setFlag("arcane15", "arcanaRuntime", runtime);
    if (label) {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;">${label}</div></div>` });
    }
  }

  static async #applyChariotHeroic(actor, item) {
    const draw = await ArcanaManager.#drawTemporaryCard(actor, `${item.name} — bonus Technique`);
    if (!draw) return;
    const runtime = foundry.utils.deepClone(actor.getFlag?.("arcane15", "arcanaRuntime") || {});
    runtime.pendingTechniqueBonus = { value: draw.value, label: `${item.name}` };
    await actor.setFlag("arcane15", "arcanaRuntime", runtime);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${item.name}</strong> : bonus stocké pour le prochain test de Technique : <strong>+${draw.value}</strong>.</div></div>`
    });
  }

  static async #applyRoueFortuneHeroic(actor, item) {
    const last = actor.getFlag?.("arcane15", "lastSkillTest") || {};
    if (!last.skillKey || last.success || !Number.isFinite(Number(last.difficulty))) {
      ui.notifications?.warn?.("Aucun échec récent à relancer pour La Roue de fortune.");
      return;
    }
    await ArcanaManager.#rollFixedSkill(actor, last.skillKey, {
      title: `${actor.name} — ${item.name}`,
      subtitle: `Relance du dernier échec avec bonus +2.`,
      difficulty: Number(last.difficulty || 0),
      chatTitle: `${actor.name} — relance ${item.name}`,
      chatNote: `Relance héroïque de ${item.name}`,
      bonus: 2
    });
  }

  static async #applyJusticeHeroic(actor, item) {
    const target = Array.from(game.user?.targets ?? [])[0]?.actor || null;
    const content = `<form><div class="form-group"><label>Dégâts subis</label><input type="number" name="amount" value="1" min="1" step="1"></div><div class="form-group"><label>Cible actuelle</label><div>${target?.name || "Aucune cible"}</div></div></form>`;
    const dlg = new DialogV2({
      window: { title: `${item.name} — Riposte` },
      content,
      buttons: [
        { action: "cancel", label: "Annuler" },
        { action: "ok", label: "Valider", default: true, callback: async (_e, button) => {
          const amount = Math.max(0, Number(button?.form?.elements?.amount?.value ?? 0));
          if (!target) return ui.notifications?.warn?.("Ciblez l’agresseur avant d’utiliser La Justice.");
          const current = Number(target.system?.stats?.vitalite ?? 0);
          await target.update({ "system.stats.vitalite": Math.max(0, current - amount) });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${item.name}</strong> : ${target.name} perd ${amount} point(s) de Vitalité.</div></div>` });
        } }
      ]
    });
    await dlg.render({ force: true });
  }

  static async #applyTargetedHeroic(actor, item) {
    const target = Array.from(game.user?.targets ?? [])[0]?.actor || null;
    if (!target) {
      ui.notifications?.warn?.("Cible un personnage ou un PNJ pour appliquer cet effet héroïque.");
      return;
    }
    const difficulty = 10 + (2 * ArcanaManager.countNearbyActiveArcana(target));
    const save = await ArcanaManager.#rollFixedSkill(target, "volonte", {
      title: `${target.name} — résistance à ${item.name}`,
      subtitle: `${item.name} : test de Volonté difficulté ${difficulty}`,
      difficulty,
      chatTitle: `${target.name} résiste à ${item.name}`,
      chatNote: `Effet héroïque ciblé de ${actor.name}`
    });
    if (!save || save.success) {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;">${target.name} résiste à l’effet héroïque de <strong>${item.name}</strong>.</div></div>` });
      return;
    }

    const runtime = foundry.utils.deepClone(target.getFlag?.("arcane15", "arcanaRuntime") || {});
    runtime.statuses ||= {};
    let message = `${target.name} subit l’effet héroïque de ${item.name}.`;
    switch (item.system?.arcaneId) {
      case "imperatrice":
        runtime.statuses.friendByImperatrice = actor.name;
        message = `${target.name} considère désormais ${actor.name} comme un ami pour la scène.`;
        break;
      case "empereur":
        runtime.statuses.commandedByEmpereur = actor.name;
        message = `${target.name} obéit à l’ordre simple donné par ${actor.name}.`;
        break;
      case "ermite":
        runtime.statuses.truthBoundByErmite = actor.name;
        message = `${target.name} doit répondre franchement à la question posée.`;
        break;
      case "pendu": {
        const draw = await ArcanaManager.#drawTemporaryCard(actor, `${item.name} — malus`);
        const malus = Number(draw?.value ?? 1);
        runtime.allTestsMalus = { value: malus, label: `${item.name}` };
        message = `${target.name} entre dans la confusion et subit un malus global de -${malus}.`;
        break;
      }
      case "sans-nom":
        runtime.allTestsMalus = { value: 2, label: `${item.name}` };
        message = `${target.name} est terrorisé et subit un malus global de -2.`;
        break;
      case "etoile":
        runtime.statuses.asleepByEtoile = actor.name;
        message = `${target.name} s’endort profondément pour au moins une heure.`;
        break;
      case "maison-dieu":
        runtime.statuses.doublePrimes = true;
        message = `${target.name} subit désormais des primes doublées pendant l’affrontement.`;
        break;
      case "jugement":
        runtime.statuses.surfaceThoughtsOpen = actor.name;
        message = `${actor.name} perçoit désormais les pensées superficielles de ${target.name} pendant une minute.`;
        break;
      default:
        break;
    }
    await target.setFlag("arcane15", "arcanaRuntime", runtime);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;">${message}</div></div>` });
  }

  static async performSubstitutionDraw(actorId, itemId, payload = {}) {
    const actor = game.actors.get(actorId);
    const item = actor?.items?.get(itemId);
    if (!actor || !item || !item.system?.active) return;
    const draw = await ArcanaManager.#drawTemporaryCard(actor, `${item.name} — substitution`);
    if (!draw) return;
    const skillTotal = Number(payload.skillTotal ?? 0);
    const oldCard = Number(payload.originalCard ?? 0);
    const oldFinal = Number(payload.originalFinal ?? (skillTotal + oldCard));
    const newFinal = skillTotal + Number(draw.value ?? 0);
    const skillName = String(payload.skillName || payload.skillKey || "Test");
    const difficulty = Number(payload.difficulty ?? 0);

    const dialog = new DialogV2({
      window: { title: `${item.name} — substitution` },
      content: `<div><p><strong>${skillName}</strong></p><p>Carte initiale : <strong>+${oldCard}</strong> → total <strong>${oldFinal}</strong></p><p>Nouvelle carte piochée : <strong>+${draw.value}</strong> → total <strong>${newFinal}</strong></p><p>Choisis le résultat retenu.</p></div>`,
      buttons: [
        { action: "keep-old", label: "Garder l’ancienne", default: true, callback: async () => {
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${item.name}</strong> : ${actor.name} conserve le résultat initial (${oldFinal}).</div></div>` });
        }},
        { action: "take-new", label: "Prendre la nouvelle", callback: async () => {
          const verdict = difficulty ? (newFinal >= difficulty ? "RÉUSSITE" : "ÉCHEC") : "RÉSULTAT RETENU";
          await actor.setFlag("arcane15", "lastSkillTest", { skillKey: payload.skillKey, skillName, difficulty, success: difficulty ? newFinal >= difficulty : null, timestamp: Date.now(), finalTotal: newFinal, originalFinal: oldFinal });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="axv-chat-card"><div style="padding:10px 12px;"><strong>${item.name}</strong> : nouvelle carte retenue pour ${skillName}. Nouveau total : <strong>${newFinal}</strong>${difficulty ? ` contre difficulté <strong>${difficulty}</strong> — ${verdict}` : ""}.</div></div>` });
        }}
      ]
    });
    await dialog.render({ force: true });
  }

  static async #postPossessionResistanceRollForGM(actor, item, result, difficulty) {
    const success = !!result?.success;
    const verdict = success ? "Réussite" : "Échec";
    const verdictBg = success ? "rgba(46, 125, 50, 0.12)" : "rgba(198, 40, 40, 0.12)";
    const verdictBorder = success ? "rgba(46, 125, 50, 0.35)" : "rgba(198, 40, 40, 0.35)";
    const verdictColor = success ? "#1b5e20" : "#8e0000";
    await ChatMessage.create({
      whisper: gmWhisperIds(),
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="axv-chat-card" style="width:100%; max-width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,.18); border-radius:14px; overflow:hidden; background:#fff;">
          <div style="padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.12); font-weight:900; box-sizing:border-box;">Jet pour éviter la possession</div>
          <div style="padding:12px; box-sizing:border-box;">
            <div style="font-size:15px; font-weight:900; color:#111;">${actor?.name ?? "Personnage"}</div>
            <div style="margin-top:4px; color:#333;"><strong>Atout :</strong> ${item?.name ?? "Atout"}</div>
            <div style="margin-top:10px; display:inline-block; padding:6px 10px; border-radius:999px; font-weight:900; background:${verdictBg}; border:1px solid ${verdictBorder}; color:${verdictColor};">${verdict}</div>
          </div>
        </div>`
    });
  }

  static async #drawTemporaryCard(actor, label = "Pioche d’arcane") {
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
  }

  static async increasePossession(actor, item) {
    const currentActorState = getActorActivePossessionState(actor);
    const hasActiveSource = Number(currentActorState.level || 0) > 0 && String(currentActorState.sourceArcaneId || "").trim().length > 0;
    const currentSourceItem = hasActiveSource
      ? (actor.items.get(currentActorState.sourceItemId) ?? actor.items.find(i => i.type === "atoutArcane" && String(i.system?.arcaneId ?? "") === String(currentActorState.sourceArcaneId ?? "")) ?? null)
      : null;
    const triggerItem = item ?? currentSourceItem ?? null;
    if (!triggerItem) return;

    const triggerArcaneId = String(triggerItem.system?.arcaneId || "");
    const triggerSataniste = String(triggerItem.system?.sataniste || ARCANA_BY_ID.get(triggerArcaneId)?.sataniste || "");
    const continuingSameSource = hasActiveSource && (
      String(currentActorState.sourceItemId ?? "") === String(triggerItem.id ?? "")
      || (String(currentActorState.sourceArcaneId ?? "") && String(currentActorState.sourceArcaneId ?? "") === String(triggerArcaneId ?? ""))
    );
    const switchingSource = hasActiveSource && !continuingSameSource;
    const sourceItem = triggerItem;
    const sourceArcaneId = triggerArcaneId || String(currentActorState.sourceArcaneId || "");
    const sourceSataniste = triggerSataniste || String(currentActorState.sourceSataniste || "");
    const currentLevel = continuingSameSource ? Number(currentActorState.level || 0) : 0;
    const nextLevel = continuingSameSource ? Math.min(6, currentLevel + 1) : 1;
    const startedAt = continuingSameSource && Number(currentActorState.startedAt || 0) > 0 ? Number(currentActorState.startedAt || 0) : Date.now();
    const desired = buildActorActivePossessionUpdate(actor, sourceItem, {
      previousState: currentActorState,
      level: nextLevel,
      startedAt,
      lastChangeAt: Date.now(),
      sourceArcaneId,
      sourceSataniste
    });

    axvPossessionLog("INCREASE", "augmentation possession acteur", {
      actor: actor?.name ?? null,
      triggerItem: item?.name ?? null,
      sourceItem: sourceItem?.name ?? null,
      continuingSameSource,
      switchingSource,
      before: currentActorState,
      next: desired.state
    });

    await actor.update(desired.updateData, { axvSkipActorPossessionSync: true });
    await ArcanaManager.resetLegacyItemPossession(actor);
    ArcanaManager.refreshUIForActor(actor);
    await ChatMessage.create({
      whisper: gmWhisperIds(),
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="axv-arcana-gm-card">
          <div><strong>Possession</strong> — ${actor.name}</div>
          <div style="margin-top:6px;"><strong>${sourceItem.name}</strong> (${desired.state.sourceSataniste || "sans sataniste"})</div>
          <div style="margin-top:6px;">Palier atteint : <strong>${desired.state.level}</strong></div>
          <div style="margin-top:6px;">Effet : ${desired.state.currentEffectText}</div>
        </div>`
    });
    ArcanaManager.renderPublicBanner();
  }

  static #getPossessionTrackingKey(actor) {
    const rawName = String(actor?.name ?? "").trim();
    const normalizedName = normalizeText(rawName);
    const ownerIds = Object.entries(actor?.ownership ?? {})
      .filter(([id, level]) => id !== "default" && Number(level) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      .map(([id]) => id)
      .sort();
    const ownerKey = ownerIds.join(",");
    const actorId = String(actor?.id ?? "").trim();
    const baseId = String(actor?.baseActor?.id ?? actor?.token?.baseActor?.id ?? "").trim();
    const sourceId = String(actor?.flags?.core?.sourceId ?? actor?._source?.flags?.core?.sourceId ?? "").trim();
    const sourceActorMatch = sourceId.match(/^Actor\.([^\.]+)$/);
    const sourceActorId = String(sourceActorMatch?.[1] ?? "").trim();

    if (sourceActorId) return `base:${sourceActorId}`;
    if (baseId) return `base:${baseId}`;
    if (actorId && !actor?.isToken) return `base:${actorId}`;
    if (normalizedName && ownerKey) return `name:${normalizedName}::owners:${ownerKey}`;
    if (normalizedName) return `name:${normalizedName}`;
    return `id:${String(actor?.uuid ?? actorId ?? foundry.utils.randomID())}`;
  }

  static #getPossessionTrackedActors() {
    const docs = [];
    const seenDocs = new Set();
    const add = actor => {
      if (!actor?.type || actor.type !== "personnage" || !actor?.hasPlayerOwner) return;
      const docKey = String(actor.uuid ?? actor.id ?? "").trim() || `anon:${docs.length}`;
      if (seenDocs.has(docKey)) return;
      seenDocs.add(docKey);
      docs.push(actor);
    };

    for (const actor of (game.actors?.contents ?? [])) add(actor);
    for (const token of (canvas?.tokens?.placeables ?? [])) add(token?.actor ?? null);

    axvPossessionLog("TRACKER", "documents acteurs inspectés pour le suivi", {
      count: docs.length,
      actors: docs.map(actor => ({
        name: actor?.name ?? null,
        actorId: actor?.id ?? null,
        uuid: actor?.uuid ?? null,
        isToken: !!actor?.isToken,
        trackingKey: ArcanaManager.#getPossessionTrackingKey(actor)
      }))
    });

    return docs;
  }

  static #buildPossessionTrackerContent(rows, actorCount) {
    const BODY_CELL_STYLE = "color:#241b16 !important; -webkit-text-fill-color:#241b16 !important; text-shadow:none !important;";
    const BODY_CELL_STYLE_STRONG = "color:#1d1612 !important; -webkit-text-fill-color:#1d1612 !important; text-shadow:none !important; font-weight:700;";
    const ALERT_CELL_STYLE = "color:#3a1818 !important; -webkit-text-fill-color:#3a1818 !important; text-shadow:none !important;";
    const EMPTY_STYLE = "color:#2c221d !important; -webkit-text-fill-color:#2c221d !important; text-shadow:none !important;";

    const empty = `
      <div class="axv-possession-empty" style="${EMPTY_STYLE}">
        Aucune possession active sur les personnages joueurs.
      </div>`;

    const table = `
      <div class="axv-possession-table-wrap">
        <table class="axv-possession-table" data-axv-possession-table="1">
          <thead>
            <tr>
              <th>Personnage</th>
              <th>Arcane</th>
              <th>Sataniste</th>
              <th>Palier</th>
              <th>Effet</th>
            </tr>
          </thead>
          <tbody>${rows.map(r => {
            const rowClass = r.palier >= 4 ? "is-alert" : "";
            const rowStyle = r.palier >= 4 ? ALERT_CELL_STYLE : BODY_CELL_STYLE;
            const strongStyle = r.palier >= 4 ? ALERT_CELL_STYLE : BODY_CELL_STYLE_STRONG;
            return `
            <tr class="${rowClass}">
              <td class="axv-possession-col-actor" style="${strongStyle}"><span style="${strongStyle}">${r.actor}</span></td>
              <td class="axv-possession-col-arcane" style="${strongStyle}"><span style="${strongStyle}">${r.arcane}</span></td>
              <td class="axv-possession-col-sataniste" style="${rowStyle}"><span style="${rowStyle}">${r.sataniste || "—"}</span></td>
              <td class="axv-possession-col-palier" style="${rowStyle}"><span class="axv-possession-badge">${r.palier}</span></td>
              <td class="axv-possession-col-effet" style="${rowStyle}"><span style="${rowStyle}">${r.effet}</span></td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>`;

    return `
      <style>
        .axv-possession-shell,
        .axv-possession-shell *,
        .axv-possession-shell table,
        .axv-possession-shell tbody,
        .axv-possession-shell tr,
        .axv-possession-shell td,
        .axv-possession-shell td span {
          box-sizing: border-box;
        }
        .axv-possession-shell {
          color: #f4efe6;
          background: linear-gradient(180deg, rgba(34, 20, 14, 0.98) 0%, rgba(19, 12, 10, 0.98) 100%);
          border: 1px solid rgba(214, 182, 120, 0.35);
          border-radius: 16px;
          padding: 14px;
          box-sizing: border-box;
        }
        .axv-possession-header {
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(214, 182, 120, 0.22);
        }
        .axv-possession-title {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.02em;
          color: #fff7e6;
        }
        .axv-possession-table-wrap {
          max-height: min(70vh, 760px);
          overflow: auto;
          border-radius: 14px;
          border: 1px solid rgba(214, 182, 120, 0.18);
          background: rgba(255, 250, 244, 0.98) !important;
        }
        .axv-possession-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
          background: transparent !important;
        }
        .axv-possession-table thead th {
          position: sticky;
          top: 0;
          z-index: 1;
          text-align: left;
          padding: 12px 12px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #fff7e6 !important;
          background: rgba(116, 12, 32, 0.98) !important;
          border-bottom: 1px solid rgba(214, 182, 120, 0.22);
        }
        .axv-possession-shell .axv-possession-table tbody tr td,
        .axv-possession-shell .axv-possession-table tbody tr:nth-child(even) td,
        .axv-possession-shell .axv-possession-table tbody tr:nth-child(odd) td,
        .axv-possession-shell .axv-possession-table tbody tr td span {
          padding: 11px 12px;
          vertical-align: top;
          font-size: 13px;
          line-height: 1.45;
          color: #241b16 !important;
          -webkit-text-fill-color: #241b16 !important;
          -webkit-text-fill-color: #241b16 !important;
          background: rgba(255, 252, 248, 0.98) !important;
          border-bottom: 1px solid rgba(214, 182, 120, 0.1);
          overflow-wrap: anywhere;
          word-break: break-word;
          text-shadow: none !important;
        }
        .axv-possession-table tbody tr:nth-child(even) td {
          background: rgba(247, 241, 234, 0.98) !important;
        }
        .axv-possession-table tbody tr:hover td {
          background: rgba(239, 226, 212, 0.98) !important;
        }
        .axv-possession-shell .axv-possession-table tbody tr.is-alert td,
        .axv-possession-shell .axv-possession-table tbody tr.is-alert td span {
          background: rgba(248, 224, 224, 0.98) !important;
          color: #3a1818 !important;
          -webkit-text-fill-color: #3a1818 !important;
        }
        .axv-possession-table td *,
        .axv-possession-table th *,
        .axv-possession-table td span,
        .axv-possession-table td strong,
        .axv-possession-table td em {
          color: inherit !important;
          -webkit-text-fill-color: currentColor !important;
        }
        .axv-possession-col-actor,
        .axv-possession-col-arcane {
          font-weight: 700;
          color: #241b16 !important;
          -webkit-text-fill-color: #241b16 !important;
        }
        .axv-possession-col-sataniste,
        .axv-possession-col-effet {
          color: #352a24 !important;
          -webkit-text-fill-color: #352a24 !important;
        }
        .axv-possession-col-palier {
          text-align: center;
        }
        .axv-possession-badge {
          display: inline-flex;
          min-width: 34px;
          justify-content: center;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          background: #f3d9a2 !important;
          border: 1px solid rgba(214, 182, 120, 0.5);
          font-weight: 900;
          color: #2b120d !important;
          -webkit-text-fill-color: #2b120d !important;
        }
        .axv-possession-empty {
          padding: 18px 16px;
          border-radius: 12px;
          background: rgba(255, 252, 248, 0.98) !important;
          border: 1px dashed rgba(214, 182, 120, 0.28);
          color: #2c221d !important;
          -webkit-text-fill-color: #2c221d !important;
          text-align: center;
        }
        @media (max-width: 900px) {
          .axv-possession-table {
            table-layout: auto;
          }
        }
      </style>
      <div class="axv-possession-shell">
        <div class="axv-possession-header">
          <div class="axv-possession-title">Suivi possession</div>
        </div>
        ${rows.length ? table : empty}
      </div>`;
  }

  static openPossessionTracker() {
    if (!game.user?.isGM) return;

    const now = Date.now();
    const existing = ArcanaManager.#possessionTrackerApp;
    if ((now - ArcanaManager.#possessionTrackerOpenStamp) < 250) {
      if (existing && !existing?.closing && existing?.rendered) {
        existing.bringToFront?.();
        existing.maximize?.();
        return existing;
      }
      return existing ?? null;
    }
    ArcanaManager.#possessionTrackerOpenStamp = now;

    if (existing && !existing?.closing && existing?.rendered) {
      existing.bringToFront?.();
      existing.maximize?.();
      return existing;
    }

    const { trackedActors, rows } = ArcanaManager.#getPossessionTrackerRows();
    const content = ArcanaManager.#buildPossessionTrackerContent(rows, trackedActors.length);
    const app = new DialogV2({
      window: {
        title: "Arcane XV — Suivi de Possession",
        resizable: true
      },
      position: {
        width: 1100,
        height: 760
      },
      content,
      buttons: [{ action: "close", label: "Fermer", default: true }]
    });

    const originalClose = app.close.bind(app);
    app.close = async (...args) => {
      if (ArcanaManager.#possessionTrackerApp === app) ArcanaManager.#possessionTrackerApp = null;
      return originalClose(...args);
    };

    ArcanaManager.#possessionTrackerApp = app;
    app.render({ force: true });
    return app;
  }

  static #collectBannerActors() {
    const actors = [];
    const seen = new Set();

    const pushActor = (actor) => {
      if (!actor) return;
      const key = actor.id ?? actor.uuid ?? actor.name ?? foundry.utils.randomID();
      if (seen.has(key)) return;
      seen.add(key);
      actors.push(actor);
    };

    // On privilégie d’abord les acteurs "live" du canvas pour éviter les doublons
    // monde + token et pour refléter l’état réellement visible en scène.
    for (const token of (canvas?.tokens?.placeables ?? [])) pushActor(token?.actor ?? null);
    for (const actor of (game.actors?.contents ?? [])) pushActor(actor);
    return actors;
  }

  static #removeBannerCard(item, actor = null) {
    const node = document.getElementById("axv-arcana-banner");
    if (!node) return;
    const actorId = actor?.id ?? item?.actor?.id ?? "";
    const arcaneId = item?.system?.arcaneId ?? "";
    const candidates = [
      item?.id ? `[data-item-id="${item.id}"]` : null,
      actorId && item?.id ? `[data-actor-id="${actorId}"][data-item-id="${item.id}"]` : null,
      actorId && arcaneId ? `[data-actor-id="${actorId}"][data-arcane-id="${arcaneId}"]` : null,
      arcaneId ? `[data-arcane-id="${arcaneId}"]` : null
    ].filter(Boolean);

    for (const selector of candidates) {
      for (const el of node.querySelectorAll(selector)) el.remove();
    }

    if (!node.querySelector('.axv-banner-card')) {
      node.innerHTML = "";
      node.hidden = true;
      node.style.display = "none";
    }
  }

  static renderPublicBanner() {
    ArcanaManager.#ensureBannerNode();
    if (!ArcanaManager.#bannerNode) return;

    const seen = new Set();
    const activeItems = ArcanaManager.#collectBannerActors().flatMap(actor =>
      actor.items
        .filter(i => i.type === "atoutArcane" && i.system?.active)
        .map(item => ({ actor, item, def: ARCANA_BY_ID.get(item.system?.arcaneId) || {} }))
    ).filter(({ actor, item }) => {
      // Dédoublonnage robuste : un même acteur ne doit afficher qu’une seule carte
      // par item/arcane, même s’il existe à la fois comme acteur monde et acteur de token.
      const key = `${actor.id ?? actor.name}:${item.id ?? item.system?.arcaneId ?? item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!activeItems.length) {
      ArcanaManager.#bannerNode.innerHTML = "";
      ArcanaManager.#bannerNode.hidden = true;
      ArcanaManager.#bannerNode.style.display = "none";
      return;
    }

    ArcanaManager.#bannerNode.hidden = false;
    ArcanaManager.#bannerNode.style.display = "flex";
    ArcanaManager.#bannerNode.innerHTML = activeItems.map(({ actor, item, def }) => {
      const heroic = Number(item.system?.lastHeroicAt ?? 0) > (Date.now() - 6000);
      const img = item.img || def.img || "icons/svg/card-joker.svg";
      const current = foundry.utils.escapeHTML(item.system?.currentEffect || def.currentEffect || "");
      const heroicText = foundry.utils.escapeHTML(item.system?.heroicEffect || def.heroicEffect || "");
      const title = foundry.utils.escapeHTML(item.name || def.name || "Arcane majeur");
      const actorName = foundry.utils.escapeHTML(actor.name || "");
      const mode = heroic ? "Effet héroïque" : "Effet courant actif";
      return `
        <div class="axv-banner-card ${heroic ? "is-heroic" : ""}"
             data-item-id="${item.id ?? ""}"
             data-actor-id="${actor.id ?? ""}"
             data-arcane-id="${item.system?.arcaneId ?? ""}"
             title="${title} — ${actorName}
${mode}

Courant : ${current}

Héroïque : ${heroicText}">
          <img src="${img}" alt="${title}" />
          <div class="axv-banner-text">
            <div class="axv-banner-title">${title}</div>
            <div class="axv-banner-sub">${actorName}</div>
            <div class="axv-banner-mode">${mode}</div>
          </div>
        </div>`;
    }).join("");
  }

  static #ensureBannerNode() {
    let node = document.getElementById("axv-arcana-banner");
    if (!node) {
      node = document.createElement("div");
      node.id = "axv-arcana-banner";
      node.hidden = true;
      const host = document.getElementById("ui-top") || document.getElementById("interface") || document.body;
      host.appendChild(node);
    }
    ArcanaManager.#bannerNode = node;
  }

  static injectSceneControl(controls) {
    if (!game.user?.isGM) return;

    // Foundry v13 passe généralement un objet `controls` avec `controls.tokens.tools`.
    // Certaines configurations / modules peuvent encore exposer une forme plus proche
    // d'un tableau. On supporte les deux sans supposer que `tools` est un array.
    const tokenControls = Array.isArray(controls)
      ? (controls.find(c => c?.name === "tokens") ?? controls.find(c => c?.name === "token") ?? controls[0])
      : (controls?.tokens ?? controls?.token ?? null);

    if (!tokenControls) return;

    const tool = {
      name: "axv-possession",
      title: "Suivi de la possession",
      icon: "fas fa-book",
      button: true,
      visible: true,
      order: 999,
      onClick: () => ArcanaManager.openPossessionTracker()
    };

    // Cas Foundry v13 : tools est un objet clé -> tool.
    if (tokenControls.tools && !Array.isArray(tokenControls.tools) && typeof tokenControls.tools === "object") {
      if (tokenControls.tools[tool.name]) return;
      tokenControls.tools[tool.name] = tool;
      return;
    }

    // Fallback si une structure renvoie encore un tableau.
    if (Array.isArray(tokenControls.tools)) {
      if (tokenControls.tools.some(t => (t?.name ?? t) === tool.name)) return;
      tokenControls.tools.push(tool);
      return;
    }

    // Dernier fallback : on initialise au format objet, compatible v13.
    tokenControls.tools = { [tool.name]: tool };
  }

  static ensurePossessionButtonDom() {
    if (!game.user?.isGM) return;
    const controls = document.querySelector("#controls");
    if (!controls) return;

    let button = controls.querySelector('[data-tool="axv-possession"]');
    if (button) return;

    let list = controls.querySelector('#axv-possession-tools');
    if (!list) {
      list = document.createElement('ol');
      list.id = 'axv-possession-tools';
      list.className = 'control-tools';
      list.style.marginTop = '6px';
      controls.appendChild(list);
    }

    button = document.createElement('li');
    button.className = 'scene-control control-tool';
    button.dataset.tool = 'axv-possession';
    button.dataset.axvPossession = '1';
    button.title = 'Suivi de la possession';
    button.innerHTML = '<i class="fas fa-book"></i>';
    button.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      ArcanaManager.openPossessionTracker();
    });
    list.appendChild(button);
  }

  static #bindGlobalChatDelegation() {
    const root = document;
    if (root.body?.dataset?.axvArcanaChatDelegation === "1") return;
    if (root.body) root.body.dataset.axvArcanaChatDelegation = "1";
    root.addEventListener("click", async ev => {
      const target = ev.target?.closest?.("[data-axv-activation-approve], [data-axv-activation-refuse]");
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      const actorId = target.dataset.actorId;
      const itemId = target.dataset.itemId;
      const actorUuid = target.dataset.actorUuid ?? null;
      const itemUuid = target.dataset.itemUuid ?? null;
      const approved = target.hasAttribute("data-axv-activation-approve");
      const messageEl = target.closest(".chat-message");
      const messageId = messageEl?.dataset?.messageId ?? messageEl?.getAttribute?.("data-message-id") ?? null;
      await ArcanaManager.confirmActivationByGM({ actorId, itemId, actorUuid, itemUuid }, null, messageId, approved);
    }, true);
  }

  static #bindChatButtons(message, html) {
    const root = html?.querySelector ? html : html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-axv-activation-approve], [data-axv-activation-refuse]").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const target = ev.currentTarget;
        const actorId = target.dataset.actorId;
        const itemId = target.dataset.itemId;
        const actorUuid = target.dataset.actorUuid ?? null;
        const itemUuid = target.dataset.itemUuid ?? null;
        const approved = target.hasAttribute("data-axv-activation-approve");
        const messageId = message?.id ?? target.closest?.(".chat-message")?.dataset?.messageId ?? null;
        await ArcanaManager.confirmActivationByGM({ actorId, itemId, actorUuid, itemUuid }, null, messageId, approved);
      });
    });
    root.querySelectorAll("[data-axv-arcana-substitute]").forEach(btn => {
      if (btn.dataset.axvBound) return;
      btn.dataset.axvBound = "1";
      btn.addEventListener("click", async ev => {
        ev.preventDefault();
        const t = ev.currentTarget;
        await ArcanaManager.performSubstitutionDraw(t.dataset.actorId, t.dataset.itemId, {
          skillKey: t.dataset.axvRollSkill,
          skillName: t.dataset.axvRollSkillName,
          difficulty: Number(t.dataset.axvRollDifficulty ?? 0),
          skillTotal: Number(t.dataset.axvRollSkillTotal ?? 0),
          originalCard: Number(t.dataset.axvRollOriginalCard ?? 0),
          originalFinal: Number(t.dataset.axvRollOriginalFinal ?? 0)
        });
      });
    });
  }

  static async #postActivationFailureForGM(actor, item, result) {
    await ChatMessage.create({
      whisper: gmWhisperIds(),
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="axv-arcana-gm-card">
          <div><strong>${actor.name}</strong> a raté l’activation de <strong>${item.name}</strong>.</div>
          <div style="margin-top:6px;">Total : <strong>${result.finalTotal}</strong> / difficulté <strong>${result.difficulty}</strong></div>
          <div style="margin-top:6px;">Hors stress, le MJ peut valider l’activation malgré l’échec.</div>
          <div class="axv-arcana-gm-actions">
            <button type="button" data-axv-activation-approve data-actor-id="${actor.id}" data-item-id="${item.id}" data-actor-uuid="${actor.uuid}" data-item-uuid="${item.uuid}">Valider</button>
            <button type="button" data-axv-activation-refuse data-actor-id="${actor.id}" data-item-id="${item.id}" data-actor-uuid="${actor.uuid}" data-item-uuid="${item.uuid}">Refuser</button>
          </div>
        </div>`
    });
  }

  static async #postPublicArcanaMessage(actor, item, heroic = false, label = "") {
    const def = ARCANA_BY_ID.get(item.system?.arcaneId) || {};
    const img = item.img || def.img || "icons/svg/card-joker.svg";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="axv-chat-card" style="width:100%; max-width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,.2); border-radius:14px; overflow:hidden; background:#fff;">
          <div style="padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.12); font-weight:900; box-sizing:border-box;">${heroic ? "Effet héroïque" : "Arcane actif"} — ${actor.name}</div>
          <div style="display:flex; gap:12px; padding:12px; min-width:0; box-sizing:border-box;">
            <img src="${img}" style="width:84px; height:126px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,0,0,.25); flex:0 0 auto;"/>
            <div style="flex:1; min-width:0; overflow-wrap:anywhere; word-break:break-word;">
              <div style="font-weight:900; font-size:14px; margin-bottom:6px; overflow-wrap:anywhere; word-break:break-word;">${item.name}</div>
              <div>${heroic ? (item.system?.heroicEffect || "") : (item.system?.currentEffect || "")}</div>
              ${label ? `<div style="margin-top:6px; font-size:12px; opacity:.85;">${label}</div>` : ""}
            </div>
          </div>
        </div>`
    });
  }

  static async #rollFixedSkill(actor, skillKey, { title, subtitle, difficulty, chatTitle, chatNote, bonus = 0 } = {}) {
    CardManager.ensureSocket();
    let handId = actor.getFlag("arcane15", "hand");
    if (!handId || !game.cards.get(handId)) {
      await CardManager.initActorDecks(actor);
      handId = actor.getFlag("arcane15", "hand");
    }
    const hand = game.cards.get(handId);
    if (!hand) {
      ui.notifications?.error?.("Main introuvable pour ce personnage.");
      return null;
    }
    const skillData = actor.system?.competences?.[skillKey];
    const baseSkillValue = Number(skillData?.total ?? 0);
    const malEnPointMod = actor?.getFlag?.("arcane15", "malEnPoint") ? -1 : 0;
    const arcanaMods = ArcanaManager.getSkillModifiers(actor, skillKey);
    const skillValue = baseSkillValue + malEnPointMod + Number(arcanaMods?.net || 0) + Number(bonus || 0);
    const skillName = `${capitalized(skillKey)}${skillData?.label ? ` (${skillData.label})` : ""}`;
    const cards = hand.cards.contents.slice().sort((a, b) => {
      const aj = CardManager._isJoker(a);
      const bj = CardManager._isJoker(b);
      if (aj && !bj) return -1;
      if (!aj && bj) return 1;
      return Number(a.flags.arcane15?.value ?? 0) - Number(b.flags.arcane15?.value ?? 0);
    });
    const dialogId = `axv-arcana-hand-${foundry.utils.randomID()}`;
    const cardsHtml = cards.map(c => {
      const img = CardManager._getCardImg(c) || c.img || "icons/svg/hazard.svg";
      const name = CardManager._getCardName(c) || c.name || "Carte";
      const v = Number(c.flags.arcane15?.value ?? 0);
      const isJoker = CardManager._isJoker(c);
      return `
        <button class="axv-card" data-card-id="${c.id}" type="button" title="Jouer ${name}"
          style="all:unset; cursor:pointer; user-select:none; border-radius:16px; overflow:hidden; border:1px solid rgba(0,0,0,.35); box-shadow: 0 10px 24px rgba(0,0,0,.18); background:#111;">
          <div style="position:relative; aspect-ratio:2/3; width:150px;">
            <img src="${img}" style="width:100%; height:100%; object-fit:cover; display:block;" />
            <div style="position:absolute; inset:auto 0 0 0; padding:10px; background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.82) 60%, rgba(0,0,0,.90) 100%); color:#fff;">
              <div style="font-weight:800; font-size:13px; line-height:1.15; margin-bottom:2px;">${name}</div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:12px; opacity:.95;">${isJoker ? "Joker" : "Carte"}</div>
                <div style="font-weight:900; font-size:14px; padding:2px 8px; border-radius:999px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.18);">+${v}</div>
              </div>
            </div>
          </div>
        </button>`;
    }).join("");
    const modifiersLine = [
      malEnPointMod ? `Mal en point ${malEnPointMod}` : "",
      ...(arcanaMods?.labels || []),
      bonus ? `Bonus héroïque +${bonus}` : ""
    ].filter(Boolean).join(" • ");
    const content = `
      <div id="${dialogId}">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:12px; padding:10px 12px; border:1px solid rgba(0,0,0,.18); border-radius:14px; background:#fff; margin-bottom:10px;">
          <div>
            <div style="font-weight:900; font-size:16px;">${title || `${actor.name} — ${skillName}`}</div>
            <div style="font-size:12px; opacity:.85; margin-top:4px;">${subtitle || "Choisis une carte."}</div>
            ${modifiersLine ? `<div style="font-size:12px; opacity:.85; margin-top:6px;">${modifiersLine}</div>` : ""}
          </div>
          <div style="font-weight:900; font-size:14px; padding:6px 10px; border-radius:999px; border:1px solid rgba(0,0,0,.18); background:rgba(0,0,0,.04); white-space:nowrap;">Compétence : ${skillValue}</div>
        </div>
        <div style="font-size:12px; opacity:.85; margin:10px 2px 0 2px;">Main : ${cards.length} carte(s)</div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:14px; padding:4px; max-height:560px; overflow:auto;">${cardsHtml}</div>
      </div>`;

    return await new Promise(async (resolve) => {
      const dlg = new DialogV2({
        window: { title: title || `${actor.name} — ${skillName}` },
        content,
        rejectClose: false,
        buttons: [{ action: "close", label: "Fermer", default: true }]
      });
      await dlg.render({ force: true });
      const root = dlg.element?.querySelector(`#${dialogId}`);
      if (!root) return resolve(null);
      let busy = false;
      root.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button.axv-card[data-card-id]");
        if (!btn || busy) return;
        busy = true;
        try {
          const card = hand.cards.get(btn.dataset.cardId);
          if (!card) return resolve(null);
          const cardValue = Number(card.flags.arcane15?.value ?? 0);
          const cardName = CardManager._getCardName(card);
          const cardImg = CardManager._getCardImg(card) || "icons/svg/hazard.svg";
          const isJoker = CardManager._isJoker(card);
          const finalTotal = skillValue + cardValue;
          const success = finalTotal >= Number(difficulty || 0);
          const verdict = success ? "RÉUSSITE" : "ÉCHEC";
          await ChatMessage.create({
            content: `
              <div class="axv-chat-card" style="width:100%; max-width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,.2); border-radius:14px; overflow:hidden; background:#fff;">
                <div style="padding:10px 12px; border-bottom:1px solid rgba(0,0,0,.12); font-weight:900; box-sizing:border-box;">${chatTitle || `${actor.name} — ${skillName}`}</div>
                <div style="display:flex; gap:12px; padding:12px; min-width:0; box-sizing:border-box;">
                  <img src="${cardImg}" style="width:84px; height:126px; object-fit:cover; border-radius:10px; border:1px solid rgba(0,0,0,.25); flex:0 0 auto;" />
                  <div style="flex:1; min-width:0; overflow-wrap:anywhere; word-break:break-word;">
                    <div style="font-weight:900; font-size:14px; margin-bottom:6px; overflow-wrap:anywhere; word-break:break-word;">${cardName}</div>
                    <div>Compétence : <strong>${skillValue}</strong></div>
                    ${modifiersLine ? `<div>Modificateurs : <strong>${modifiersLine}</strong></div>` : ""}
                    <div>Carte : <strong>+${cardValue}</strong></div>
                    <div>Difficulté : <strong>${difficulty}</strong></div>
                    ${chatNote ? `<div style="margin-top:6px; font-size:12px; opacity:.85;">${chatNote}</div>` : ""}
                    <div style="margin-top:10px; font-weight:900; font-size:18px;">TOTAL : ${finalTotal}</div>
                    <div style="margin-top:6px; font-weight:900; font-size:16px;">${verdict}</div>
                  </div>
                </div>
              </div>`,
            speaker: ChatMessage.getSpeaker({ actor })
          });
          await actor.setFlag("arcane15", "lastSkillTest", { skillKey, skillName, difficulty: Number(difficulty || 0), success, timestamp: Date.now(), finalTotal, skillTotal: skillValue, cardValue, source: "fixed" });
          if (arcanaMods?.consume?.length) await ArcanaManager.consumeSkillModifiers(actor, arcanaMods.consume);
          if (!isJoker) await CardManager.cycleCard(actor, card);
          await dlg.close();
          resolve({ success, difficulty: Number(difficulty || 0), finalTotal, cardId: card.id, cardValue, skillTotal: skillValue });
        } catch (err) {
          console.error("[ARCANE XV][ARCANA] rollFixedSkill error", err);
          ui.notifications?.error?.("Erreur lors du test d’arcane (voir console).");
          resolve(null);
        } finally {
          busy = false;
        }
      });
    });
  }

  static debugPossessionTracker() {
    const { trackedActors, rows } = ArcanaManager.#getPossessionTrackerRows();
    const payload = {
      trackedActors: trackedActors.map(actor => ({
        actor: actor.name,
        actorId: actor.id,
        atouts: actor.items
          .filter(i => i.type === "atoutArcane")
          .map(i => axvPossessionSnapshot(i))
      })),
      rows
    };
    axvPossessionLog("DEBUG", "dump complet du suivi de possession", payload);
    return payload;
  }

  static debugPossessionForActor(actorRef) {
    const actor = game.actors?.get(actorRef)
      ?? (game.actors?.contents ?? []).find(a => a.name === actorRef)
      ?? (game.actors?.contents ?? []).find(a => normalizeText(a.name) === normalizeText(actorRef));
    if (!actor) {
      axvPossessionLog("DEBUG", "acteur introuvable", { actorRef });
      return null;
    }
    const payload = {
      actor: actor.name,
      actorId: actor.id,
      hasPlayerOwner: actor.hasPlayerOwner,
      type: actor.type,
      items: actor.items
        .filter(i => i.type === "atoutArcane")
        .map(i => axvPossessionSnapshot(i))
    };
    axvPossessionLog("DEBUG", "dump possession acteur", payload);
    return payload;
  }

}
