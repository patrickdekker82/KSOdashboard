# Beheerdershandleiding

Voor wie de app beheert: gebruikers, instellingen, back-ups en koppelingen.

## Gebruikers en rollen

| Rol | Mag |
|---|---|
| `admin` | alles, inclusief systeeminstellingen en de vrije SQL-modus |
| `manager` | alle gegevens, rapportages, verlof goedkeuren — geen systeeminstellingen |
| `user` | gegevens invoeren, eigen verlof aanvragen |
| `readonly` | alleen kijken |

Rechten worden op de server gecontroleerd, niet alleen in het scherm
verborgen. Een `readonly`-account dat langs de knoppen heen probeert te
schrijven, krijgt gewoon een weigering.

Wachtwoorden zijn minimaal twaalf tekens met hoofdletters, kleine letters en
een cijfer. Ze worden opgeslagen met argon2id — ook een beheerder kan een
wachtwoord niet uitlezen, alleen opnieuw instellen.

Bij een wachtwoordwijziging worden alle andere sessies van die gebruiker
uitgelogd.

## Werkroosters

Elke medewerker heeft een rooster met uren per dag en het aantal
showroomafspraken dat hij in een volle week aankan. Een rooster geldt van een
datum tot een datum; wordt iemand parttime, dan zet u het oude rooster op een
einddatum en maakt u een nieuw rooster aan. De capaciteitsberekening pakt per
week automatisch het rooster dat op de maandag van die week geldig was.

Dit is belangrijker dan het lijkt: het rooster is leidend, niet de aanname dat
iedereen maandag tot en met vrijdag werkt.

## Afwezigheidstypes

Per type stelt u in:

- **Verlaagt capaciteit** — vrijwel altijd aan.
- **Telt mee in verlofsaldo** — aan voor verlof en ADV, uit voor ziekte.
- **Vereist goedkeuring** — aan voor verlof en ADV, uit voor ziekte.
- **Zichtbaarheid** — `iedereen` of `management`.

### Privacy, en waarom dit ertoe doet

Deze applicatie bevat persoonsgegevens van kopers **en** van medewerkers.
Verzuimgegevens zijn onder de AVG bijzondere persoonsgegevens en vragen extra
zorg.

Twee regels die in de software zijn vastgelegd:

1. **De aard van een ziekte wordt nooit vastgelegd.** Alleen dát iemand
   afwezig is. Gebruik het notitieveld bij een ziekmelding niet voor medische
   informatie — ook niet "griep", ook niet als het goed bedoeld is.
2. **Types met zichtbaarheid `management` tonen aan collega's alleen
   "Afwezig".** Managers, beheerders en de betrokkene zelf zien het echte type.
   Zet ziekte en zorgverlof op `management`.

Stel daarnaast een bewaartermijn in en ruim gegevens van kopers op als die
verstreken is.

## Feestdagen

Instellingen → Feestdagen → **Genereren**. Kies het jaar. De app rekent Pasen
uit en leidt Goede Vrijdag, Tweede Paasdag, Hemelvaart en Pinksteren daaruit
af. Koningsdag schuift automatisch naar 26 april als 27 april op zondag valt.

Twee keuzes:

- **Goede Vrijdag** is standaard geen vrije dag. Zet aan als uw CAO dat wel zegt.
- **Bevrijdingsdag** is standaard geen vrije dag, en als u hem aanzet standaard
  alleen in lustrumjaren (2030, 2035, ...).

Genereren overschrijft niets: bestaande feestdagen blijven staan zoals u ze
heeft aangepast. U kunt elke dag los aan- of uitzetten.

Doe dit één keer per jaar, bij voorkeur in december voor het jaar erna.

## Sluitingsperiodes

Bouwvak en kerstsluiting. Een sluiting kan voor iedereen gelden of voor één
persoon. Weken waarin alle werkdagen gesloten zijn, krijgen capaciteit nul en
worden gearceerd getoond.

Belangrijk: werk **verdwijnt** niet door een sluiting, het **schuift door**. Een
showroomfase van acht weken levert acht weken werk, ook als er een bouwvak
middenin valt; het eind schuift dan naar achteren.

## Capaciteitsinstellingen

