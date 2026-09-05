# Showroom Suite gebruiken

Voor de dagelijkse gebruiker. U hoeft dit niet van voor tot achter te lezen;
zoek op wat u nodig heeft.

## Het scherm

Links staat het menu, bovenin de zoekbalk. Rechtsboven ziet u in één oogopslag
wie er deze week beschikbaar is, bijvoorbeeld `DM ✓ · PD ✓ · RB afwezig`.

## Het dashboard

Dit is wat u ziet als u de app opent.

Bovenaan staat een **balk met cijfers**: de bezetting van deze week, het
gemiddelde over de komende vier weken, hoeveel kansen er open staan met welk
bedrag, de gewogen pijplijn (bedrag maal kans) en wat er dit jaar is gescoord.

Daaronder de **signaleringen** — zie hieronder — en daaronder de grafieken.

**Aandachtspunten** gaat specifiek over leegte. Hier komt te staan wanneer de showroom leeg
dreigt te lopen, en hoeveel woningen er dan nog nodig zijn. Bijvoorbeeld:

> Let op — showroom loopt leeg vanaf week 45. Van week 45 t/m week 50 ligt de
> verwachte bezetting op gemiddeld 38%. Er is ruimte voor circa 34 woningen.

Dat laatste getal is waar het acquisitieoverleg om draait.

**Showroombezetting** toont 26 weken vooruit. De blauwe staven zijn de
verwachte belasting in afspraken per week; het gearceerde deel is prognose uit
nog niet gewonnen kansen. De groene lijn is de capaciteit die er werkelijk is.
De gestreepte groene lijn erboven is de capaciteit die er zou zijn als niemand
verlof had of elders zat. Het gat tussen die twee lijnen is precies wat u
kwijtraakt aan verlof en inzet elders.

Liever cijfers dan een plaatje? Klik op **Als tabel tonen**.

**Wie is er de komende weken** en **Bezetting per begeleider** vertellen het
verhaal per persoon.

### Signaleringen

Bovenaan het dashboard staat wat er aandacht vraagt, op ernst gesorteerd:
**urgent**, **let op** of **ter info**. De ernst staat er als woord bij, niet
alleen als kleur.

De applicatie rekent dit elk uur zelf door. Met **Nu doorrekenen** gaat het
meteen — handig nadat u een planning heeft geïmporteerd.

Bij elke melding staat hoe lang hij al speelt. Een overbezette week die er
vanochtend bij kwam is iets anders dan een die er al drie weken staat.

Er zijn drie knoppen, en het verschil doet ertoe:

| Knop | Wat het doet |
|---|---|
| **Gezien** | de melding blijft staan, maar valt op de achtergrond |
| **Later** | een week uit beeld; komt terug als het dan nog speelt |
| **Afhandelen** | sluiten — komt terug als de situatie er bij de volgende controle nog is |

Die laatste is met opzet zo: wegklikken lost niets op, en de app doet niet
alsof. Verdwijnt de situatie vanzelf — die drukke week is voorbij, dat project
heeft een planning gekregen — dan sluit de melding zichzelf.

Een beheerder stelt de regels in bij **Instellingen → Signaleringen**: aan of
uit, hoe erg, en met welke drempels.

## Planning

Hetzelfde beeld, maar met scenario-schuiven eronder:

- **A** — hoeveel showroomafspraken er per week passen (het teamplafond).
- **V** — hoeveel fysieke afspraken één woning kost. Meestal 1: de tweede
  afspraak gaat telefonisch en belast de showroom niet.
- **D** — over hoeveel weken het nawerk van een afspraak zich uitsmeert.

Zet **Scenario tonen** aan en schuif. De stippellijn laat zien wat er zou
gebeuren. **Er wordt niets opgeslagen** — u kunt vrij spelen.

## Verlof & inzet

Dit scherm heeft tabbladen: **Kalender**, **Aanvragen**, **Goedkeuren** (alleen
voor managers), **Saldo** en **Inzet elders**.

### Kalender

Het jaarraster toont per medewerker per week wat er speelt:

