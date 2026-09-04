# Showroom Suite installeren

Deze handleiding is voor wie de app installeert. U hoeft geen verstand van
computers te hebben; volg de stappen van boven naar beneden.

## Wat u nodig heeft

- Een Windows-pc (64-bit).
- Ongeveer 400 MB vrije schijfruimte.
- **Geen** beheerdersrechten. De app installeert zich voor uw eigen account.

## Installeren

1. Dubbelklik op `ShowroomSuite-Setup-0.1.0.exe`.
2. Windows kan waarschuwen dat het een onbekende uitgever is. Klik op
   **Meer informatie** en daarna op **Toch uitvoeren**. Dat komt doordat het
   installatiebestand niet ondertekend is met een aangeschaft certificaat; het
   zegt niets over de veiligheid van het bestand zelf.
3. Kies waar de app komt te staan, of laat de voorgestelde map staan.
4. Klik op **Installeren** en daarna op **Voltooien**.

U heeft nu een snelkoppeling op het bureaublad en in het startmenu.

## De eerste keer starten

1. Dubbelklik op **Showroom Suite**.
2. Log in met het e-mailadres en wachtwoord dat u van de beheerder heeft
   gekregen.
3. De app vraagt om een nieuw wachtwoord. Kies er een van minimaal twaalf
   tekens, met hoofdletters, kleine letters en een cijfer.

Klaar. Alles wat u invoert staat op deze pc, in de map
`C:\Users\<uw naam>\AppData\Roaming\ShowroomSuite`.

## Waar de gegevens staan

| Map | Wat er in staat |
|---|---|
| `showroom.db` | de database met alle gegevens |
| `backups\` | automatische back-ups |
| `attachments\` | bijlagen bij klanten en projecten |
| `templates\` | uw eigen Word- en Excel-sjablonen |
| `logs\` | logboeken, handig bij een storing |

## Belangrijk: niet op een netwerkschijf

Zet de database **nooit** op een netwerkschijf (`\\server\...` of een
toegewezen letter zoals `Z:`) en **nooit** in een map die synchroniseert met
OneDrive, Dropbox of Google Drive.

De reden: die diensten kopiëren een bestand terwijl er nog naar geschreven
wordt. Bij een database levert dat beschadiging op, en dan bent u alles kwijt.

De app blokkeert dit zelf en legt het uit als u het toch probeert.
Back-upkopieën mogen er wel heen — dat is juist verstandig.

Wilt u dat collega's meekijken? Gebruik dan de hostmodus (zie de
beheerdershandleiding) in plaats van een gedeelde map.

## Als er iets misgaat

**De app start niet.** Start de pc opnieuw op en probeer het nog eens. Blijft
het misgaan, stuur dan de map `logs\` naar de beheerder.

**"De kern kon niet starten".** De app kan de database niet openen. Meestal
staat die op een netwerkschijf of in een synchronisatiemap; de melding zegt
welke. Verplaats de map naar de lokale schijf.

**"De database is beschadigd".** Ga naar Instellingen → Back-up & herstel en
kies een back-up van vóór het probleem. De huidige database wordt daarbij
bewaard onder een andere naam, dus u raakt niets kwijt door het te proberen.

**Ik ben mijn wachtwoord kwijt.** Alleen een beheerder kan het opnieuw
instellen.

## Bijwerken

Als er een nieuwe versie is, meldt de app dat bij het opstarten. De update
wordt geïnstalleerd zodra u de app afsluit. U hoeft niets te doen en u raakt
geen gegevens kwijt.