| Instelling | Betekenis | Standaard |
|---|---|---|
| A | afspraken per week over het hele team | 9 |
| V | fysieke showroomafspraken per woning | 1 |
| D | doorlooptijd in weken per order | 5 |
| Max. gelijktijdige trajecten | | 3 |
| Rekenwijze | zie hieronder | laagste van beide |
| Drempels | groen onder 80%, oranje tot 100% | |

De **rekenwijze** bepaalt hoe de teamcapaciteit ontstaat:

- *Som medewerkers* — optellen wat iedereen aankan. Negeert het plafond.
- *Teamplafond* — het plafond A, geschaald met de gemiddelde beschikbaarheid.
- *Laagste van beide* — de veiligste, en de standaard.

Kies *laagste van beide* als de afdeling zowel een plafond kent (er passen maar
zoveel afspraken in de showroom) als individuele beperkingen (parttimers,
verlof).

## Back-up en herstel

Alles staat bij **Instellingen → Back-up & herstel**.

### Wat er automatisch gebeurt

Elke nacht op het ingestelde tijdstip (standaard 23:00) maakt de app een
back-up met `VACUUM INTO`. Dat is geen bestandskopie maar een consistente
kopie die SQLite zelf wegschrijft: bij een gewone kopie zou een wijziging van
vlak daarvoor nog in het `-wal`-bestand kunnen staan en dus niet in de back-up.

De app kijkt elke tien minuten of de back-up van vandaag al gedraaid heeft.
Stond de pc 's nachts uit, dan wordt hij alsnog gemaakt zodra de machine aan
gaat. Er komt hooguit één automatische back-up per dag.

Standaard blijven de laatste 30 automatische back-ups staan; oudere worden bij
de loop opgeruimd. Handmatige back-ups worden nooit automatisch weggegooid.

Voordat een migratie draait, maakt de app altijd eerst een kopie.

### Een tweede doelmap

**Stel een tweede back-uppad in** op een netwerkschijf. Dat is juist de plek
waar kopieën horen. De *actieve database* mag daar nooit staan — dat blokkeert
de app, en het scherm waarschuwt als de database toch op zo'n plek terecht is
gekomen.

### Controleren

Bij elke back-up staat een knop **Controleren**. Die kijkt of het bestand heel
is en of het echt een database van deze applicatie is, zonder iets terug te
zetten. Doe dat af en toe: een back-up die u nooit controleert is een aanname,
geen back-up.

### Terugzetten

Instellingen → Back-up & herstel → **Terugzetten…** bij de gewenste back-up, en
daarna bevestigen. Wat er dan gebeurt:

1. De back-up wordt gecontroleerd. Is hij beschadigd of van een andere
   applicatie, dan stopt het hier en blijft de database ongemoeid.
2. Van de huidige database wordt een kopie gemaakt als
   `showroom-voor-herstel-*.db` in de back-upmap. U kunt dus altijd terug.
3. De back-up wordt naast de database gezet en pas dan omgewisseld, zodat er
   geen moment is waarop er geen database is.
4. De applicatie start opnieuw.

Alles wat ná die back-up is ingevoerd is daarna weg. Het scherm zegt dat er ook
bij voordat u bevestigt.

### Logboek

Onderaan het scherm staat elke loop: wanneer, welke soort, door wie, hoe groot,
hoe lang, en of het lukte. Ook mislukte pogingen staan erin — dat is het hele
punt. De signaleringsregel **Back-up mislukt** leest dit logboek en meldt het op
het dashboard als de laatste poging mislukte, als er twee dagen niets gelukt is,
of als er nog nooit een back-up gemaakt is.

## Netwerkstand

Bij **Instellingen → Netwerk & updates**.

| Stand | Wat het doet |
|---|---|
| Alleenstaand | alleen deze pc. De standaard. |
| Host | ook bereikbaar op het bedrijfsnetwerk |

In de hostmodus toont het scherm de adressen die een collega in zijn browser
moet typen, bijvoorbeeld `http://192.168.1.42:4317`. Er is geen aparte
clientinstallatie: wie meekijkt doet dat in de browser. Dat is met opzet —
één versie van de schermen, en niets om apart bij te werken.

De database blijft op de host-pc staan, en dat is de bedoeling: een database op
een netwerkschijf raakt beschadigd. De host-pc moet dus aan staan; zet daar ook
**automatisch starten bij aanmelden** aan.

Inloggen met wachtwoord blijft verplicht, ook op het netwerk. Windows Firewall
vraagt de eerste keer om toestemming voor de poort; sta die toe voor het
*particuliere* netwerk, niet voor het openbare.