| Letter | Betekenis |
|---|---|
| **V** | verlof |
| **Z** | ziekte |
| **I** | inzet op een ander project |

Gearceerde weken zijn gesloten (bouwvak, kerst).

Onder het raster staat permanent de **capaciteitsstrook**: per week hoe vol het
zit, in stoplichtkleuren met het woord erbij ("Ruimte", "Vol", "Overbezet").
Dat is het punt van dit scherm: u ziet meteen wat verlof met de planning doet.

### Verlof aanvragen

Kies het soort en de periode. Voor één dag laat u "tot en met" leeg; voor een
halve dag kiest u ochtend of middag. Weekenden, feestdagen en uw eigen vaste
vrije dagen tellen niet mee.

Terwijl u de datums invult, laat de app zien wat de aanvraag doet:

> Week 22: bezetting 78% → 116%. Al weg: DM (16 uur).

Dat is een **waarschuwing, geen blokkade**. U mag alsnog aanvragen; er is soms
een goede reden. Overleg het even als het krap wordt.

U vraagt verlof voor uzelf aan. Voor een collega kan alleen een manager dat
doen. Uw eigen aanvraag kunt u altijd intrekken, ook nadat hij is goedgekeurd.

### Goedkeuren (managers)

Op het tabblad **Goedkeuren** staat wat er op een beslissing wacht, met het
aantal ernaast op het tabblad zelf. Bij elke aanvraag staat dezelfde
doorrekening als de aanvrager zag, dus u hoeft nergens heen om te zien of die
week het aankan.

Goedkeuren en afwijzen kunnen allebei met een notitie, en die notitie ziet de
aanvrager terug bij zijn aanvraag.

### Saldo

Het saldo staat in **uren**, niet in dagen. Dat is de enige eenheid waarin een
parttimer en een voltijder in dezelfde tabel passen; de omrekening naar dagen
staat er kleiner onder, op basis van een achturige dag.

| Kolom | Wat het is |
|---|---|
| Recht | wat u dit jaar krijgt |
| Overgeheveld | wat er uit vorig jaar is meegenomen |
| Opgenomen | goedgekeurd verlof dat al geboekt is |
| Aangevraagd | wat nog op goedkeuring wacht |
| Resterend | recht + overgeheveld − opgenomen |
| Vrij te besteden | resterend − aangevraagd |

Het verschil tussen die laatste twee is waar een verkeerde toezegging vandaan
komt: "resterend" is wat er nog staat, "vrij te besteden" is wat er overblijft
als alles wat er ligt wordt goedgekeurd.

Ziekte gaat niet van het verlof af. Een bedrijfssluiting ook niet automatisch —
wilt u de bouwvak van het saldo laten aftrekken, boek hem dan als verlof.

Een manager stelt het recht per medewerker per jaar in met "Recht instellen".

### Wat collega's zien

Iedereen ziet *dat* u afwezig bent — dat moet, anders klopt de planning niet.
Bij ziekte en zorgverlof ziet een collega alleen "Afwezig", niet welk type. Uw
manager en u zelf zien het wel. **De aard van een ziekte wordt nergens
vastgelegd.**

### Inzet op een ander project

Voor als u er wél bent, maar niet voor de showroom. U geeft de periode op en
hoeveel: een percentage, een aantal dagen per week, of een aantal uren per
week. Bijvoorbeeld: *RB — Renovatie Kerkstraat — week 12 t/m 20 — 2 dagen per
week*.

Inzet elders kent geen goedkeuring: hij gaat van de showroomcapaciteit af zodra
hij op "gepland" of "actief" staat. Ook hier geldt dat u uw eigen inzet
vastlegt en een manager die van een collega.

Dat de app zelf meldt wanneer zo'n inzet afloopt — *"RB komt vanaf week 21 weer
volledig beschikbaar"* — komt met de signaleringen in een latere fase.

## Klanten en contactpersonen

