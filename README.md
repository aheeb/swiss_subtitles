# Schweizerdeutsch Subtitle Editor (Web App)

## Projektziel

Eine Web-Anwendung zur Erstellung und Bearbeitung von Video-Untertiteln, mit einem Fokus auf zuverlässige Transkription von Schweizerdeutsch mittels Whisper. Die Anwendung soll eine intuitive, "CapCut-ähnliche" Editor-Experience bieten, bei der Untertitel direkt auf dem Video platziert, gestylt und zeitlich angepasst werden können. Ziel ist es, eine kostengünstige und benutzerfreundliche Alternative zu bestehenden Tools für Content Creators (insb. auf Plattformen wie TikTok) zu schaffen.

## Key Features (Geplant)

*   Video-Upload und -Verwaltung
*   Automatische Transkription via externem Whisper-Service (optimiert für Dialekte)
*   Interaktive Untertitel-Bearbeitung:
    *   Visuelles Platzieren/Verschieben/Skalieren direkt auf der Video-Vorschau
    *   Anpassung von Start-/Endzeiten über eine Timeline-Ansicht
    *   Styling-Optionen (Schriftart, Größe, Farbe, Hintergrund, Position, etc.)
*   Undo/Redo-Funktionalität
*   Client-seitige Vorschau des gerenderten Videos (mit `ffmpeg.wasm`)
*   Server-seitiger Export des finalen Videos mit eingebrannten Untertiteln
*   Benutzerkonten und Projekt-Speicherung

## Tech Stack