Een telefoon op hetzelfde netwerk kan het adres in de browser openen en via
"aan beginscherm toevoegen" als app neerzetten — met eigen pictogram en zonder
adresbalk. De schermen schakelen dan naar de mobiele opzet: het menu wordt een
lade, tabellen scrollen zijwaarts. Er wordt niets op de telefoon bewaard; zonder
verbinding met de host werkt hij niet, en dat is met opzet zo.

Buiten kantoor werkt dit alleen via een VPN zoals Tailscale. Dat valt buiten
deze applicatie.

## Updates

Bij **Instellingen → Netwerk & updates**, onderaan.

De applicatie haalt uit zichzelf nergens iets op. Wijs een map aan waar u de
installer neerzet — meestal een map op de netwerkschijf. Blijft het veld leeg,
dan wordt er nooit ergens gekeken, en dat is de stand waarin de applicatie
geleverd wordt.

Zet in die map naast de installer een bestand `versie.json`:

```json
{
  "versie": "0.2.0",
  "bestand": "ShowroomSuite-Setup-0.2.0.exe",
  "uitgebracht": "2026-09-07",
  "opmerkingen": "Rapportages en export toegevoegd"
}
```

Klikt een gebruiker op **Nu controleren**, dan leest de app dat bestand en
vergelijkt het versienummer. Is er iets nieuwers, dan zegt hij dat en kan de
gebruiker met één knop het installatiebestand in de verkenner tonen. De
applicatie vervangt zichzelf niet: dat dubbelklikken doet de gebruiker zelf, op
een moment dat hem uitkomt. De installatie is per gebruiker, dus daar zijn geen
beheerdersrechten voor nodig, en de gegevens blijven staan.

## Microsoft 365 koppelen

De koppeling gebruikt Microsoft Graph met OAuth. SMTP wordt niet ondersteund:
Microsoft schakelt basisauthenticatie voor SMTP eind 2026 uit.

Registreren in Entra ID:

1. Ga naar **Entra ID → App-registraties → Nieuwe registratie**.
2. Naam: `Showroom Suite`.
3. Accounttypen: alleen accounts in deze organisatiemap.
4. Omleidings-URI: kies **Mobiele en desktop-toepassingen** en vul
   `http://localhost/showroom-suite-auth` in.
5. Klik op **Registreren** en noteer de **toepassings-id** en de **map-id**.
6. Ga naar **API-machtigingen → Machtiging toevoegen → Microsoft Graph →
   Gedelegeerde machtigingen** en voeg toe: `Mail.Send`, `Mail.ReadWrite`,
   `User.Read`, `offline_access`. Voor het uitlezen van afwezigheid uit
   Outlook ook `Calendars.Read`.
7. Klik op **Beheerderstoestemming verlenen**.

Er is **geen clientgeheim** nodig — dit is een publieke client die
authorization code met PKCE gebruikt. Maak er dus ook geen aan.

Vul de toepassings-id en map-id in bij Instellingen → Microsoft 365. Elke
gebruiker koppelt daarna zijn eigen postbus.

Werkt de koppeling niet, dan blijft er altijd een uitweg: de knop "Openen in
Outlook" schrijft een conceptbestand en opent dat. Dat werkt zonder koppeling
en zonder internet.

## AI-assistent

Dit is de enige koppeling die deze applicatie naar buiten heeft. Alle andere
functies werken volledig op deze computer. Lees deze paragraaf voordat u de
assistent aanzet.

### Aanzetten

De assistent staat uit zolang er geen API-sleutel is ingevuld, en zo wordt de
applicatie geleverd. Plak de Anthropic-API-sleutel bij **Instellingen → AI →
Koppeling**. Alleen een beheerder kan dat.

De sleutel wordt versleuteld opgeslagen (AES-256-GCM) en nooit teruggetoond. De
versleutelsleutel staat in `kluissleutel.bin` in de gegevensmap, náást de
database — niet erin. Dat betekent twee dingen:

- Een back-up van de database alléén levert de API-sleutel niet op. Dat is de
  bedoeling: de back-up gaat naar de netwerkschijf, het sleutelbestand niet.
- Zet u de database terug op een andere werkplek, dan is de API-sleutel daar
  onleesbaar en moet u hem opnieuw invullen. De applicatie zegt dat ook.

