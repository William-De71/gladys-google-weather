# Google Weather

## Überblick

Diese Integration macht die offizielle **Weather API der Google Maps Platform** zu einem Wetteranbieter von Gladys. Nach der Installation nutzen die Wetterkarte des Dashboards, der Chat-Assistent („Wie wird das Wetter morgen?“) und der Wetterwarnungs-Auslöser von Gladys sie anstelle des eingebauten OpenWeather-Dienstes.

Sie liefert:

- das **aktuelle Wetter**: Temperatur, gefühlte Temperatur, Luftfeuchtigkeit, Taupunkt, Luftdruck, Wind und Böen, Sichtweite, Bewölkung, UV-Index, Tag oder Nacht, Sonnenauf- und -untergang;
- die **Vorhersagen**: 24 Stunden und 8 Tage im Wetter von Gladys, bis zu 10 Tage im Widget;
- die von Google weitergegebenen **amtlichen öffentlichen Warnungen** (MeteoAlarm für den Großteil Europas, der DWD, die NOAA…), im Wetter von Gladys und in zwei Szenen-Auslösern;
- vier **Szenen-Aktionen** und drei **Dashboard-Widgets**.

Alles läuft über die Server von Google (nur Cloud), mit **deinem eigenen API-Schlüssel**: Google berechnet die Weather API oberhalb eines kostenlosen Monatskontingents, und die Integration ist darauf ausgelegt, deutlich darunter zu bleiben.

> Diese Integration wurde noch nicht mit einem echten API-Schlüssel getestet: Sie folgt der Dokumentation der API genau. Bitte melde jedes Problem.

## Voraussetzungen

- Gladys 5.1.1 oder neuer.
- Ein Zuhause mit Standort (Einstellungen → Zuhause): Die Warnungen werden für jedes Zuhause mit Standort geprüft.
- Ein Google-Konto und ein **Google-Cloud-Projekt mit Rechnungskonto**. Google verlangt es für die Weather API, auch im kostenlosen Rahmen.

## Konfiguration

### 1. Google-Cloud-Projekt und Weather API

