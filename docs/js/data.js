/* World data: territories, regions, factions, geography */
(function (G) {
  const W = 2000, H = 1400;

  const REGIONS = [
    { id: 0, name: 'Forodwaith', short: 'North', bonus: 3, hue: '#9fb6c4' },
    { id: 1, name: 'Eriador', short: 'Eriador', bonus: 3, hue: '#8fae5e' },
    { id: 2, name: 'Misty Mountains', short: 'Misty', bonus: 3, hue: '#9a8f7e' },
    { id: 3, name: 'Rhovanion', short: 'Rhovanion', bonus: 4, hue: '#4f7a45' },
    { id: 4, name: 'Lands of Rhûn', short: 'Rhûn', bonus: 3, hue: '#b99a62' },
    { id: 5, name: 'Rohan', short: 'Rohan', bonus: 2, hue: '#c4b25a' },
    { id: 6, name: 'Gondor', short: 'Gondor', bonus: 4, hue: '#8fa3b8' },
    { id: 7, name: 'Mordor', short: 'Mordor', bonus: 2, hue: '#a2564a' },
    { id: 8, name: 'Harad', short: 'Harad', bonus: 2, hue: '#d39a52' },
  ];

  // name, region, seed x,y, biome tag for vignette, optional settlement
  const T = [
    ["Forochel", 0, 430, 195, 'snow'],
    ["Angmar", 0, 665, 165, 'snow'],
    ["Gundabad", 0, 985, 140, 'snowtower'],
    ["Withered Heath", 0, 1265, 190, 'snow'],
    ["Northern Waste", 0, 1570, 205, 'snow'],
    ["Grey Havens", 1, 330, 420, 'port'],
    ["The Shire", 1, 545, 385, 'meadow'],
    ["Weathertop", 1, 735, 295, 'watch'],
    ["Bree-land", 1, 640, 565, 'forest'],
    ["Minhiriath", 1, 430, 660, 'meadow'],
    ["Tolfalas", 1, 150, 820, 'island'],
    ['Rivendell', 2, 830, 420, 'valley'],
    ["High Pass", 2, 925, 270, 'mountain'],
    ["Moria", 2, 905, 575, 'mine'],
    ["Isengard", 2, 880, 760, 'mountain'],
    ["Vales of Anduin", 3, 1035, 355, 'river'],
    ["Woodland Realm", 3, 1240, 330, 'darkforest'],
    ["Mirkwood", 3, 1275, 500, 'darkforest'],
    ["Lothlórien", 3, 1050, 560, 'goldforest'],
    ["Dol Guldur", 3, 1250, 665, 'forest'],
    ['Iron Hills', 4, 1465, 335, 'mountain'],
    ["Esgaroth", 4, 1440, 525, 'lake'],
    ["Dorwinion", 4, 1725, 335, 'steppe'],
    ["Rhûn", 4, 1845, 560, 'steppe'],
    ["Brown Lands", 4, 1600, 660, 'steppe'],
    ["Helm's Deep", 5, 985, 845, 'fortress'],
    ["The Wold", 5, 1105, 760, 'plains'],
    ["Edoras", 5, 1275, 800, 'plains'],
    ["Eastfold", 5, 1385, 905, 'plains'],
    ["Minas Tirith", 6, 1285, 1000, 'whitecity'],
    ["Pelargir", 6, 1115, 1105, 'port'],
    ["Lamedon", 6, 935, 1010, 'meadow'],
    ["Dol Amroth", 6, 745, 965, 'coast'],
    ["Andrast", 6, 545, 905, 'coast'],
    ["Udûn", 7, 1545, 825, 'blackgate'],
    ["Gorgoroth", 7, 1745, 895, 'ash'],
    ['Mount Doom', 7, 1655, 990, 'volcano'],
    ["Minas Morgul", 7, 1520, 1020, 'ash'],
    ["Umbar", 8, 1020, 1285, 'desertport'],
    ["Harondor", 8, 1265, 1245, 'desert'],
    ["Near Harad", 8, 1510, 1210, 'desert'],
    ["Khand", 8, 1770, 1225, 'desert'],
  ];
  const TERR = T.map((t, i) => ({ id: i, name: t[0], region: t[1], sx: t[2], sy: t[3], biome: t[4] }));

  // Sea crossings (drawn as dashed routes)
  const SEA_LINKS = [[5, 10], [10, 33], [32, 38], [22, 24], [0, 5]];

  // Land shape: gaussian blobs (x, y, sigma, weight)
  const LAND_BLOBS = [
    [600, 760, 95, 0.9], [1150, 940, 100, 0.8], [1390, 1110, 110, 0.9], [1880, 980, 90, 0.8],
    [1140, 1210, 90, 0.8], [700, 450, 90, 0.6], [1600, 440, 90, 0.5], [1880, 360, 80, 0.6],
    [800, 140, 80, 0.7], [1100, 160, 80, 0.6], [1400, 210, 80, 0.6], [360, 300, 70, 0.4],
    [1650, 1300, 90, 0.8], [1900, 1180, 80, 0.7],
    [700, 20, 110, 1.0], [1000, 15, 120, 1.0], [1300, 15, 120, 1.0], [1600, 20, 120, 1.0], [1900, 30, 120, 1.0],
    [1990, 250, 110, 1.0], [1990, 520, 110, 1.0], [1990, 800, 110, 1.0], [1990, 1080, 110, 1.0], [1990, 1350, 110, 1.0],
    [1150, 1395, 110, 0.9], [1450, 1395, 120, 1.0], [1750, 1395, 120, 1.0],
    [215, 300, 26, 0.9], [175, 560, 22, 0.9], [250, 1000, 24, 0.9], [95, 640, 20, 0.8], [300, 120, 30, 0.8], [380, 1110, 22, 0.8], [130, 1000, 18, 0.8],
  ];
  const SEA_BLOBS = [
    [1665, 480, 66, 2.4],
    [790, 1235, 115, 1.7],
    [560, 1160, 140, 1.5],
    [235, 960, 70, 1.2],
    [240, 690, 45, 0.9],
    [60, 420, 120, 1.0], [40, 900, 120, 1.0], [150, 1300, 160, 1.2], [200, 40, 120, 1.1],
  ];

  // Mountain ranges (natural relief is built around these spines; 'barrier' crests also block territory growth)
  const RIDGES = [
    { name: 'Misty Mountains', type: 'spine', w: 70, h: 1.0, spurs: 1, pts: [[880, 25], [935, 150], [902, 280], [938, 420], [884, 560], [912, 700], [930, 815]] },
    { name: 'Grey Mountains', type: 'barrier', w: 34, h: 0.72, spurs: 0.7, pts: [[1040, 112], [1180, 86], [1340, 104], [1500, 92], [1665, 72]] },
    { name: 'Mountains of Angmar', type: 'spine', w: 44, h: 0.78, spurs: 0.8, pts: [[630, 45], [760, 84], [878, 58]] },
    { name: 'Ered Lithui', type: 'barrier', w: 32, h: 0.82, spurs: 0.9, pts: [[1452, 768], [1565, 750], [1705, 772], [1890, 746]] },
    { name: 'Ephel Dúath', type: 'barrier', w: 36, h: 0.92, spurs: 1, pts: [[1440, 790], [1424, 880], [1446, 990], [1470, 1088]] },
    { name: '', type: 'barrier', w: 26, h: 0.62, spurs: 0.7, pts: [[1484, 1100], [1622, 1112], [1762, 1090], [1862, 1062]] },
    { name: 'White Mountains', type: 'barrier', w: 32, h: 0.84, spurs: 1, pts: [[690, 888], [830, 905], [975, 920], [1110, 906], [1180, 878]] },
    { name: '', type: 'spine', w: 24, h: 0.5, spurs: 0.6, pts: [[1395, 288], [1470, 302], [1548, 285]] },
    { name: 'Blue Mountains', type: 'spine', w: 24, h: 0.56, spurs: 0.6, pts: [[422, 140], [404, 280], [396, 365]] },
    { name: '', type: 'spine', w: 22, h: 0.5, spurs: 0.6, pts: [[384, 480], [362, 615]] },
    { name: '', type: 'spine', w: 26, h: 1.25, spurs: 0, pts: [[1655, 990], [1656, 991]] },
  ];
  // Isolated peaks (x, y, radius, height)
  const PEAKS = [[1385, 238, 42, 0.95], [1655, 995, 55, 1.25], [1210, 870, 26, 0.32]];
  // Hill country (x, y, radius, height)
  const HILLS = [
    [545, 385, 110, 0.16], [1265, 190, 120, 0.2], [1275, 800, 110, 0.14], [430, 560, 80, 0.14], [430, 660, 90, 0.11],
    [1235, 862, 60, 0.24], [1840, 560, 140, 0.08], [1470, 1240, 260, 0.07], [745, 300, 70, 0.2], [1720, 330, 120, 0.1],
    [1100, 1040, 110, 0.12], [640, 820, 90, 0.12],
  ];
  // Lakes (x, y, rx, ry, rotation, name)
  const LAKES = [
    [1497, 438, 24, 50, 0.25, 'Long Lake'], [556, 252, 40, 23, -0.35, 'Lake Evendim'],
    [1768, 1006, 56, 27, 0.12, 'Sea of Núrnen'], [805, 452, 15, 10, 0.4, ''], [1050, 790, 14, 9, 0.2, ''],
  ];
  // Marshes (x, y, r, name)
  const MARSHES = [[1392, 730, 52, 'Dead Marshes'], [935, 1160, 48, ''], [1585, 525, 40, '']];
  // Roads (control points)
  const ROADS = [
    [[300, 458], [430, 420], [545, 392], [650, 352], [745, 300], [830, 332], [905, 300], [1000, 332], [1085, 360], [1200, 380]],
    [[985, 880], [1060, 832], [1150, 822], [1232, 905], [1300, 1030]],
    [[1300, 1030], [1210, 1080], [1115, 1125], [1060, 1262]],
    [[545, 392], [445, 520], [432, 660], [545, 905], [745, 965], [935, 1010], [1300, 1030]],
    [[1440, 548], [1530, 600], [1600, 662]],
    [[1085, 360], [1240, 330], [1440, 548]],
  ];
  // Landmarks (x, y, kind, label)
  const LANDMARKS = [
    [1385, 238, 'lonely', 'Erebor'], [1722, 952, 'darktower', 'Barad-dûr'], [906, 836, 'ringtower', 'Orthanc'],
    [1228, 902, 'pillars', 'Argonath'], [1214, 868, 'falls', ''], [745, 288, 'ruin', 'Amon Sûl'],
    [432, 566, 'stones', 'Barrow-downs'], [1062, 548, 'goldtree', 'Caras Galadhon'], [1588, 600, 'ruin', ''],
    [835, 448, 'house', ''], [1655, 995, 'volcano', 'Orodruin'], [1180, 300, 'ruin', ''],
  ];
  // Region names painted on the parchment (x, y, rotation)
  const REGION_LABELS = [
    [0, 1180, 215, -0.03], [1, 480, 300, 0], [2, 985, 640, -1.45], [3, 1330, 595, 0], [4, 1760, 420, 0],
    [5, 1110, 735, -0.05], [6, 1010, 1080, 0], [7, 1640, 845, 0], [8, 1560, 1325, 0],
  ];

  // Rivers (control polylines, smoothed at runtime)
  const RIVERS = [
    { name: 'Anduin', w: 3.4, pts: [[1110, 215], [1085, 330], [1068, 450], [1082, 600], [1135, 700], [1195, 815], [1235, 915], [1205, 1020], [1120, 1095], [1000, 1150], [890, 1190], [800, 1230]] },
    { name: 'Brandywine', w: 2.9, pts: [[760, 195], [705, 330], [625, 450], [560, 600], [480, 720], [385, 785], [290, 810], [230, 820]] },
    { name: '', w: 2.5, pts: [[1505, 195], [1478, 320], [1494, 438], [1490, 520], [1570, 505], [1620, 482]] },
    { name: '', w: 1.9, pts: [[945, 640], [1000, 625], [1075, 612]] },
    { name: '', w: 2.0, pts: [[995, 790], [1080, 805], [1180, 830], [1200, 822]] },
    { name: '', w: 1.9, pts: [[575, 110], [595, 200], [640, 270], [700, 328]] },
    { name: 'Greyflood', w: 2.6, pts: [[858, 648], [775, 735], [705, 828], [662, 930], [648, 1040], [640, 1110]] },
    { name: 'Harnen', w: 2.4, pts: [[1445, 1128], [1310, 1162], [1185, 1192], [1080, 1202], [960, 1236], [880, 1262]] },
    { name: '', w: 2.0, pts: [[1622, 118], [1632, 255], [1642, 372], [1656, 424]] },
    { name: '', w: 1.8, pts: [[1338, 690], [1290, 760], [1240, 905]] },
  ];

  // Forests (x, y, rx, ry, density, kind)
  const FORESTS = [
    [1260, 470, 160, 240, 1.0, 'dark'],
    [640, 565, 85, 75, 0.95, 'broad'],
    [1050, 560, 55, 55, 0.95, 'gold'],
    [990, 700, 50, 55, 0.85, 'broad'],
    [690, 175, 95, 60, 0.6, 'pine'],
    [1350, 225, 90, 50, 0.5, 'pine'],
    [140, 810, 45, 45, 0.75, 'pine'],
    [430, 520, 60, 45, 0.6, 'broad'],
    [1800, 420, 60, 50, 0.55, 'pine'],
    [1060, 1010, 45, 35, 0.6, 'broad'],
    [470, 170, 60, 40, 0.5, 'pine'],
    [540, 300, 60, 40, 0.6, 'broad'], [360, 560, 45, 35, 0.55, 'broad'], [560, 720, 60, 40, 0.6, 'broad'],
    [420, 780, 50, 35, 0.5, 'broad'], [780, 640, 40, 50, 0.55, 'pine'], [1385, 960, 40, 60, 0.6, 'broad'],
    [1180, 300, 50, 40, 0.6, 'dark'], [1700, 620, 50, 35, 0.45, 'pine'], [800, 1000, 40, 30, 0.5, 'broad'],
  ];

  // Biome colour anchors (x, y, sigma, rgb)
  const BIOMES = [
    [900, 110, 260, [226, 225, 214]], [1500, 150, 240, [222, 221, 208]], [430, 170, 200, [224, 224, 214]],
    [470, 520, 240, [196, 199, 145]], [1150, 800, 180, [211, 201, 142]],
    [950, 1040, 230, [203, 200, 158]], [1650, 930, 170, [170, 120, 96]],
    [1450, 1250, 260, [228, 193, 138]], [1720, 520, 230, [206, 191, 149]],
    [1250, 470, 170, [168, 175, 120]], [150, 820, 90, [190, 196, 150]],
  ];

  const SEA_LABELS = [
    { t: 'Belegaer', x: 120, y: 520, r: -1.45, s: 34 },
    { t: 'Sea of Rhûn', x: 1665, y: 482, r: 0, s: 18 },
    { t: 'Bay of Belfalas', x: 795, y: 1250, r: 0, s: 24 },
    { t: 'The Great Sea', x: 300, y: 950, r: -0.4, s: 18 },
  ];
  const SETTLEMENTS = [
    [300, 455, 'port'], [1300, 1035, 'citadel'], [1095, 1140, 'port'], [945, 255, 'tower'],
    [1452, 772, 'gate'], [1052, 1265, 'port'], [1420, 545, 'town'], [905, 610, 'mine'],
    [985, 880, 'fort'], [990, 140, 'tower'], [1240, 1245, 'oasis'], [545, 400, 'town'], [1750, 1205, 'town'], [1840, 575, 'town'], [1110, 770, 'town'],
  ];

  // Factions. Emblems are 100x100 SVG path data (fill, evenodd)
  const EMBLEMS = {
    tower: 'M31 92 L31 42 L24 42 L24 24 L33 24 L33 32 L41 32 L41 24 L59 24 L59 32 L67 32 L67 24 L76 24 L76 42 L69 42 L69 92 Z M44 92 L44 74 Q50 64 56 74 L56 92 Z M50 3 L53 10 L60.5 10 L54.5 14.5 L57 21.5 L50 17 L43 21.5 L45.5 14.5 L39.5 10 L47 10 Z',
    horseshoe: 'M20 14 L37 14 L37 52 A13 13 0 0 0 63 52 L63 14 L80 14 L80 54 A30 30 0 0 1 20 54 Z M25 22 L32 22 L32 28 L25 28 Z M68 22 L75 22 L75 28 L68 28 Z M25 40 L32 40 L32 46 L25 46 Z M68 40 L75 40 L75 46 L68 46 Z',
    leaf: 'M50 4 C80 22 90 58 52 96 L48 96 C10 58 20 22 50 4 Z M48.5 18 L48.5 88 L51.5 88 L51.5 18 Z M49 48 L31 34 L29 37 L48 52 Z M51 48 L69 34 L71 37 L52 52 Z M49 66 L33 55 L31 58 L48 70 Z M51 66 L67 55 L69 58 L52 70 Z',
    hammer: 'M18 14 L82 14 L82 22 L88 22 L88 38 L82 38 L82 44 L18 44 L18 38 L12 38 L12 22 L18 22 Z M43 44 L57 44 L57 92 L43 92 Z M30 22 L70 22 L70 36 L30 36 Z',
    eye: 'M4 50 Q50 6 96 50 Q50 94 4 50 Z M50 26 Q61 50 50 74 Q39 50 50 26 Z M50 12 L50 2 M',
    ring: 'M50 12 A38 38 0 1 1 49.9 12 Z M50 26 A24 24 0 1 0 50.1 26 Z',
  };
  // fix eye path (remove trailing move)
  EMBLEMS.eye = 'M4 50 Q50 6 96 50 Q50 94 4 50 Z M50 25 Q62 50 50 75 Q38 50 50 25 Z';

  const FACTIONS = [
    { id: 0, name: 'Knights of the West', short: 'West', color: '#2f5f9e', light: '#7ea6d6', dark: '#173763', emblem: 'tower' },
    { id: 1, name: 'Riders of the Plains', short: 'Riders', color: '#3d7d36', light: '#89bf78', dark: '#1f4a1b', emblem: 'horseshoe' },
    { id: 2, name: 'Wood Elves', short: 'Elves', color: '#c08f17', light: '#ecc95f', dark: '#6e4f05', emblem: 'leaf' },
    { id: 3, name: 'Mountain Dwarves', short: 'Dwarves', color: '#6f4598', light: '#ad8bd0', dark: '#3d2259', emblem: 'hammer' },
    { id: 4, name: 'Shadow Hordes', short: 'Shadow', color: '#a4271f', light: '#e0756a', dark: '#5c120d', emblem: 'eye' },
  ];
  const NEUTRAL = { id: 5, name: 'Free Cities', short: 'Neutral', color: '#837a6b', light: '#bcb2a1', dark: '#4a443a', emblem: 'ring' };

  const CARD_TYPES = [
    { id: 0, name: 'Footman', path: 'M47 6 L53 6 L55 66 L68 66 L68 73 L55 73 L55 80 Q50 86 45 80 L45 73 L32 73 L32 66 L45 66 Z M46 82 L54 82 L54 96 L46 96 Z' },
    { id: 1, name: 'Rider', path: EMBLEMS.horseshoe },
    { id: 2, name: 'Catapult', path: 'M10 80 L90 80 L90 90 L10 90 Z M24 80 L42 50 L60 80 L52 80 L42 63 L32 80 Z M36 62 L80 20 L85 25 L41 67 Z M86 6 A10 10 0 1 1 85.9 6 Z' },
    { id: 3, name: 'Wild', path: 'M50 4 L61 37 L96 37 L68 58 L78 92 L50 71 L22 92 L32 58 L4 37 L39 37 Z' },
  ];

  G.DATA = { W, H, REGIONS, TERR, SEA_LINKS, LAND_BLOBS, SEA_BLOBS, RIDGES, PEAKS, HILLS, LAKES, MARSHES, ROADS, LANDMARKS, REGION_LABELS, RIVERS, FORESTS, BIOMES, SEA_LABELS, SETTLEMENTS, FACTIONS, NEUTRAL, EMBLEMS, CARD_TYPES };
})(window);
