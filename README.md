# Shelly-Aussenbeleuchtung_mit_Astrosteuerung_V2.1_ES5

> **Automatic exterior lighting control for Shelly Plus devices – based on astronomical events (sunrise, sunset, twilight).**  
> _Automatische Außenbeleuchtungssteuerung für Shelly Plus Geräte – basierend auf astronomischen Ereignissen (Sonnenaufgang, Sonnenuntergang, Dämmerung)._

---

## 🇬🇧 English Version

### Overview
This script automatically controls the exterior lighting of a **Shelly Plus** relay based on **astronomical events** such as sunrise, sunset, and twilight phases.  
Switching times are **dynamically calculated every day** according to your location and current solar times.

---

### ✨ Features
- Automatic on/off switching of the relay based on sunrise/sunset or twilight events  
- Configurable schedules for weekdays and weekends  
- Selectable astronomical reference points (`sunrise`, `sunset`, `civil_begin`, `civil_end`, etc.)  
- Guard logic to prevent unwanted switching in case of invalid or missing time data  
- Fallback behavior if the API request fails  
- Stores the last switching times and state in device memory  
- Fully **ES5-compatible** for Shelly Plus devices

---

### ⚙️ Configuration Options
| Option | Description |
|---------|-------------|
| **Location** | Latitude / Longitude for your installation |
| **Relay ID** | ID of the relay to control (default: 0) |
| **Reference events** | Morning / evening astronomical events |
| **Schedules** | Separate weekday / weekend plans |
| **Guards** | Safety checks against invalid API data |
| **Debug** | Enable detailed log output |

---

### ⚡ Note
> This script is designed for **Shelly Plus devices** and requires **internet access** to retrieve solar data from the API.

---

### 🚀 Setup Guide

#### 1️⃣ Open Shelly Web Interface
Connect your Shelly Plus device to your network and open its web interface in a browser.

#### 2️⃣ Go to *Scripts*
Navigate to **Scripts** in the device menu.

#### 3️⃣ Create a New Script
Click **Add Script**, give it a name (e.g. `Astrosteuerung`), and paste the complete content of  
`Shelly-Aussenbeleuchtung_mit_Astrosteuerung_V2.1_ES5.js` into the editor.

#### 4️⃣ Adjust Configuration
Modify the parameters inside the `CONFIG` object:
```js
CONFIG = {
  lat: 51.1183,
  lng: 9.5334,
  relayId: 0,
  debug: false
}
```
Optionally adjust schedules and twilight settings.

#### 5️⃣ Save and Enable
Save the script and toggle it **ON**.

#### 6️⃣ Test Functionality
- Check the *Output* or *Log* panel for messages (`debug: true` → more details).  
- Verify that the relay switches according to your configured schedule.

---

### 🧩 Requirements
- Shelly Plus device with scripting support (Gen2, e.g. Shelly Plus 1 / 1PM)  
- Internet access for the sunrise/sunset API

---

### 💡 Tip
If you change the configuration, **re-save and restart** the script to apply the updates.

---

## 🇩🇪 Deutsche Version

### Überblick
Dieses Skript steuert die **Außenbeleuchtung** eines **Shelly Plus**-Relais automatisch anhand von **astronomischen Ereignissen** wie Sonnenaufgang, Sonnenuntergang und Dämmerungsphasen.  
Die Schaltzeiten werden **täglich dynamisch berechnet** und an die aktuellen Sonnenzeiten angepasst.

---

### ✨ Funktionen
- Automatische Ein-/Ausschaltung des Relais nach Sonnenaufgang, Sonnenuntergang oder Dämmerung  
- Konfigurierbare Zeitpläne für **Werktage** und **Wochenenden**  
- Auswahl verschiedener astronomischer Referenzpunkte (`sunrise`, `sunset`, `civil_begin`, `civil_end` usw.)  
- **Schutzmechanismen (Guards)** verhindern ungewolltes Schalten bei fehlerhaften Zeitdaten  
- **Fallback-Logik** bei Ausfall der API  
- Speicherung der **letzten Schaltzeiten** und des Status im Gerätespeicher  
- **ES5-kompatibel** für Shelly Plus Geräte

---

### ⚙️ Konfiguration
| Parameter | Beschreibung |
|------------|--------------|
| **Standort** | Breitengrad / Längengrad |
| **Relais-ID** | ID des zu steuernden Relais (Standard: 0) |
| **Referenz-Ereignisse** | Astronomische Ereignisse für Morgen / Abend |
| **Zeitpläne** | Getrennte Pläne für Werktage und Wochenenden |
| **Guards** | Schutzmechanismen gegen ungültige API-Daten |
| **Debug-Modus** | Aktiviert detaillierte Log-Ausgaben |

---

### ⚡ Hinweis
> Das Skript ist für **Shelly Plus Geräte** vorgesehen und benötigt **Internetzugang**, um die Sonnenzeiten über die API abzufragen.

---

### 🚀 Installationsanleitung

#### 1️⃣ Shelly Webinterface öffnen
Gerät mit dem Netzwerk verbinden und das Webinterface im Browser öffnen.

#### 2️⃣ Menüpunkt *Scripts* aufrufen
Zum Abschnitt **Scripts** navigieren.

#### 3️⃣ Neues Skript erstellen
Auf **Add Script** klicken, einen Namen vergeben (z. B. `Astrosteuerung`) und den gesamten Inhalt von  
`Shelly-Aussenbeleuchtung_mit_Astrosteuerung_V2.1_ES5.js` in den Editor einfügen.

#### 4️⃣ Konfiguration anpassen
```js
CONFIG = {
  lat: 51.1183,
  lng: 9.5334,
  relayId: 0,
  debug: false
}
```
Optional: Relais-ID, Zeitpläne oder Dämmerungsoptionen anpassen.

#### 5️⃣ Speichern und aktivieren
Skript speichern und auf **„On“** schalten.

#### 6️⃣ Funktion testen
- Im Tab *Output* oder *Log* die Meldungen prüfen (`debug: true` → mehr Details).  
- Sicherstellen, dass das Relais gemäß Zeitplan schaltet.

---

### 🧩 Voraussetzungen
- Shelly Plus Gerät mit Script-Unterstützung (Gen2, z. B. Shelly Plus 1 / 1PM)  
- Internetzugang für die Sunrise/Sunset-API

---

### 💡 Tipp
Nach Änderungen an der Konfiguration das Skript **neu speichern und starten**, damit die Anpassungen aktiv werden.

---

© 2025 Shelly Astro Lighting Automation • Maintained by the Community