1. Öffne die [Google-Cloud-Konsole](https://console.cloud.google.com/), lege ein Projekt an (oder wähle eines).
2. Verknüpfe ein Rechnungskonto (Abrechnung). Ohne Abrechnung wird jede Anfrage abgelehnt (`BILLING_DISABLED`).
3. Aktiviere die **Weather API** (APIs und Dienste → Bibliothek → „Weather API“).

Google bietet auch einen kostenlosen „Maps Demo Key“ zum Testen ohne Abrechnung an: Er ist nur für Prototypen gedacht.

### 2. API-Schlüssel und Einschränkungen

1. Google Maps Platform → Schlüssel und Anmeldedaten → **Anmeldedaten erstellen → API-Schlüssel**.
2. Schlüssel bearbeiten: Unter **API-Einschränkungen** „Schlüssel einschränken“ wählen und nur **Weather API** ankreuzen. Ein geleakter Schlüssel kann dann nicht für andere kostenpflichtige APIs genutzt werden.
3. Unter **Anwendungseinschränkungen** **IP-Adressen** wählen und die öffentliche IP deines Gladys eintragen, falls sie fest ist. Nicht „Websites“ verwenden: Die Anfragen kommen aus dem Container, nicht aus einem Browser.
4. Optional, aber empfohlen: Unter Google Maps Platform → Kontingente das Tageskontingent der Weather API senken (zum Beispiel 500 pro Tag) als zweites Sicherheitsnetz.

### 3. Kosten und Aktualisierungsintervalle

Google berechnet jede erfolgreiche Anfrage (alle Endpunkte zusammen, SKU „Weather Usage“) über **10.000 kostenlose Anfragen pro Monat** hinaus, danach 0,15 USD je 1.000 (Preise vom 17. Oktober 2026, siehe [Preisseite](https://developers.google.com/maps/documentation/weather/usage-and-billing)). Jedes Produkt wird höchstens einmal pro Intervall gelesen und von Dashboard, Widgets und Szenen geteilt:

| Produkt                      | Standardintervall   | Anfragen / Monat / Zuhause |
| ---------------------------- | ------------------- | -------------------------- |
| Aktuelles Wetter             | 30 min              | 1.488                      |
| Stündliche Vorhersage (24 h) | 60 min              | 744                        |
| Tagesvorhersage (10 Tage)    | 3 × stündlich = 3 h | 248                        |
| Warnungen                    | 30 min              | 1.488                      |
| **Summe (31 Tage)**          |                     | **3.968**                  |

Gladys prüft das Wetter für seinen eigenen Warnungs-Auslöser alle 30 Minuten: Kürzere Intervalle bringen wenig. Jede Dashboard-Sprache ist eine eigene Antwort: Zwei Sprachen verdoppeln die Kosten. Die **Monatliche Anfragegrenze** (standardmäßig 9.000) stoppt nach Erreichen jeden Aufruf an Google bis zum nächsten Monat; die letzten Antworten werden weiter geliefert, und der Verbindungsstatus zeigt es an.

### 4. In Gladys

1. Integrationen → Google Weather → Konfiguration.
2. Den **API-Schlüssel** einfügen, bei Bedarf die Intervalle anpassen, speichern.
3. Auf **API-Schlüssel testen** klicken: Es liest das aktuelle Wetter deines ersten Zuhauses (eine Anfrage) und zeigt die Anfragen dieses Monats und die Monatsschätzung.

| Feld                              | Standard | Zweck                                                           |
| --------------------------------- | -------- | --------------------------------------------------------------- |
| API-Schlüssel                     | —        | Dein Schlüssel (`AIza…`), als Geheimnis gespeichert             |
| Aktuelles Wetter alle (Min.)      | 30       | 10 bis 180                                                      |
| Stündliche Vorhersage alle (Min.) | 60       | 30 bis 360; die Tagesvorhersage wird dreimal seltener gelesen   |
| Amtliche Warnungen                | an       | Ausschalten, wo Google keine Warnungen veröffentlicht           |
| Warnungen alle (Min.)             | 30       | 10 bis 180: Verzögerung, bis eine Warnung deine Szenen erreicht |
| Monatliche Anfragegrenze          | 9.000    | Sicherheitsnetz                                                 |

## Verwendung

### Wetterkarte und Assistent

Nichts zu tun: Die Wetterkarte des Dashboards nutzt diesen Anbieter. Sind mehrere Wetteranbieter installiert, hefte einen in den Einstellungen der Karte an.

### Abdeckung, Deutschland und Europa

Aktuelles Wetter und Vorhersagen decken die meisten Länder ab, darunter Deutschland, Österreich, die Schweiz, Frankreich, Spanien und das übrige Europa. In China, Japan, Südkorea, Vietnam, Iran, Nordkorea, Kuba oder Syrien unter anderem sind sie nicht verfügbar: Die Anfrage schlägt dort fehl, und Gladys nutzt seinen nächsten Wetteranbieter.

Die Warnungen stammen über Google von den amtlichen Diensten: dem DWD für Deutschland, MeteoAlarm für die meisten europäischen Länder (für Frankreich die Vigilance von Météo-France). Kanada, Indien und Russland haben Wetter, aber keine Warnungen: Schalte sie dort aus, um ihre Anfragen zu sparen. Die MeteoAlarm-Farben entsprechen dem Schweregrad: gelb = mäßig, orange = schwer, rot = extrem. Titel und Texte der Warnungen sind in der Sprache des Herausgebers, wenn er die angefragte nicht liefert.

### Widgets

![Generierte Illustration der drei Widgets – Wetterwarnungen, 10-Tage-Vorhersage, nächste Stunden – kein Screenshot](https://raw.githubusercontent.com/William-De71/gladys-google-weather/main/docs/assets/widgets.de.png)

- **Wetterwarnungen**: Zähler nach Schweregrad, dann jede Warnung mit Gebiet, Ende, Verhaltenshinweisen und einem Link zum Herausgeber.
- **10-Tage-Vorhersage**: 5, 7 oder 10 Tage mit den Google-Symbolen, Höchst- und Tiefstwert, Himmel und Regenrisiko; tippe auf einen Tag für Details zu Tag und Nacht, UV-Index und Sonnenzeiten.
- **Nächste Stunden**: ein Verlauf der nächsten 12 oder 24 Stunden: Temperatur und gefühlte Temperatur, Regenrisiko oder Wind und Böen.

Jedes Widget hat die Einstellung **Zuhause** (der genaue Name eines Zuhauses, leer für das erste mit Standort).

### Szenen-Auslöser

- **Wetterwarnung ausgegeben**: Eine amtliche Warnung gilt jetzt für ein Zuhause. Filter: Zuhause, Art der Warnung (Gewitter, Wind, Starkregen, Hochwasser, Schnee / Glätte, Kälte, Hitze, Nebel, Küste / Meer, Brand / Dürre, Zyklon / Hurrikan, Tornado, Erdbeben / Vulkan, Luft / Strahlung, Sonstiges), Schweregrad. Variablen: Titel, Art, Schweregrad, Gebiet, Beginn, Ende, Beschreibung, Verhaltenshinweise, Quelle, Zusammenfassung…
- **Wetterwarnung beendet**: Die Warnung ist abgelaufen oder wurde aufgehoben.

Die erste Prüfung nach einem Start legt den Ausgangsstand fest: Bereits geltende Warnungen lösen nichts aus. Eine mit gleicher Art und gleichem Schweregrad neu ausgegebene Warnung löst nicht erneut aus; ein Wechsel des Schweregrads (gelb zu orange) beendet die alte und gibt die neue aus.

### Szenen-Aktionen

- **Wetterwarnungen abrufen**: Anzahl, schwerste Warnung (Titel, Art, Schweregrad, Ende, Verhaltenshinweise), Zusammenfassung.
- **Vorhersage eines Tages abrufen**: heute bis in 9 Tagen: Höchst- und Tiefstwert, Himmel, Regenrisiko und -menge, Wind, Böen, UV, Sonnenauf- und -untergang, Zusammenfassung.
- **Aktuelles Wetter abrufen**: Temperatur, gefühlte Temperatur, Luftfeuchtigkeit, Luftdruck, Wind, UV, Bewölkung, Himmel, Zusammenfassung.
- **Wird es regnen?**: innerhalb von 3 bis 24 Stunden, ab einem gewählten Risiko: ja oder nein, ab wann, maximales Risiko, Gesamtmenge, Zusammenfassung.

### Szenenbeispiele

- Wenn eine **Wetterwarnung ausgegeben** wird mit der Art „Wind“ und dem Schweregrad „Schwer“ oder „Extrem“ → die Rollläden schließen und `{{triggerEvent.data.summary}}` an dein Handy senden.
- Jeden Morgen um 7:00 → **Vorhersage eines Tages abrufen** (heute) → ihre Zusammenfassung als Nachricht senden.
- Jeden Abend um 20:00 → **Wird es regnen?** (12 Stunden, ab 50 %) → wenn kein Regen erwartet wird, die Gartenbewässerung starten.

## Fehlerbehebung

- **„Google hat den API-Schlüssel abgelehnt (API_KEY_INVALID)“**: Der Schlüssel ist falsch oder gelöscht; kopiere ihn erneut aus der Konsole.
- **SERVICE_DISABLED**: Die Weather API ist im Projekt des Schlüssels nicht aktiviert.
- **BILLING_DISABLED**: Mit dem Projekt ist kein Rechnungskonto verknüpft.
- **API_KEY_SERVICE_BLOCKED** oder **API_KEY_IP_ADDRESS_BLOCKED**: Die Einschränkungen des Schlüssels schließen die Weather API oder die IP deines Gladys aus (sie hat sich vielleicht geändert).
- **Nie eine Warnung**: Prüfe oben die Abdeckung deines Landes; das Warnungs-Widget zeigt an, wenn sie ausgeschaltet sind.
- **„Monatsbudget erreicht“**: Grenze oder Intervalle erhöhen; der Zähler beginnt am 1. des Monats (UTC) neu. Maßgeblich sind die Zahlen von Google (Google Maps Platform → Messwerte).
- **Kein Wetter für ein Zuhause**: Es liegt außerhalb der Abdeckung oder hat in Gladys keinen Standort.
- Logs: Einstellungen → Supervision → Google Weather. Der Schlüssel erscheint dort nie.
