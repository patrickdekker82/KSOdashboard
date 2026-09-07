# Startgids: van GitHub naar een werkende Showroom Suite

Deze gids is voor de allereerste keer, als er nog nergens een Showroom Suite
draait. U gaat van de programmacode op GitHub naar een werkende app op een
Windows-pc.

Volg de stappen van boven naar beneden. Verstand van programmeren is niet
nodig; wel moet u één keer een bestand van GitHub kunnen downloaden.

> Heeft u het installatiebestand al gekregen van een collega? Dan kunt u deze
> gids overslaan en meteen `INSTALLATIE.md` volgen. Die begint bij stap 2.

---

## Wat u nodig heeft

- Een **Windows-pc, 64-bit**. Dit is de pc waar de gegevens komen te staan.
- Ongeveer **400 MB vrije schijfruimte**.
- **Geen** beheerdersrechten: de app installeert zich voor uw eigen account.
- Een account op GitHub met toegang tot de repository `KSOdashboard`.

Doe dit op de pc die straks ook echt gebruikt gaat worden. Verhuizen kan later
wel, maar het is onnodig gedoe.

---

## Stap 1 — Het installatiebestand ophalen

Er zijn twee wegen. **Weg A is de makkelijkste**; neem weg B alleen als weg A
niets oplevert.

### Weg A — Downloaden (aanbevolen)

Bij elke wijziging bouwt GitHub zelf automatisch een installatiebestand. U hoeft
het alleen op te halen.

1. Ga naar <https://github.com/patrickdekker82/KSOdashboard>.
2. Klik bovenaan op het tabblad **Actions**.
3. Klik in de lijst op de bovenste regel met een **groen vinkje** ✓.
   Een rood kruisje ✗ betekent dat die versie niet goed was — neem dan de
   bovenste regel eronder die wél een groen vinkje heeft.
4. Scrol naar beneden naar het kopje **Artifacts**.
5. Klik op **ShowroomSuite-installer**. Er wordt een zip-bestand gedownload.
6. Open de map **Downloads**, klik met rechts op het zip-bestand en kies
   **Alles uitpakken**.
7. In de uitgepakte map staat `ShowroomSuite-Setup-0.1.0.exe`. Dat is het
   installatiebestand. Ga verder met stap 2.

> **Ziet u geen Artifacts staan?** Ze worden na veertien dagen opgeruimd. Klik
> dan rechtsboven op **Re-run all jobs**, wacht ongeveer tien minuten en
> ververs de pagina.

### Weg B — Zelf bouwen

Alleen nodig als weg A niet lukt. Dit doet u op de Windows-pc zelf.

1. Installeer **Node.js versie 22.13 of nieuwer** via <https://nodejs.org>
   (kies de knop "LTS"). Klik in het installatieprogramma steeds op Volgende.
2. Installeer **Git** via <https://git-scm.com/download/win>, ook met steeds
   Volgende.
3. Klik op Start, typ `powershell` en open **Windows PowerShell**.
4. Typ de onderstaande regels, één voor één, en druk na elke regel op Enter:

   ```powershell
   cd $HOME
   git clone https://github.com/patrickdekker82/KSOdashboard.git
   cd KSOdashboard
   npm ci
   npm run build:win
   ```

5. De laatste regel duurt een paar minuten. Als hij klaar is, staat het
   installatiebestand in de map `release`:
   `C:\Users\<uw naam>\KSOdashboard\release\ShowroomSuite-Setup-0.1.0.exe`.

---

## Stap 2 — Installeren

1. Dubbelklik op **ShowroomSuite-Setup-0.1.0.exe**.
2. Windows waarschuwt dat het een onbekende uitgever is. Klik op
   **Meer informatie** en daarna op **Toch uitvoeren**.

   > Dit komt doordat het bestand niet ondertekend is met een aangeschaft
   > certificaat. Het zegt niets over de veiligheid van het bestand zelf.

3. Laat de voorgestelde map staan en klik op **Installeren**.
4. Klik op **Voltooien**.

U heeft nu een snelkoppeling **Showroom Suite** op het bureaublad en in het
startmenu.

---

## Stap 3 — De eerste keer starten

1. Dubbelklik op **Showroom Suite**.
2. De eerste start duurt wat langer: de app maakt de database aan en zet vijf
   accounts klaar.
3. Log in met:

   | | |
   |---|---|
   | E-mailadres | `patrick@showroom.local` |
   | Wachtwoord | `Showroom2026!` |

4. De app laat u meteen niets anders zien dan het scherm om een **nieuw
   wachtwoord** te kiezen. Kies er een van minimaal twaalf tekens, met
   hoofdletters, kleine letters en een cijfer.

> **Waarom dit moet.** Dat beginwachtwoord staat in deze handleiding, dus het is
> geen wachtwoord. De app laat een account dat het nog heeft daarom nergens bij.

U bent nu binnen, als beheerder.

---

## Stap 4 — De andere accounts regelen

Er staan vijf accounts klaar, allemaal met hetzelfde beginwachtwoord.