Uitzetten doet u met **Sleutel wissen**. Daarna gaat er weer niets naar buiten.

### Wat er naar de API gaat

Per preset stelt u in welke blokken uit het dossier meegaan: het record zelf,
de contactpersonen, de laatste contactmomenten, de offertes. Wat u niet
aanvinkt, gaat niet mee en kan dus ook niet lekken.

Elke preset heeft daarnaast de schakelaar **persoonsgegevens vervangen door
plaatshouders**. Staat die aan, dan worden namen, bedrijfsnamen, adressen,
plaatsen, postcodes, e-mailadressen, telefoonnummers en rekeningnummers
vervangen door `«PERSOON_1»`, `«ADRES_1»` enzovoort vóórdat het verzoek weggaat.
Het antwoord van het model wordt hier op de werkplek weer ingevuld. **Laat die
aan** voor elke preset die persoonsgegevens raakt.

Na het vervangen controleert de applicatie de tekst nóg een keer. Vindt die
controle alsnog een persoonsgegeven, dan gaat het verzoek niet weg en krijgt de
gebruiker een melding. Dat is een vangrail voor het geval het vervangen zelf een
fout maakt.

Wilt u zelf zien wat er weggaat: elke gebruiker kan in de assistent op **Bekijk
wat er weggaat** klikken. Dat toont letterlijk de tekst die verstuurd zou
worden, zonder iets te versturen. Die knop werkt ook als de assistent uit staat.

### Firewall

De applicatie benadert `api.anthropic.com` over HTTPS. Laat de firewall dat
adres door, anders krijgt de gebruiker de melding dat er geen verbinding is.

### Logboek en kosten

**Instellingen → AI → Logboek** toont elke aanroep: wanneer, door wie, met welke
preset, over welk record, hoeveel tokens en wat het ongeveer gekost heeft. Ook
mislukte aanroepen staan erin, met de reden. Managers en beheerders kunnen dit
zien.

De promptinhoud wordt bewust niet bewaard: die bevat klantgegevens, en het
logboek is voor elke manager zichtbaar.

De bedragen zijn een raming in **dollars**, berekend uit de tokenprijzen van het
model. Er wordt geen wisselkoers verzonnen; de factuur van de leverancier is
leidend.

Een automatisch maandbudget met waarschuwing bij 80% is er nog niet. Houd het
verbruik voorlopig in de gaten via het maandoverzicht in het logboek.

### Antwoorden zijn voorstellen

Wat de assistent oplevert is een concept, geen eindtekst. Het scherm zegt dat
ook. Laat medewerkers elk antwoord nalezen voordat het naar een klant gaat.

## De SQL-modus

Op het tabblad **SQL** bij Rapportages kunt u zelf een query op de database
stellen. Dat tabblad ziet alleen een beheerder; een manager kan wel
rapporteren, maar niet in tabellen kijken waar de schermen hem niet bij laten.

**De verbinding kan alleen lezen.** Dat is niet alleen een controle op de tekst
van uw query: de applicatie opent een tweede verbinding naar de database die
door SQLite zelf op alleen-lezen wordt gezet. Een `DELETE` of `UPDATE` wordt
daarom geweigerd, ook als er ooit een gat in de tekstcontrole zou zitten. Er
staat een test in de code die dat bewijst.

Wat er verder geldt:

- Eén query tegelijk. Een tweede instructie achter een puntkomma wordt
  geweigerd.
- De query moet met `SELECT` of `WITH` beginnen.
- `ATTACH`, `PRAGMA`, `load_extension` en de schrijfwoorden mogen niet
  voorkomen. Staan ze binnen een tekstwaarde of in commentaar, dan is het geen
  probleem: `SELECT 'update de klant'` mag gewoon.
- Maximaal 5000 rijen; daarboven wordt afgekapt met een melding.

Onder het invoerveld staat een lijstje met alle tabellen en hun kolommen. Klik
op een tabelnaam om hem in de query te plakken.

Een SQL-rapportage kan net als een gebouwde rapportage bewaard en gedeeld
worden — maar alleen een beheerder kan er een bewaren.

## Logboeken en systeeminfo

Instellingen → Systeeminfo toont versie, schemaversie, databasegrootte, laatste
back-up en netwerkstand, met een knop om de logmap te openen. Stuur die map mee
als u een storing meldt.
