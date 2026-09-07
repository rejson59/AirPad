# 🎮 AirPad

**Darmowa konsola w przeglądarce** — telefon jako kontroler, duży ekran jako konsola.
Alternatywa dla AirConsole: **bez płatności, bez limitów czasu, bez konta, bez reklam.**

![style](https://img.shields.io/badge/theme-black%20%2B%20amber-ff9a1f) ![games](https://img.shields.io/badge/gry-13-ffd24a) ![no build](https://img.shields.io/badge/build-none-8ce05a)

## Jak grać
1. Otwórz stronę na komputerze / laptopie / Smart TV → **Uruchom konsolę**.
2. Na telefonie zeskanuj kod QR (lub wejdź na `.../pad.html` i wpisz 4-cyfrowy kod).
3. Wpisz nick, wybierzcie grę na dużym ekranie i grajcie. Do **8 graczy** naraz.

## Biblioteka gier (13, wszystkie 3D / Three.js)
| Gra | Opis | Gracze |
|---|---|---|
| 🏎️ Turbo Kart | Nocny tor, drift, boost pady, skrzynki (turbo / olej / rakieta) | 1–8 |
| ⚽ Rocket Soccer | Piłka nożna autami, 2 drużyny, do 5 goli | 2–8 |
| 🗼 Tower Climb | Platformówka — wyścig na szczyt wieży, podwójny skok i dash | 1–8 |
| 💣 Bomb Blitz | Labirynt, bomby, skrzynki i power-upy, 5 rund | 2–8 |
| 🧠 Quiz Party | Teleturniej — 12 pytań, punkty za szybkość, 4 kolorowe przyciski na padzie | 1–8 |
| 🕳️ Hole Hunger | Jesteś dziurą — połykaj ludzi, auta i budynki, rośnij | 1–8 |
| 🎨 Splat Wars | Zamaluj jak najwięcej terenu w 90 s + bomby farby | 1–8 |
| 🐍 Snake Royale | Węże 3D w arenie — rośnij i tnij przeciwników | 1–8 |
| 🛡️ Tank Arena | Deathmatch czołgów do 15 fragów | 1–8 |
| 🚀 Space Dogfight | Kosmiczne myśliwce, asteroidy, boost | 1–8 |
| 🏍️ Neon Trails | Świetlne motory w stylu Tron, 5 rund | 2–8 |
| 🥏 Sumo Balls | Wypychanie z kurczącej się areny, dash i skok | 2–8 |
| 🪙 Coin Rush | Zbieranie monet w 90 s, platformy i bomby | 1–8 |

> Wszystkie gry to **autorskie implementacje** inspirowane klasykami gatunku — nie zawierają cudzego kodu ani zasobów, więc projekt można bezpiecznie publikować.

## Funkcje
- **Adaptacyjne kontrolery** — każda gra deklaruje własny układ pada (analog + przyciski albo siatka odpowiedzi w quizie).
- **Wibracje (rumble)** przy trafieniach, zbiórkach i wybuchach.
- **Mini-HUD na telefonie** — HP, punkty, okrążenia, bomby, pasek boostu, czas.
- **Kategorie i filtry** w bibliotece gier.
- **Fallback klawiatury** — na desktopie można grać strzałkami / WASD + spacja (`pad.html` w drugiej karcie).
- Motyw wizualny: **czerń + gradient pomarańcz–żółć**, skeuomorficzne panele, wciskane przyciski i fizyczny analog.

## Technologia
- **Three.js** r160 (lokalnie w `vendor/`) — grafika 3D
- **WebRTC** dwoma ścieżkami naraz: natywne DataChannel + sygnalizacja ntfy.sh **oraz** PeerJS (0.peerjs.com) z TURN `*.turn.peerjs.com`
- Czysty, statyczny HTML/CSS/JS — **brak kroku budowania**

> Telefon **nie musi** być w tej samej sieci Wi‑Fi co konsola. Jeśli kiedyś widziałeś „Brak odpowiedzi — sprawdź kod”, to stary build nadpisywał działający TURN martwym OpenRelay.

## Hosting
- **GitHub Pages**: Settings → Pages → Deploy from branch → `/ (root)` (jest już `.nojekyll`).
- **Vercel**: import repo, framework „Other”, brak build command, output = katalog główny.

Strona musi działać po **HTTPS** (Pages/Vercel to zapewniają), aby WebRTC i wibracje działały na telefonie.

## Dodawanie własnej gry
Utwórz `js/games/mojagra.js` eksportujący `meta` (id, title, tagline, color, tag, min, max, controls)
oraz `start(ctx)` zwracający `{ update(dt), dispose() }` — wzór: `js/games/sumo.js`.
Następnie dopisz import w `js/games/index.js`.

## Zależności lokalne (vendor/)
Three.js, PeerJS i QRCode.js są **dołączone lokalnie** w katalogu `vendor/` (≈770 KB) i mapowane przez
`<script type="importmap">`. Dzięki temu strona działa nawet gdy CDN-y są niedostępne lub zablokowane
(sieci firmowe, szkolne, blokery) i nie ma zewnętrznych zależności przy hostowaniu.