*   **Core Framework:** [Next.js](https://nextjs.org/) (v14+, App Router empfohlen) mit [React](https://reactjs.org/) & [TypeScript](https://www.typescriptlang.org/)
*   **API Layer:** [tRPC](https://trpc.io/) (für typsichere Kommunikation zwischen Frontend und Next.js Backend)
*   **State Management:** [Zustand](https://github.com/pmndrs/zustand) (mit `immer` Middleware für einfache immutable Updates und ggf. History-Middleware für Undo/Redo)
*   **Video Overlay & Interaktion:** [react-konva](https://github.com/konvajs/react-konva) (zum Zeichnen und Manipulieren der Untertitel auf einem Canvas über dem Video)
*   **Timeline UI:** Eine React-Timeline-Bibliothek (z.B. `react-timeline-editor`, `vis-timeline`, oder Eigenbau - muss evaluiert werden)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **UI Komponenten:** [Radix UI Primitives](https://www.radix-ui.com/) (für zugängliche Basiskomponenten wie Dropdowns, Slider etc.)
*   **Video Player:** Standard HTML5 `<video>` Element (ggf. mit [Video.js](https://videojs.com/) für erweiterte Steuerung/Kompatibilität)
*   **Whisper Transkription:** **Externer Service**
    *   Technologie: Python ([FastAPI](https://fastapi.tiangolo.com/)) + OpenAI Whisper Model
    *   Hosting: Cloud-Plattform mit GPU-Zugriff (z.B. [Replicate](https://replicate.com/), [Modal Labs](https://modal.com/), Google Cloud Run/VM, AWS EC2/SageMaker)
*   **Video Rendering (Final):** **Externer Service**
    *   Technologie: Node.js + [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) (Wrapper für `ffmpeg`) + `libass` (für Untertitel-Rendering)
    *   Hosting: Serverless Function (mit erhöhten Limits), Container Service, VM oder Job Queue (z.B. AWS Lambda, Google Cloud Run, Render.com Background Worker)
*   **Client-Side Preview Rendering:** [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) (läuft im Browser in einem Web Worker)
*   **Datenbank:** [PostgreSQL](https://www.postgresql.org/) (z.B. via [Supabase](https://supabase.com/), Neon, Railway, Aiven)
*   **ORM:** [Prisma](https://www.prisma.io/)
*   **File Storage:** Cloud Storage (z.B. [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/), [AWS S3](https://aws.amazon.com/s3/), [Google Cloud Storage](https://cloud.google.com/storage))
*   **Authentication:** z.B. [Supabase Auth](https://supabase.com/docs/guides/auth), [NextAuth.js](https://next-auth.js.org/)
*   **Deployment:**
    *   Next.js App: [Vercel](https://vercel.com/), [Netlify](https://www.netlify.com/), [Railway](https://railway.app/)
    *   Externe Services: Je nach Wahl (siehe oben)

## Getting Started (Lokale Entwicklung)

1.  **Repository klonen:**
    ```bash
    git clone <your-repo-url>
    cd <your-repo-name>
    ```
2.  **Abhängigkeiten installieren:**
    ```bash
    npm install
    # oder
    yarn install
    # oder
    pnpm install
    ```
3.  **Umgebungsvariablen einrichten:**
    *   Kopiere `.env.example` zu `.env.local`.
    *   Trage die notwendigen Werte ein (Datenbank-URL, Cloud Storage Keys, URLs/API-Keys für externe Whisper/Render-Services, Auth-Secrets etc.).
4.  **Datenbank-Migration (falls Prisma verwendet wird):**
    ```bash
    npx prisma migrate dev
    ```
5.  **Entwicklungsserver starten:**
    ```bash
    npm run dev
    # oder
    yarn dev
    # oder
    pnpm dev
    ```
6.  Öffne [http://localhost:3000](http://localhost:3000) in deinem Browser.

## Vorgeschlagener Entwicklungsansatz (Roadmap)

Dies ist ein möglicher Weg, das Projekt schrittweise aufzubauen:

1.  **Phase 1: Grundstruktur & Core UI**
    *   Next.js Projekt initialisieren (App Router, TypeScript).
    *   tRPC Boilerplate einrichten.
    *   Minimalen Zustand Store aufsetzen.
    *   Video-Player-Komponente erstellen (lädt ein Testvideo).
    *   `react-konva` Stage über dem Video integrieren.
    *   Eine einfache Timeline-Komponente einbinden.
    *   *Ziel:* Video spielt, man sieht eine Konva-Fläche und eine Timeline.

2.  **Phase 2: Untertitel-Daten & Synchronisation**
    *   Datenstruktur für Untertitel definieren (ID, Text, Start, Ende, Style-Objekt, Position x/y).
    *   Store mit Mock-Untertiteln befüllen.
    *   Konva: `Text`-Nodes basierend auf den Untertiteln im Store rendern. Sichtbarkeit anhand von `video.currentTime` und `requestVideoFrameCallback` steuern.
    *   Timeline: Clips basierend auf den Untertiteln im Store rendern.
    *   Interaktion I: Drag & Drop auf Konva implementieren -> aktualisiert x/y im Zustand Store.
    *   Interaktion II: Drag & Resize auf Timeline implementieren -> aktualisiert Start/Ende im Zustand Store.
    *   *Ziel:* Mock-Untertitel erscheinen/verschwinden synchron zum Video, können auf dem Video und in der Timeline verschoben/verändert werden.

3.  **Phase 3: Styling & UX-Verbesserungen**
    *   Style-Sidebar mit Steuerelementen (Radix UI, Tailwind) bauen (Font-Picker, Color-Picker, Size-Slider etc.).
    *   Zustand Store erweitern, um den ausgewählten Untertitel zu verfolgen.
    *   Style-Änderungen in der Sidebar sollen den Zustand aktualisieren.
    *   Konva-Nodes sollen die Styles aus dem Zustand live übernehmen.
    *   Undo/Redo mit Zustand Middleware implementieren.
    *   UX-Details hinzufügen: Snapping in der Timeline/Konva, visuelles Feedback bei Auswahl.
    *   *Ziel:* Untertitel können gestylt werden, Änderungen sind live sichtbar, Undo/Redo funktioniert.

4.  **Phase 4: Whisper-Integration**
    *   Externen Python/FastAPI Whisper Service aufsetzen (oder einen fertigen Dienst wie Replicate nutzen).
    *   Video-Upload implementieren:
        *   tRPC-Prozedur, die eine Pre-signed URL für Cloud Storage generiert.
        *   Frontend lädt Video direkt zum Storage hoch.
    *   tRPC-Prozedur erstellen, die den Whisper-Service mit der Video-URL/ID aufruft.
    *   Polling oder Webhook-Mechanismus, um das Transkriptionsergebnis (JSON mit Text und Timestamps) zu erhalten.
    *   Erhaltene Untertiteldaten in den Zustand Store laden.
    *   *Ziel:* Ein Video kann hochgeladen und transkribiert werden, die Ergebnisse erscheinen im Editor.

5.  **Phase 5: Rendering (Preview & Final)**
    *   **Client-Preview:**
        *   `ffmpeg.wasm` in einen Web Worker integrieren.
        *   Funktion/tRPC-Prozedur, die den aktuellen Untertitel-Zustand als ASS/SRT-Datei formatiert.
        *   Worker aufrufen, um Video + Untertiteldatei zu einem Preview-Video (Blob) zu rendern.
    *   **Server-Final Render:**
        *   Externen Node.js/FFmpeg Rendering Service aufsetzen.
        *   tRPC-Prozedur, die den Render-Service mit Video-URL/ID und Untertiteldaten/ASS-Datei aufruft.
        *   Job-Status verfolgen und finale Video-URL zurückgeben.
    *   *Ziel:* Nutzer können eine schnelle Vorschau und ein finales Video mit eingebrannten Untertiteln generieren.

6.  **Phase 6: Persistenz, Auth & Deployment**
    *   Datenbank-Schema (Prisma) für User, Projekte, Untertitel definieren.
    *   tRPC-Prozeduren für CRUD-Operationen (Create, Read, Update, Delete) für Projekte implementieren.
    *   Authentifizierung (z.B. Supabase Auth) integrieren.
    *   Speichern/Laden von Projekten implementieren.
    *   Deployment-Pipelines für Next.js App und externe Services einrichten.
    *   *Ziel:* Nutzer können sich anmelden, ihre Arbeit speichern/laden, die Anwendung ist live verfügbar.

---

Viel Erfolg beim Entwickeln!