`Ctrl+K` zoekt overal tegelijk: klanten, contactpersonen, projecten en kansen.
U tikt gewoon in wat u zoekt; aanhalingstekens en sterretjes hoeft u niet te
gebruiken en ze storen ook niet.

Onder **Dubbelen** staat wat er mogelijk twee keer in het systeem zit. Een
gelijk KvK-nummer of e-mailadres is zeker, een gelijkende naam is een
vermoeden. Bij samenvoegen kiest u per veld welke waarde blijft; alles wat aan
het vervallende record hing — contactpersonen, projecten, kansen, offertes,
bijlagen — verhuist mee. **Samenvoegen kan niet ongedaan worden gemaakt**, dus
kijk eerst.

Op elke detailpagina staat rechts de tijdlijn: gesprekken, wijzigingen,
e-mails, offertes en fasewisselingen door elkaar, op volgorde. In het veld
erboven legt u meteen vast wat er besproken is.

## Kansen

Het kansenscherm is een bord met een kolom per fase. Elke kaart is een kans,
met het bedrag, het gewogen bedrag, de eigenaar en de verwachte sluitdatum.
Staat er een rode rand met "⚠ zoveel dagen geen beweging" om een kaart, dan
staat die kans langer stil dan bij die fase hoort.

**Een kans verplaatsen** doet u door de kaart naar een andere kolom te slepen,
of — als u liever niet sleept — met de keuzelijst "Verplaats naar" onderaan de
kaart. Die twee doen precies hetzelfde.

**Winnen** en **verliezen** gaan niet door te slepen. Sleept u een kaart toch
naar "Gewonnen" of "Verloren", dan opent de dialoog die erbij hoort:

- Bij **winnen** vult u per discipline in wat er daadwerkelijk gescoord is. Het
  offertebedrag staat er alvast in; wat u op nul laat staan, wordt als verloren
  geboekt. Zo klopt de omzet per discipline later, ook als een kans op tegels
  wél doorging en op keukens niet. Wilt u het meteen inplannen, laat dan
  "Meteen een showroomproject aanmaken" aanstaan: de klant, het aantal woningen
  en de verwachte showroomperiode gaan mee.
- Bij **verliezen** kiest u een reden of schrijft u kort op wat er speelde. Een
  van die twee is verplicht — zonder reden zegt het verliesrapport later niets.

**De regels van een kans** staan op de detailpagina, per discipline: aantal,
eenheid, stuksprijs, korting en kostprijs. Bedrag en marge rekent de
applicatie uit; die kunt u niet zelf invullen, en ze lopen al mee terwijl u
typt. Bedragen tikt u Nederlands in, met een komma: `1.234,56`.

Met de knop **Lijstweergave** gaat u naar de gewone lijst, met filters,
kolomkeuze en opgeslagen weergaven.

Onder **Rapportages** staat de trechter: wat er per fase open staat, wat u wint
en waarop, hoe lang elke fase duurt en waarom kansen weglopen. Alles staat er
ook als tabel, dus u hoeft geen staaflengte te schatten.

## Projecten

Op de detailpagina van een project staat onder de velden de **fasering**: per
fase een balk met de periode, en eronder dezelfde gegevens als tabel.

Alleen showroom en sluiting belasten de planning. Start bouw en oplevering staan
er wel bij — ze horen bij het project — maar tellen niet mee in de bezetting.
Dat is aan de balk te zien (gearceerd) én het staat er in woorden bij.

Met "Afwijkend aantal woningen" laat u één fase over minder woningen gaan dan
het hele project. Leeg laten betekent: het hele project.

### Planning importeren

Vanuit de projectenlijst gaat u met **Planning importeren…** naar de import. Die
loopt in vier stappen.

1. **Bestand kiezen.** Een Excel-bestand (.xlsx) of een CSV. Geef aan op welke
   regel de kolomnamen staan — alles daarboven wordt genegeerd. Met "Bestaande
   projecten bijwerken" uit worden alleen nieuwe projecten aangemaakt.
