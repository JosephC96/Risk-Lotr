"""Compile traced boundaries over the user's untouched 5606 x 9214 map.

This pass only names the lands, places their seeds and roughs out their shapes. The outlines
the game uses are then traced from the drawing by trace_user_map_borders.py --write: run it after this.

Coordinates use a 1000-pixel-wide reference. Only QA overlays are rasterized;
assets/middle-earth-user-map.jpg is never modified by this script.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/map-import'
OUT.mkdir(parents=True, exist_ok=True)
WIDTH = 2000
source = Image.open(ROOT / 'assets/middle-earth-user-map.jpg')
HEIGHT = round(WIDTH * source.height / source.width)
SCALE = WIDTH / 1000

# Region order keeps the nine rule-engine slots stable; names/bonuses match the map.
REGIONS = [
    ('Arnor', 7, '#9fb6c4'), ('Eriador', 3, '#8fae5e'),
    ('Rhovanion', 5, '#b99a62'), ('Mirkwood', 4, '#4f7a45'),
    ('Rhûn', 2, '#b99a62'), ('Rohan', 4, '#c4b25a'),
    ('Gondor', 7, '#8fa3b8'), ('Mordor', 2, '#a2564a'),
    ('Haradwaith', 2, '#d39a52'),
]
# name, region, interior point, biome; points also anchor the troop pieces.
TERRITORIES = [
 ('Forodwaith',0,690,61,'snow'), ('Eastern Angmar',0,685,136,'snowtower'),
 ('Angmar',0,525,218,'snow'), ('Borderlands',0,469,277,'plains'),
 ('North Downs',0,416,298,'plains'), ('Fornost',0,399,390,'watch'),
 ('Weather Hills',0,481,429,'watch'), ('South Downs',0,435,541,'plains'),
 ('Buckland',0,369,469,'meadow'), ('Old Forest',0,436,467,'forest'),
 ('Rhudaur',0,589,355,'valley'),
 ('Forlindon',1,94,323,'coast'), ('Lune Valley',1,285,224,'valley'),
 ('Evendim Hills',1,326,269,'plains'), ('Mithlond',1,173,362,'port'),
 ('Tower Hills',1,259,432,'meadow'), ('The Shire',1,311,518,'meadow'),
 ('Harlindon',1,168,553,'coast'),
 ('Carrock',2,681,265,'mountain'), ('Esgaroth',2,860,346,'lake'),
 ('Eregion',2,531,520,'valley'), ('Moria',2,582,578,'mine'),
 ('Gladden Fields',2,677,569,'river'), ('Lórien',2,632,721,'goldforest'),
 ('Emyn Muil',2,751,766,'mountain'), ('Brown Lands',2,871,805,'steppe'),
 ('Dead Marshes',2,750,1018,'river'),
 ('North Mirkwood',3,753,275,'darkforest'), ('Eastern Mirkwood',3,783,468,'darkforest'),
 ('Anduin Valley',3,717,501,'river'), ('South Mirkwood',3,793,654,'darkforest'),
 ('North Rhûn',4,945,49,'steppe'), ('Withered Heath',4,888,151,'steppe'),
 ('South Rhûn',4,948,473,'steppe'), ('Rhûn Hills',4,959,851,'steppe'),
 ('Minhiriath',5,322,670,'coast'), ('Dunland',5,467,719,'plains'),
 ('Enedwaith',5,428,847,'plains'), ('Fangorn',5,572,853,'forest'),
 ('The Wold',5,670,890,'plains'), ('West Rohan',5,412,1029,'fortress'),
 ('Gap of Rohan',5,563,1006,'plains'),
 ('Drúwaith Iaur',6,302,1160,'coast'), ('Andrast',6,252,1283,'coast'),
 ('Anfalas',6,340,1280,'coast'), ('Vale of Erech',6,432,1182,'meadow'),
 ('Lamedon',6,496,1159,'mountain'), ('Belfalas',6,514,1331,'port'),
 ('Lebennin',6,601,1273,'meadow'), ('Minas Tirith',6,634,1159,'whitecity'),
 ('Ithilien',6,675,1150,'forest'), ('South Ithilien',6,718,1340,'forest'),
 ('Udûn',7,794,1143,'blackgate'), ('Barad-dûr',7,950,1157,'ash'),
 ('Mount Doom',7,821,1191,'volcano'), ('Minas Morgul',7,770,1250,'ash'),
 ('Gorgoroth',7,936,1255,'ash'), ('Nurn',7,846,1381,'ash'),
 ('Harondor',8,671,1435,'desert'), ('Umbar',8,563,1524,'desertport'),
 ('Far Harad',8,554,1630,'desert'), ('Harad',8,777,1619,'desert'),
 ('Near Harad',8,852,1524,'desert'), ('Khand',8,959,1465,'desert'),
]

# All strokes are centerlines of printed borders, rivers or mountain divides.
# Endpoints intentionally meet or extend past another boundary / into the sea.
LINES = {
 'west-ar nor': [(407,134),(407,165),(399,183),(380,195),(360,202),(374,218),(389,235),(389,247),(378,260),(365,280),(363,300),(370,316),(374,335),(364,348),(351,365),(347,383),(337,404),(334,421),(342,440),(336,460),(340,480),(351,502),(353,522),(342,539),(322,545),(311,557),(302,580),(292,601),(267,616)],
 'forlindon-lune': [(187,170),(216,185),(223,205),(207,235),(188,264),(170,287),(160,309)],
 'forlindon-mithlond': [(160,309),(143,318),(125,331),(113,345),(109,354),(116,365),(125,374),(136,386)],
 'lune-mithlond': [(160,309),(181,320),(193,334),(198,349),(210,360),(215,380),(220,401)],
 'lune-evendim': [(360,202),(342,204),(322,211),(306,225),(291,239),(280,255),(276,273),(284,291)],
 'lune-tower-river': [(284,291),(270,286),(258,289),(252,301),(248,319),(250,333),(243,352),(238,369),(232,389),(223,408)],
 'evendim-tower': [(284,291),(280,310),(288,326),(305,340),(324,350),(344,345),(370,316)],
 'mithlond-tower': [(233,401),(232,422),(228,444),(229,463),(231,480),(225,491),(218,498),(225,500)],
 'mithlond-harlindon': [(163,460),(170,474),(170,487),(175,497),(193,501),(209,504),(225,500)],
 'tower-shire': [(337,416),(321,412),(313,415),(301,409),(293,413),(286,427),(280,439),(280,452),(284,467),(281,479),(275,494),(279,514),(279,529),(274,547)],
 'harlindon-shire': [(225,500),(242,513),(254,527),(269,540),(274,547),(289,564),(302,580)],
 'north-rhun': [(829,-5),(836,18),(841,39),(849,59),(847,74),(840,83),(831,95),(822,115),(805,137),(786,155),(761,170),(732,171),(707,180),(686,186),(660,193),(643,197)],
 'forodwaith-east-angmar': [(481,124),(490,143),(496,157),(517,160),(535,156),(556,160),(570,150),(585,135),(598,111),(611,93),(627,91),(646,99),(664,98),(683,89),(701,80),(717,84),(734,96),(740,118),(755,133),(772,137),(785,146)],
 'angmar-borderlands': [(496,157),(483,174),(471,189),(469,208),(480,225),(487,243),(510,257)],
 'angmar-rhudaur': [(510,257),(533,260),(555,260),(578,261),(598,264),(623,268),(641,274)],
 'arnor-carrock': [(535,127),(549,144),(561,164),(583,184),(599,206),(615,226),(627,246),(641,274),(644,296)],
 'rhudaur-borderlands': [(644,296),(619,298),(596,303),(574,315),(559,322),(546,336),(553,355),(559,372),(552,387),(541,401),(538,416),(529,431),(523,446),(522,465)],
 'north-downs-loop': [(374,335),(381,317),(386,299),(384,287),(396,274),(418,267),(435,257),(451,265),(463,283),(460,303),(451,321),(441,333),(420,342),(395,349),(366,345)],
 'fornost-weather': [(441,333),(450,346),(469,355),(464,371),(450,383),(441,398),(443,413)],
 'border-weather': [(469,355),(483,360),(498,358),(510,365),(520,369),(552,371)],
 'fornost-buckland': [(337,416),(359,418),(380,426),(398,427)],
 'old-forest-loop': [(398,427),(411,415),(433,414),(453,422),(478,444),(495,453),(485,473),(469,492),(451,512),(430,516),(407,512),(398,495),(399,473),(403,452),(398,427)],
 'weather-south': [(495,453),(510,454),(525,459)],
 'buckland-south': [(349,502),(364,500),(375,486),(384,481),(398,495)],
 'arnor-south': [(313,557),(338,568),(356,584),(383,586),(404,600),(417,625),(444,633),(467,637),(494,637),(515,638),(548,638),(575,634)],
 'arnor-eregion': [(522,465),(528,483),(521,499),(516,521),(508,541),(499,559),(491,576),(475,587),(465,602),(454,618),(453,636)],
 'rhudaur-eregion': [(522,465),(546,465),(565,454),(585,449),(596,439),(606,441),(619,445),(633,455),(647,474)],
 'eregion-moria': [(647,474),(629,492),(612,511),(596,528),(574,551),(553,575),(544,590),(557,604),(575,611)],
 'moria-gladden': [(633,499),(636,517),(632,537),(637,557),(633,577),(621,596),(612,611)],
 'lorien-north': [(575,611),(593,618),(612,611),(620,631),(632,641),(658,643),(677,655)],
 'lorien-west': [(575,634),(557,654),(542,675),(527,694),(513,717),(499,737),(492,759),(494,781),(510,797),(530,806)],
 'lorien-rohan': [(530,806),(552,808),(574,798),(595,798),(614,787),(627,766),(638,757),(655,753),(675,761),(691,777)],
 'carrock-gladden': [(644,296),(649,314),(648,337),(655,354),(643,374),(639,392),(647,411),(658,432),(666,451),(663,468),(647,474),(659,490),(680,509),(692,523)],
 'carrock-mirkwood': [(732,171),(726,187),(719,206),(716,226),(707,248),(710,272),(714,295),(724,317),(738,336),(751,352),(757,373)],
 'esgaroth-rhun': [(931,247),(921,270),(910,287),(902,312),(900,331),(889,350),(885,371),(880,389),(883,408),(892,418),(893,439),(901,457),(906,479),(908,500),(918,521),(923,544),(932,567),(951,587),(982,598),(1005,601)],
 'mirkwood-esgaroth': [(786,155),(785,179),(792,197),(786,219),(791,238),(786,258),(789,278),(802,292),(805,308),(818,320),(823,338),(817,351),(813,370),(803,383),(784,387),(757,383),(737,386),(714,397),(699,406),(677,410),(658,432)],
 'mirkwood-north-east': [(757,373),(757,383)],
 'east-mirkwood-anduin': [(757,383),(749,399),(754,421),(757,442),(756,463),(762,484),(765,508),(766,531),(754,548),(760,573),(753,596)],
 'anduin-west': [(699,406),(687,423),(687,443),(695,464),(704,483),(704,500),(697,513),(692,523),(699,544),(697,564),(682,588),(675,606),(672,632),(677,655),(670,681),(669,703),(679,724),(676,742),(680,765),(691,777)],
 'mirkwood-south-north': [(682,588),(704,594),(728,594),(753,596),(776,596),(797,596),(819,600),(830,609)],
 'esgaroth-brown': [(803,383),(812,403),(813,427),(821,447),(838,456),(859,452),(875,456),(877,478),(865,503),(847,523),(825,538),(818,555),(820,577),(830,592),(830,609),(846,615),(866,625),(874,643),(869,662),(860,681),(840,700),(824,706),(796,711),(776,722),(752,711),(737,698),(719,687),(699,672),(684,677),(671,681)],
 'withered-north-rhun': [(847,74),(868,82),(890,79),(906,87),(924,89),(941,86),(955,92),(958,112),(950,138),(948,165),(945,186),(931,217),(931,247)],
 'withered-south-rhun': [(791,180),(815,183),(835,194),(849,206),(865,217),(888,228),(908,242),(931,247),(955,258),(980,263),(1005,264)],
 'rhun-brown': [(982,598),(969,619),(958,639),(958,658),(962,679),(968,701),(955,727),(946,752),(935,774),(925,795),(925,807),(938,820),(946,836),(958,856),(975,869),(985,890),(1005,905)],
 'minhiriath-dunland': [(417,625),(406,642),(397,663),(398,683),(388,700),(391,722),(399,739),(399,757),(391,777),(381,805),(379,828),(370,852),(367,874),(356,895),(355,921),(370,938)],
 'dunland-enedwaith': [(399,674),(418,692),(421,714),(434,732),(445,758),(462,778),(477,786),(494,781)],
 'enedwaith-fangorn': [(530,806),(516,822),(511,840),(504,860),(504,882),(497,902),(491,919),(472,931),(448,935),(425,944),(401,947),(370,938)],
 'fangorn-wold': [(614,787),(625,806),(629,830),(632,848),(630,870),(620,887),(620,910),(612,931),(614,945),(636,959),(653,973)],
 'wold-emyn': [(691,777),(705,779),(720,766),(736,774),(739,787),(725,795),(716,811),(724,827),(735,839),(737,859),(731,878),(725,896),(727,918),(717,936),(693,942),(672,961),(653,973)],
 'fangorn-gap': [(497,902),(518,915),(539,922),(553,934),(570,943),(584,951),(598,949),(612,931)],
 'west-rohan-gap': [(425,944),(440,958),(462,970),(478,983),(495,1002),(503,1027),(508,1052),(504,1076),(505,1107)],
 'emyn-brown': [(796,711),(796,736),(807,758),(812,779),(815,802),(819,824),(819,845),(826,863),(817,884),(800,902),(796,926)],
 'emyn-dead-marshes': [(727,948),(747,950),(773,946),(786,939),(796,926),(816,944),(837,955),(858,971),(868,987),(864,1008),(854,1031),(854,1054),(859,1075)],
 'rohan-dead-marshes': [(653,973),(652,993),(643,1012),(635,1035),(625,1052),(616,1077),(622,1105)],
 'rohan-gondor': [(292,1106),(316,1102),(344,1096),(369,1102),(392,1110),(413,1108),(438,1100),(462,1104),(482,1108),(505,1107),(531,1116),(554,1114),(578,1114),(601,1113),(622,1105)],
 'dead-marshes-mordor': [(622,1105),(650,1107),(679,1106),(704,1104),(734,1104),(761,1100),(785,1099),(811,1088),(836,1084),(859,1075),(881,1078),(907,1093),(932,1103),(959,1104),(983,1118),(1005,1123)],
 'druwaith-vale': [(413,1108),(397,1131),(387,1150),(373,1174),(354,1191),(340,1206),(323,1219)],
 'druwaith-andrast': [(225,1227),(243,1217),(258,1210),(276,1204),(293,1208),(308,1217),(323,1219)],
 'andrast-anfalas': [(323,1219),(312,1241),(306,1258),(305,1277),(301,1298),(300,1326),(312,1344)],
 'anfalas-vale': [(323,1219),(338,1225),(352,1240),(368,1254),(380,1260),(390,1276),(398,1300),(397,1326)],
 'vale-lamedon': [(505,1107),(491,1129),(487,1153),(476,1174),(464,1192),(455,1213),(444,1234),(437,1258),(429,1279),(417,1294),(398,1300)],
 'lamedon-belfalas': [(582,1141),(567,1160),(558,1180),(545,1192),(531,1202),(514,1214),(502,1230),(490,1245),(481,1264),(469,1275),(461,1298)],
 'belfalas-lebennin': [(531,1202),(540,1217),(551,1230),(558,1246),(560,1265),(566,1286),(565,1306),(559,1327),(553,1355),(548,1372)],
 'lamedon-minas': [(578,1114),(580,1128),(582,1141),(593,1158),(593,1176),(603,1193),(615,1210),(632,1223),(650,1228)],
 'minas-ithilien': [(622,1105),(638,1120),(653,1144),(660,1165),(662,1187),(659,1203),(650,1228),(654,1248),(664,1267),(667,1285),(665,1301),(652,1320),(644,1338),(638,1356),(624,1374),(615,1396),(601,1418),(599,1441),(609,1457),(634,1468),(662,1471),(690,1477)],
 'ithilien-mordor': [(679,1106),(689,1123),(704,1145),(710,1166),(711,1188),(724,1207),(722,1227),(722,1250),(729,1273),(738,1293)],
 'gondor-south-ithilien': [(665,1301),(688,1298),(709,1301),(738,1293),(757,1305),(771,1314),(785,1328),(797,1350),(802,1371),(803,1396)],
 'harondor-north': [(601,1418),(623,1406),(650,1400),(675,1400),(701,1404),(725,1404),(752,1408),(778,1403),(803,1396),(825,1414),(850,1434)],
 'udun-mount-doom': [(710,1166),(730,1179),(749,1180),(772,1176),(796,1171),(816,1167),(837,1164),(861,1168),(875,1181),(881,1197)],
 'barad-dur-mount-doom': [(881,1078),(876,1099),(872,1115),(884,1132),(891,1154),(889,1178),(881,1197),(905,1195),(928,1195),(955,1192),(981,1195),(1005,1194)],
 'mordor-middle': [(711,1188),(731,1197),(749,1207),(769,1220),(785,1226),(806,1218),(826,1213),(848,1210),(869,1207),(881,1197)],
 'morgul-gorgoroth': [(785,1226),(799,1243),(813,1263),(823,1283),(824,1307)],
 'mordor-nurn': [(738,1293),(764,1298),(786,1301),(803,1301),(824,1307),(850,1307),(875,1307),(899,1305),(925,1300),(951,1302),(976,1315),(1005,1324)],
 'mordor-harad': [(803,1396),(826,1400),(850,1399),(873,1393),(892,1398),(913,1399),(933,1405),(954,1410),(978,1416),(1005,1416)],
 'harondor-umbar': [(690,1477),(680,1498),(675,1519),(664,1538),(651,1553),(638,1560),(617,1561),(595,1568),(576,1568),(557,1571),(538,1578),(510,1580),(489,1592),(463,1597),(436,1600)],
 'near-khand': [(850,1399),(838,1421),(832,1443),(825,1463),(827,1487),(839,1507),(840,1533),(843,1557),(858,1583),(880,1600),(889,1620),(909,1648)],
 'far-harad-harad': [(638,1560),(639,1582),(660,1600),(677,1620),(681,1648)],
 'harad-near': [(699,1473),(696,1496),(704,1512),(724,1527),(751,1544),(768,1567),(798,1588),(819,1595),(843,1557)],
}

def compile_map():
    # Shared-junction refinements after checking the tracing against the original.
    LINES['north-rhun'].append((599,206))
    LINES['forodwaith-east-angmar'].append((805,137))
    LINES['border-weather'].append((560,371))
    LINES['fornost-weather'].append((453,422))
    LINES['north-downs-loop'].append((364,348))
    LINES['withered-south-rhun'].insert(0,(785,179))
    LINES['esgaroth-bottom']=[(875,456),(887,450),(893,439)]
    LINES['eregion-moria'].append((575,634))
    LINES['moria-gladden'].insert(0,(629,492))
    LINES['emyn-dead-marshes'].insert(0,(717,936))
    LINES['near-khand']=[(884,1400),(882,1422),(883,1442),(885,1468),(889,1490),(898,1516),(909,1534),(930,1544),(946,1560),(963,1587),(985,1598),(1005,1608)]
    LINES['harad-near']=[(825,1414),(819,1436),(800,1454),(795,1474),(794,1496),(800,1517),(811,1536),(815,1558),(815,1581),(824,1603),(833,1620),(835,1648)]
    LINES['near-khand'].insert(0,(892,1398))
    LINES['harondor-east']=[(690,1477),(712,1471),(737,1459),(754,1448),(774,1443),(789,1429),(803,1410),(803,1396)]
    LINES['carrock-gladden']=LINES['carrock-gladden'][:13]
    LINES['forlindon-lune'].insert(0,(165,167))
    LINES['forlindon-mithlond'].append((130,405))
    LINES['lune-mithlond'].append((220,419))
    LINES['rohan-gondor'].insert(0,(260,1115))
    rgb = np.array(source.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS))
    # The author's sea is grey-green; land is warm parchment. This preserves the
    # actual coastline instead of inventing a Voronoi coastline under the image.
    mask = (rgb[:,:,0].astype(int) - rgb[:,:,1].astype(int) > 0).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7,7), np.uint8))
    mask = ndimage.binary_fill_holes(mask).astype(np.uint8)
    barriers = np.zeros_like(mask)
    for pts in LINES.values():
        cv2.polylines(barriers, [np.round(np.array(pts)*SCALE).astype(np.int32)], False, 1, 3)
    free = mask & (1-barriers)
    count, components, stats, centers = cv2.connectedComponentsWithStats(free, 4)
    owners = {}
    seeds = []
    for i, (name, region, x, y, biome) in enumerate(TERRITORIES):
        px, py = round(x*SCALE), round(y*SCALE)
        # Snap a point off a printed ink stroke / river if necessary.
        found = None
        for radius in range(25):
            if found: break
            for dy in range(-radius, radius+1):
                for dx in range(-radius, radius+1):
                    qx, qy = px+dx, py+dy
                    if 0<=qx<WIDTH and 0<=qy<HEIGHT and components[qy,qx] and stats[components[qy,qx],4]>50:
                        found=(qx,qy,int(components[qy,qx])); break
                if found: break
        if not found: raise ValueError(f'No land at {name}')
        px,py,component=found
        owners.setdefault(component,[]).append(i)
        seeds.append((px,py))
    clashes = [[TERRITORIES[i][0] for i in ids] for ids in owners.values() if len(ids)>1]
    if clashes: print('MERGED',json.dumps(clashes))
    # Mithlond straddles the two banks of the Gulf of Lune in the drawing.
    owners.setdefault(int(components[round(464*SCALE),round(204*SCALE)]), [14])
    # The unnamed island in the Bay of Belfalas is not a separate playable
    # territory. Keep its whole silhouette with Belfalas instead of splitting it.
    owners.setdefault(int(components[round(1416*SCALE),round(545*SCALE)]), [47])
    labels = np.full((HEIGHT,WIDTH), -1, np.int16)
    for component, ids in owners.items():
        if component: labels[components==component]=ids[0]
    unclaimed = [(i,int(stats[i,4])) for i in range(1,count) if i not in owners and stats[i,4]>300]
    print('UNCLAIMED', [(i,n,[round(c/SCALE,1) for c in centers[i]]) for i,n in unclaimed])
    # Close the thin traced border strokes and assign tiny ink islands to a bank.
    _, nearest = ndimage.distance_transform_edt(labels<0, return_indices=True)
    labels[mask.astype(bool)] = labels[tuple(nearest[:,mask.astype(bool)])]
    preview = Image.fromarray(rgb)
    colors = np.random.default_rng(94).integers(40,235,(len(TERRITORIES),3))
    tint = np.array(preview).copy()
    for i in range(len(TERRITORIES)):
        area=labels==i; tint[area]=(tint[area]*.58+colors[i]*.42).astype(np.uint8)
    preview=Image.fromarray(tint); draw=ImageDraw.Draw(preview)
    for name,pts in LINES.items(): draw.line([(x*SCALE,y*SCALE) for x,y in pts], fill=(40,20,15), width=2)
    for i,(x,y) in enumerate(seeds):
        draw.ellipse((x-7,y-7,x+7,y+7), fill='white',outline='black')
        draw.text((x+8,y),str(i)+':'+TERRITORIES[i][0],fill='white',stroke_width=2,stroke_fill='black')
    preview.resize((1000,round(HEIGHT/2))).save(OUT/'territory-trace.png')
    np.save(OUT/'labels.npy',labels)
    (OUT/'trace-diagnostics.json').write_text(json.dumps({'merged':clashes,'unclaimed':unclaimed,'seeds':seeds},indent=2))
    if clashes: return
    territories=[]
    for i,(name,region,x,y,biome) in enumerate(TERRITORIES):
        contours,_=cv2.findContours((labels==i).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        polygons=[]
        for contour in contours:
            if cv2.contourArea(contour)<30: continue
            poly=cv2.approxPolyDP(contour,1.3,True).reshape(-1,2).tolist()
            if len(poly)>=3: polygons.append(poly)
        territories.append(dict(id=i,name=name,region=region,sx=seeds[i][0],sy=seeds[i][1],lx=seeds[i][0],ly=seeds[i][1],biome=biome,polygons=polygons))
    adjacency=[set() for _ in territories]
    contacts={}
    for a,b in [(labels[:,:-1],labels[:,1:]),(labels[:-1,:],labels[1:,:])]:
        valid=(a>=0)&(b>=0)&(a!=b)
        pairs=np.stack([np.minimum(a[valid],b[valid]),np.maximum(a[valid],b[valid])],axis=1)
        values,counts=np.unique(pairs,axis=0,return_counts=True)
        for pair,n in zip(values,counts):
            key=tuple(int(v) for v in pair); contacts[key]=contacts.get(key,0)+int(n)
    for (a,b),length in contacts.items():
        if length>=12: adjacency[a].add(b); adjacency[b].add(a)
    # Printed dotted shipping routes and the shared banks of the major rivers.
    sea_names=[('Forodwaith','Mithlond'),('Mithlond','Minhiriath'),('Minhiriath','Belfalas'),('Belfalas','Umbar')]
    names={t['name']:t['id'] for t in territories}
    sea_links=[[names[a],names[b]] for a,b in sea_names]
    for a,b in sea_links: adjacency[a].add(b); adjacency[b].add(a)
    # Rivers remain borders in the original rules; neighboring banks can attack.
    for i,t in enumerate(territories):
        bank=cv2.dilate((labels==i).astype(np.uint8),np.ones((15,15),np.uint8))
        neighbors, lengths = np.unique(labels[bank.astype(bool)], return_counts=True)
        for j, length in zip(neighbors, lengths):
            if j>=0 and j!=i and length>=100:
                adjacency[i].add(int(j)); adjacency[int(j)].add(i)
    for t,a in zip(territories,adjacency): t['adj']=sorted(a)
    data={'id':'middle-earth-user-64-v1','width':WIDTH,'height':HEIGHT,'sourceWidth':source.width,'sourceHeight':source.height,'image':'middle-earth-user-map.jpg',
        'regions':[dict(id=i,name=n,short=n,bonus=b,hue=h) for i,(n,b,h) in enumerate(REGIONS)],'territories':territories,'seaLinks':sea_links}
    (ROOT/'js/user-map-data.js').write_text('/* Traced from the user\'s original map. Generated by tools/trace_user_map.py. */\nwindow.USER_MAP = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    print('COMPILED',len(territories),'territories',sum(map(len,adjacency))//2,'connections')

if __name__=='__main__': compile_map()