| E-mailadres | Wie | Rol |
|---|---|---|
| `patrick@showroom.local` | Patrick Dekker | beheerder |
| `dennis@showroom.local` | Dennis van de Meeberg | medewerker |
| `robert@showroom.local` | Robert de Bergh | medewerker |
| `manager@showroom.local` | Marieke Manager | manager |
| `acquisitie@showroom.local` | Meekijker Acquisitie | meekijker |

Ga naar **Instellingen → Gebruikers & rollen** en doe twee dingen:

1. Pas de namen en e-mailadressen aan naar uw eigen collega's.
2. Zet accounts die u niet gebruikt op **gearchiveerd**. Verwijderen kan niet,
   en dat is met opzet: dan zou ook verdwijnen wie wat gedaan heeft.

Laat iedere collega daarna één keer inloggen met het beginwachtwoord. De app
dwingt hen zelf om een eigen wachtwoord te kiezen.

---

## Stap 5 — Collega's laten meekijken (optioneel)

Standaard draait de app alleen op deze ene pc. Wilt u dat collega's meekijken —
ook vanaf een telefoon — dan zet u de hostmodus aan.

1. Ga naar **Instellingen → Netwerk & updates**.
2. Zet de stand op **Host**.
3. Windows Firewall vraagt om toestemming. Vink **Particuliere netwerken** aan
   en **niet** Openbare netwerken. Klik op Toegang toestaan.
4. Het scherm toont nu een adres, bijvoorbeeld `http://192.168.1.42:4317`.
   Dat adres typt een collega in zijn browser. Meer is er niet: er is geen
   aparte installatie voor collega's.

Twee dingen om te weten:

- **Deze pc moet aan blijven staan.** De gegevens staan hier en nergens anders.
  Zet daarom in hetzelfde scherm **automatisch starten bij aanmelden** aan.
- **Inloggen blijft verplicht**, ook op het netwerk.

Op een telefoon kan het adres via "aan beginscherm toevoegen" als app worden
neergezet. Het menu wordt dan een lade en tabellen schuiven zijwaarts.

---

## Klaar? Loop dit lijstje na

- [ ] De app start met een dubbelklik op de snelkoppeling.
- [ ] U bent ingelogd met een **eigen** wachtwoord, niet het beginwachtwoord.
- [ ] Elke collega heeft één keer ingelogd en een eigen wachtwoord gekozen.
- [ ] Ongebruikte accounts staan op gearchiveerd.
- [ ] **Instellingen → Back-up & herstel**: één keer op *Nu een back-up maken*
      geklikt, en de back-up staat in het logboek.
- [ ] Bij **Extra doelmap (netwerkschijf)** staat een map op de netwerkschijf
      ingevuld. Kopieën mogen daar wél heen — de database zelf niet.

---

## Het allerbelangrijkste: niet op een netwerkschijf

Zet de gegevens **nooit** op een netwerkschijf (`\\server\...` of een letter
zoals `Z:`) en **nooit** in een map die synchroniseert met OneDrive, Dropbox of
Google Drive.

Die diensten kopiëren een bestand terwijl er nog naar geschreven wordt. Bij een
database levert dat beschadiging op, en dan bent u alles kwijt.

De app blokkeert dit zelf en legt het uit als u het toch probeert.
**Back-upkopieën** mogen er wel heen — dat is juist verstandig.

Wilt u dat collega's erbij kunnen? Gebruik de hostmodus uit stap 5, niet een
gedeelde map.

---

## Als er iets misgaat

| Wat u ziet | Wat u doet |
|---|---|
| Windows blokkeert het installatiebestand | **Meer informatie** → **Toch uitvoeren** |
| De app start niet | Pc opnieuw opstarten. Blijft het misgaan: stuur de map `logs\` naar de beheerder |
| "De kern kon niet starten" | De gegevensmap staat op een netwerkschijf of in een synchronisatiemap. De melding zegt welke; verplaats hem naar de lokale schijf |
| "De database is beschadigd" | **Instellingen → Back-up & herstel** → kies een back-up van vóór het probleem. De huidige database blijft bewaard onder een andere naam |
| Wachtwoord kwijt | Alleen een beheerder kan het opnieuw instellen |
| Collega kan het hostadres niet openen | Firewall: staat de poort open voor het *particuliere* netwerk? Staat de host-pc aan? |
| `npm ci` geeft een foutmelding over de Node-versie | U heeft een te oude Node.js. Installeer versie 22.13 of nieuwer |

---

## Waar de gegevens staan

Alles staat op deze pc, in `C:\Users\<uw naam>\AppData\Roaming\ShowroomSuite`:

| Map of bestand | Wat er in staat |
|---|---|
| `showroom.db` | de database met alle gegevens |
| `backups\` | de back-ups |
| `attachments\` | bijlagen bij klanten en projecten |
| `templates\` | uw eigen Word- en Excel-sjablonen |
| `logs\` | logboeken, handig bij een storing |
| `config.json` | instellingen van déze pc (netwerkstand, poort) |

---

## En daarna?

| Wilt u weten | Lees dan |
|---|---|
| hoe u dagelijks met de app werkt | `GEBRUIKERSHANDLEIDING.md` |
| hoe u gebruikers, back-ups en de AI-assistent beheert | `BEHEERDERSHANDLEIDING.md` |
| hoe u een nieuwe versie uitrolt | `INSTALLATIE.md`, kopje *Bijwerken* |