2. **Kolommen koppelen.** De app doet een voorstel op basis van de kolomnamen en
   herkent de gebruikelijke varianten ("Aantal won.", "Projectnr", "KB"). Klopt
   er iets niet, dan kiest u zelf een andere kolom; het voorbeeld werkt meteen
   bij.
3. **Voorbeeld.** Per regel staat wat er zou gebeuren: nieuw, bijwerken,
   ongewijzigd of fout. Bij bijwerken staat erbij wélke kolommen veranderen, met
   de oude en de nieuwe waarde. Bij een fout staat de reden erbij en het
   regelnummer uit uw bestand.
4. **Doorvoeren.** Nu pas wordt er iets weggeschreven, in één keer. Regels met
   een fout worden overgeslagen; de rest gaat gewoon door.

Wat de import bewust *niet* doet: een onbekende opdrachtgever aanmaken als
klant. U krijgt een melding en koppelt hem later zelf — anders staan er na een
paar imports vijf varianten van dezelfde aannemer in het systeem.

Datums leest de app Nederlands: `03-02-2026` is 3 februari. Getallen ook:
`1.250` is duizend tweehonderdvijftig.

Onderaan het scherm staat wat er eerder is geïmporteerd, door wie en met welke
uitkomst.

## Duurzaamheid

Onder **Duurzaamheid** staan twee tabbladen: de **pakketten** en de **offertes**
die eruit voortkomen.

### Pakketten

Elk pakket toont zijn samenstelling en de prijs die daaruit volgt — excl. btw,
btw, incl. btw, en de marge. Die prijs staat niet vast opgeslagen: wijzigt de
inkoop- of verkoopprijs van een product, dan staat het hier meteen goed.

De marge is een intern cijfer. Hij staat op het scherm en niet op de offerte.

Onderdelen die als **optioneel** in het pakket staan, tellen niet mee in de
pakketprijs. De klant kiest ze per offerte bij.

### Een offerte maken

Klik bij een pakket op **Offerte maken…**. Kies de klant, eventueel het project,
en hoeveel keer het pakket geleverd wordt — kiest u een project, dan wordt het
aantal woningen daarvan automatisch ingevuld. Alle aantallen in de regels worden
daarmee vermenigvuldigd.

De offerte krijgt een nummer (`OF-2026-0001`) en is dertig dagen geldig.

**De offerte is een kopie van het pakket.** Wijzigt het pakket daarna, dan
verandert deze offerte niet meer mee. Wat de klant heeft gezien, blijft staan.

### De offerte afmaken

Op de offertepagina vinkt u de optionele onderdelen aan die de klant erbij wil.
De totalen lopen meteen mee. Bij een pakket met een vaste prijs verschuiven ook
de andere regelbedragen — dat hoort zo, anders klopt de btw niet meer.

| Knop | Wanneer |
|---|---|
| **Versturen** | zet de offerte op verstuurd en start de teller voor "wacht op antwoord" |
| **Geaccepteerd** | de klant gaat akkoord |
| **Afgewezen…** | met een reden of een toelichting — een van beide is verplicht |
| **Afdrukken (PDF)** | maakt er een PDF van en vraagt waar die moet komen |

Een offerte waarvan de geldigheid voorbij is, gaat vanzelf op **vervallen**. Dan
staat hij niet langer in de trechter alsof er nog antwoord op kan komen.

## Opvolging

Onder **Opvolging** staat wat er te doen is, in twee tabbladen.

### Mijn werk

Vier bakjes, en niet meer:

| Bakje | Wat er in staat |
|---|---|
| **Te laat** | de datum is voorbij en het is nog niet afgerond |
| **Vandaag** | wat vandaag staat gepland |
| **Komende twee weken** | wat eraan komt |
| **Zonder datum** | taken die nooit zijn ingepland |

Een taak van vandaag valt niet onder "te laat", ook al is het tijdstip voorbij —
de dag is nog niet om.

Dat laatste bakje staat er met opzet: taken zonder datum verdwijnen anders uit
beeld, en dan is de takenlijst een plek waar dingen heen gaan om te sterven.

