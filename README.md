# 🎮 AirPad

Darmowa konsola w przeglądarce — **telefon jako kontroler**, duży ekran jako konsola.
Odpowiednik AirConsole, ale **bez płatności, bez limitów czasu, bez konta i bez reklam**.

## Jak grać
1. Otwórz `index.html` (albo stronę na GitHub Pages / Vercel) na komputerze, laptopie lub TV.
2. Kliknij **Uruchom konsolę** — pojawi się kod QR i 4-cyfrowy kod.
3. Na telefonie zeskanuj QR (lub wejdź na `.../pad.html` i wpisz kod) + nick.
4. Wybierzcie grę na dużym ekranie i grajcie. Do 8 graczy jednocześnie.

## Gry (3D, Three.js)
| Gra | Opis | Gracze |
|---|---|---|
| 🏎️ Turbo Kart | Wyścig na 3 okrążenia z boostem i driftem | 1–8 |
| 💥 Tank Arena | Deathmatch czołgów, 15 fragów | 1–8 |
| 🥏 Sumo Balls | Wypychanie z kurczącej się areny, 5 rund | 2–8 |
| 🪙 Coin Rush | Zbieranie monet w 90 s, omijanie bomb | 1–8 |
| 🚀 Space Dogfight | Kosmiczna walka myśliwców | 1–8 |
| 🏍️ Neon Trails | Świetlne motory w stylu Tron, 5 rund | 2–8 |

## Technologia
- **Three.js** (ES modules z CDN) — grafika 3D
- **PeerJS / WebRTC** — bezpośrednie połączenie telefon ↔ ekran (niskie opóźnienie, bez własnego serwera)
- Czysty statyczny HTML/CSS/JS — **nic nie trzeba budować ani instalować**

## Hosting
Strona jest w 100% statyczna:
- **GitHub Pages**: Settings → Pages → Deploy from branch → `/ (root)`.
- **Vercel**: import repo, framework „Other”, brak build command, output = katalog główny.

> Uwaga: strona musi działać po **HTTPS** (Pages/Vercel to zapewniają), żeby WebRTC i wibracje działały na telefonie.

## Dodawanie własnej gry
Utwórz `js/games/mojagra.js` eksportujący `meta` i `start(ctx)` (wzór: `js/games/sumo.js`),
a następnie dopisz import w `js/games/index.js`.
