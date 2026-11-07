# Рекламный ролик Кадра
- `kadr-promo.mp4` — готовый ролик 1080×1920, 15 с.
- `promo.html` — анимация (canvas), `render.js` — рендер кадров через Playwright, `music.wav` — фоновая музыка.

Пересборка:
```
node render.js full
ffmpeg -framerate 30 -i frames/f%04d.jpg -i music.wav -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -shortest kadr-promo.mp4
```