**Afronden** doet twee dingen tegelijk. U noteert wat eruit kwam — dat komt in
de tijdlijn van de klant — en u kunt meteen de vervolgactie inplannen. Dat is
het hele punt: een gesprek dat eindigt met "ik bel over twee weken terug" en
waar niemand iets voor inplant, krijgt geen vervolg.

Een manager kan met de keuzelijst rechtsboven de lijst van een collega bekijken.

### Bellijsten

Een lijst waar u doorheen loopt: afvinken en een notitie per gesprek.
Afgevinkte regels verdwijnen niet maar zakken naar beneden, zodat u ziet hoever
u bent en een vinkje terug kunt draaien.

## Berichten versturen

Op de pagina van een klant, contactpersoon, project, kans of offerte staat
**Bericht opstellen…**.

Kies een sjabloon of schrijf zelf. In een sjabloon staan plaatshouders als
`{{contact.voornaam}}` en `{{offerte.totaal}}`; die worden gevuld met de
gegevens van het record. Onder "Beschikbare plaatshouders" ziet u welke er zijn
en wat er nu in staat — klik erop om hem in te voegen.

Na **Opstellen** ziet u het bericht zoals het eruit komt te zien. Staat er
onderaan een waarschuwing over plaatshouders, dan is er iets niet ingevuld:
controleer dat voordat u verstuurt.

**Openen in Outlook (.eml)** slaat het bericht op als bestand. Dubbelklik dat
bestand: Outlook opent het als concept, u leest het na en verstuurt zelf, vanuit
uw eigen mailbox met uw eigen handtekening.

De app verstuurt dus niets zelf. Dat is een bewuste keuze — er hoeft geen
wachtwoord of token van uw mailbox bewaard te worden, en er gaat nooit iets weg
dat u niet zelf heeft gezien.

Met **Ik heb hem verstuurd** noteert u dat het bericht de deur uit is. Het staat
dan als verstuurd in de tijdlijn.

Staat bij een contactpersoon **niet mailen** aan, dan komt hij niet in de
ontvangers en zegt de app dat ook.

## De assistent

Op de detailpagina van een klant, contactpersoon, project, kans of offerte staat
rechtsboven de knop **Assistent…**. Die laat een taalmodel een concept voor u
schrijven: een opvolgmail, een kennismakingsmail, een samenvatting van het
dossier of een nette afwijzing.

Dit is het enige onderdeel van de applicatie dat gegevens naar buiten stuurt.
Verder werkt alles op deze computer. Daarom drie dingen om te weten.

**Er gaan geen namen mee.** Bij vrijwel elke preset staat aan dat namen,
adressen, e-mailadressen en telefoonnummers worden vervangen door plaatshouders
als `«PERSOON_1»` voordat de vraag weggaat. Het antwoord dat terugkomt heeft die
plaatshouders nog, en de applicatie vult er hier de echte gegevens weer in. U
ziet dus een gewone tekst; de dienst zag alleen plaatshouders. Staat het
vervangen bij een preset uit, dan zegt het scherm dat er duidelijk bij.

**U kunt het zelf nakijken.** Klik op **Bekijk wat er weggaat** in plaats van op
Uitvoeren. Dan ziet u letterlijk de tekst die verstuurd zou worden, en gaat er
niets weg. Dat werkt ook als de assistent uitstaat.

**Het is een voorstel, geen eindtekst.** Lees het na en pas het aan voordat het
naar een klant gaat. U kunt de tekst in het venster bewerken en daarna
kopiëren.

Staat er in het voorstel nog een plaatshouder als `«PERSOON_9»`, dan heeft het
model die zelf verzonnen. Het scherm waarschuwt daarvoor. Haal hem weg.

Ziet u de knop maar staat er "de assistent staat uit"? Dan is er geen
API-sleutel ingevuld. Een beheerder doet dat bij Instellingen → AI. Zonder
sleutel verlaat er niets deze computer.

## Rapportages

Bij **Rapportages** stelt u zelf een vraag aan de gegevens en haalt u het
antwoord op als Excel, Word, CSV of PDF.

### De bouwer

1. Kies bovenaan waarover de rapportage gaat: klanten, kansen, projecten,
   offertes, verlof — alles wat de applicatie bijhoudt.
2. Vink de kolommen aan die u wilt zien.
3. Kies eventueel waarop gesorteerd wordt.
4. Klik op **Draaien**.

Onder de gekozen kolommen staat per kolom een keuzelijstje en een vinkje
**groeperen**. Daarmee maakt u een totaaloverzicht. Wilt u bijvoorbeeld weten
hoeveel kansen er per status openstaan en voor welk bedrag: vink *status* aan
en zet er **groeperen** bij, vink *id* aan met de functie **aantal**, en
*bedrag* met de functie **som**.

Elke kolom moet dan óf gegroepeerd zijn óf een functie hebben. Doet u dat niet,
dan zegt het scherm dat, en dat is met opzet: een naam naast een totaal is
altijd een willekeurige naam uit die groep, en daar kunt u niets mee.

Gearchiveerde records blijven weg, tenzij u het vinkje daarvoor aanzet.

### Exporteren

Na **Draaien** verschijnen de knoppen **Naar Excel**, **Naar CSV**, **Naar
Word** en **Naar PDF**. De titel die u invult komt boven de export en wordt de
bestandsnaam.

- **Excel** is de bruikbaarste: bedragen staan er als bedrag in, datums als
  datum, de kopregel staat vast en er zit een filter op. U kunt er meteen mee
  doorrekenen.
- **CSV** is voor als iets anders het bestand moet inlezen.
- **Word** is voor een rapportage die in een verslag of een vergaderstuk moet.
- **PDF** is om te versturen of af te drukken.

Bij meer dan 5000 regels wordt de lijst afgekapt, met een melding erbij. Voeg
dan een filter toe of groepeer.

### Bewaren en delen

Onder het resultaat kunt u de rapportage een naam geven en bewaren. Met het
vinkje **met collega's delen** kan iedereen hem draaien; zonder dat vinkje
alleen u. Bewaarde rapportages staan op het tabblad **Opgeslagen**. Verwijderen
kan alleen wie hem gemaakt heeft, of een beheerder.

### De trechter

Het tabblad **Trechter** is het vaste kansenrapport met de grafiek. Dat is geen
bouwer maar een vast overzicht.

## Op uw telefoon

Staat de applicatie op de showroom-pc in de **hostmodus**, dan kunt u er met uw
telefoon bij. Uw beheerder geeft u het adres, zoiets als
`http://192.168.1.42:4317`. Typ dat in de browser en log in met uw eigen
account.

In het menu van de browser staat **Aan beginscherm toevoegen**. Doet u dat, dan
krijgt u een pictogram zoals bij een gewone app en opent hij zonder adresbalk.

Op een telefoon zit het menu achter de knop ☰ linksboven in plaats van in een
balk aan de zijkant. Brede tabellen kunt u zijwaarts vegen.

Dit werkt alleen op het bedrijfsnetwerk en alleen als de showroom-pc aan staat.
Er wordt niets op uw telefoon bewaard: zonder verbinding werkt hij niet, en dat
is met opzet — dan staan er ook geen klantgegevens op een toestel dat u kunt
verliezen.

## Sneltoetsen

| Toets | Wat het doet |
|---|---|
| `Ctrl+K` | zoeken |
| `Ctrl+S` | opslaan |
| `Ctrl+P` | afdrukken of PDF maken |
| `Esc` | sluiten |
| `Ctrl+Alt+S` | app naar voren, waar u ook bent |

## Wat de app bewust niet doet

Mailen gaat via een bestand dat u in Outlook opent. De app verstuurt niets uit
zichzelf en haalt geen inkomende mail binnen; zie "Berichten versturen".

De assistent houdt nog geen maandbudget bij. Wat het gekost heeft is wel per
maand terug te zien bij Instellingen → AI → Logboek.

Verder gaat er niets naar buiten. De enige uitzondering is de assistent, en die
staat uit tot een beheerder er een sleutel voor invult.
