<p align="center"><img src="assets/logo.svg" width="72" alt="proofkit logo"></p>

<h1 align="center">proofkit</h1>

<p align="center"><b>Плагин, который заставляет ИИ-агента проверять свою работу так, как это сделал бы придирчивый пользователь.</b><br>
Запустить, прокликать, сыграть, сравнить с референсом, честно отчитаться и только потом сказать «готово».</p>

<p align="center">
Antigravity 2.0 · agy CLI · Claude Code · Codex CLI · OpenCode · Gemini CLI
</p>

> **English, in short:** proofkit is a plugin/skill pack that makes coding agents (built and tuned on Gemini 3.8 Flash
> in Google Antigravity) actually run and verify what they build: a real-browser UI probe with scenarios and
> screenshots, game playtesting (held keys, filmstrips, fps, 3D telemetry), visual before/after diffs, Blender
> renders and rig checks, a real Minecraft test server with a bot, an independent reviewer subagent, task sizing
> (fast path for small fixes), an automatic project map, and a design-quality skill against generic "AI slop" UIs.
> Install: `git clone … && node install.mjs`. See the sections below for other agents.

---

## Зачем

ИИ-агенты (особенно быстрые модели вроде Gemini Flash) умеют писать хороший код, но часто **не проверяют его**:
сдают плеер с мёртвыми кнопками, игру, в которой у самолёта отрываются рули, или чинят баг в две строки 45 минут
и 80 строками кода. proofkit добавляет агенту то, чего ему не хватает: правила, инструменты, чтобы **видеть**
результат, и шлагбаум, который не даёт закончить без доказательств.

## Что умеет

| | |
|---|---|
| 🧭 **Карта проекта** | В существующем проекте агент один раз разбирается, что это за продукт, и пишет `.proof/project-map.md` (экраны → файлы, общие компоненты, дизайн-система, команды, что нельзя трогать). Карта подкладывается в каждую следующую задачу автоматически. |
| 📏 **Размер задачи S / M / L** | Мелкий фикс: быстрый путь (нативное решение, бюджет ~20 строк, без лишних файлов). Средняя задача: проверка изменения и задетых экранов. Большая: полный цикл с независимым ревьюером. |
| 🖱️ **Браузерная проба** `ui_probe.mjs` | Открывает приложение в настоящем Edge/Chrome на нескольких экранах (есть пресеты iPad/телефон с сенсорным вводом), ловит JS-ошибки, 404, вылезание за экран, перекрытые/обрезанные кнопки и текст, плохой контраст, мёртвые кнопки; гоняет сценарии (клики, ввод, файлы, перетаскивание, проверки) и делает скриншоты. |
| 🎮 **Игры** | Зажатые клавиши, руление мышью, раскадровки (filmstrip), FPS на реальной видеокарте, автоматическая 3D-телеметрия (что видит камера, NaN, завис ли рендер), тест «новичок не проигрывает за 30 секунд», запрет «подстроенных» проверок. |
| 🎨 **Дизайн** `design-quality` | В существующем проекте — сохранить дизайн-систему и доказать скриншотами «до/после» (`visual_diff.mjs` игнорирует просто сдвинувшийся контент), что больше ничего не поменялось. В новом — уровень продукта 2026 года, список «нейрослопа», обязательная самооценка. |
| 🗺️ **Обход всех экранов** `route_tour.mjs` | Снимает каждый экран приложения (с проходом через вход/гостевой режим) до и после большой правки — тема, редизайн, обновление; вместе с `visual_diff` видно, какой экран изменился или сломался. |
| 🖼️ **Иконки** `icon_check.mjs` | Иконка в размерах 16–256 на светлом и тёмном, в панели задач, во вкладке браузера и на домашнем экране iPad + сколько деталей остаётся в 16/32 px; экспорт `.ico`, iOS 1024, favicon, PWA. |
| 📋 **План и уроки** | Большие задачи идут по плану с вехами (`.proof/plan.md`, сначала один экран целиком); замечания пользователя и ревьюера записываются в `.proof/lessons.md` и подкладываются в следующие задачи. |
| 🧊 **3D / Blender** | Рендер модели с 4 ракурсов, сравнение с референсом, проверка шарниров: движущиеся детали (элероны, колёса, двери) вращаются на месте, а не улетают. |
| ⛏️ **Minecraft** | Настоящий сервер Paper + бот-игрок: команды, GUI-меню, инвентарь, перезаход и перезапуск сервера. |
| 🕵️ **Независимый ревьюер** | Субагент `playtester` сам запускает результат, «играет», судит дизайн и пишет вердикт PASS/FAIL. Только реальный ввод, упавшая проверка = дефект. |
| 🚧 **Шлагбаум** | Агент не может закончить, если менял код, но нет свежего `.proof/report.md`, если не открыл свои скриншоты, если «мелкий фикс» разросся без объяснения или нет карты проекта. |
| 🧰 **Любые другие задачи** | Универсальный метод: «момент истины» пользователя → планка качества → как наблюдать результат (рендер, спектрограмма, грязные входные данные, фейковый пользователь) → свой маленький тестовый стенд, если инструмента нет. |

В каждом проекте агент оставляет папку `.proof/`: карту проекта, чек-лист, сценарии, скриншоты и `report.md`
с тем, что проверено и чем доказано.

## Поддержка агентов

| Агент | Что работает | Установка |
|---|---|---|
| **Google Antigravity 2.0 / agy CLI** | **всё**: правила, скиллы, хуки (шлагбаум, карта проекта, починка команд), субагент-ревьюер | `node install.mjs` |
| **Claude Code** | скиллы + инструменты; правила по желанию (`--rules` → `~/.claude/CLAUDE.md`) | `node install.mjs --agent claude` |
| **Codex CLI** | скиллы + инструменты; правила по желанию (`~/.codex/AGENTS.md`) | `node install.mjs --agent agents` |
| **OpenCode** | скиллы + инструменты; правила по желанию (`~/.config/opencode/AGENTS.md`) | `node install.mjs --agent agents` |
| **Gemini CLI** | скиллы + инструменты; правила по желанию (`~/.gemini/GEMINI.md`) | `node install.mjs --agent agents` |

Скиллы — открытый формат `SKILL.md`: Codex, OpenCode и Gemini CLI читают общую папку `~/.agents/skills`,
Claude Code — `~/.claude/skills`. Инструменты (`ui_probe`, `visual_diff`, `compare`, Blender- и Minecraft-скрипты) —
обычные Node/Python-скрипты и работают с любым агентом. **Хуки и субагент написаны в формате Antigravity**: в других
агентах шлагбаума нет, а ревьюера можно попросить словами («проверь результат как независимый тестировщик по
`agents/playtester.md`») или перенести файл в папку агентов своего инструмента (у Claude Code — `~/.claude/agents/`,
поменяв названия инструментов).

## Установка

**Нужно:** [Node.js](https://nodejs.org) 18+ и установленный Microsoft Edge или Google Chrome (браузер не скачивается).
По желанию: [Blender](https://www.blender.org) 4+ в `PATH` (3D), Java 21 (Minecraft), `ffmpeg` (видео/звук), Python 3.

```bash
git clone https://github.com/vanaedynak/proofkit.git
cd proofkit
node install.mjs                       # Antigravity 2.0 / agy CLI
```

Другие агенты:

```bash
node install.mjs --agent claude        # Claude Code
node install.mjs --agent agents        # Codex CLI, OpenCode, Gemini CLI
node install.mjs --agent all --rules   # всё сразу + добавить правила в глобальные файлы инструкций
```

Дополнительно:

```bash
node install.mjs --with-minecraft      # скачать тестовый сервер Paper 1.21.11 + бота (~150 МБ)
node install.mjs --dry-run             # только показать, что будет сделано
node install.mjs --dir D:/my/plugins/proofkit   # своя папка для плагина Antigravity
```

После установки **перезапусти Antigravity** (или открой новый терминал для CLI). Проверить: в Antigravity →
Customizations должен быть включён плагин `proofkit`, или `agy plugin list`.

Куда что ставится:

- Antigravity: `~/.gemini/config/plugins/proofkit/` (на Windows `C:\Users\<ты>\.gemini\config\plugins\proofkit\`)
- Claude Code: `~/.claude/skills/<skill>/`
- Codex / OpenCode / Gemini CLI: `~/.agents/skills/<skill>/`
- Minecraft-инструменты: `~/.proofkit-tools/mc/` (или путь из переменной `PROOFKIT_MC_TOOLS`)

Правила (`--rules`) добавляются в файл инструкций в блоке `<!-- proofkit:start --> … <!-- proofkit:end -->`;
повторная установка заменяет только этот блок.

### Обновление

```bash
cd proofkit
git pull
node install.mjs        # с теми же флагами, что и в первый раз
```

### Удаление

- Antigravity: удалить папку `~/.gemini/config/plugins/proofkit` (или `agy plugin disable proofkit`).
- Скиллы: удалить папки `proof-verify`, `design-quality`, `systematic-debugging`, `test-driven-development`
  из `~/.claude/skills` / `~/.agents/skills`.
- Правила: удалить блок `proofkit:start … proofkit:end` из файла инструкций.

## Как пользоваться

Ничего специально делать не нужно — просто давай задачи как обычно: «почини, что в читалке не скрывается
строка состояния», «сделай 3D-модель по reference.png в Blender», «добавь в статистику переключатель периода».
Агент сам определит размер задачи, прочитает или составит карту проекта, задаст вопросы, если от ответа зависит
результат, проверит и отчитается.

Инструменты можно запускать и вручную (пути — внутри установленной папки `skills/proof-verify/scripts/`):

```bash
# проверить веб-интерфейс: ошибки, вёрстка на 3 экранах, все кнопки
node ui_probe.mjs --dir . --click-all
node ui_probe.mjs --url http://localhost:5173 --steps .proof/steps.json

# все экраны приложения до/после большой правки (hash-роутер, проход через гостевой режим)
node route_tour.mjs --url http://localhost:5173 --routes .proof/routes.txt --hash --setup setup.json --viewports 1440x900,ipad --out .proof/tour/before

# иконка: лист в реальных размерах + экспорт всех форматов
node icon_check.mjs logo.svg --export build/icons --ios-bg "#0b1220"

# что изменилось в дизайне между двумя наборами скриншотов
node ui_probe.mjs --url http://localhost:5173 --freeze --out .proof/before
node ui_probe.mjs --url http://localhost:5173 --freeze --out .proof/after
node visual_diff.mjs .proof/before .proof/after

# сравнить результат с референсом (сайт, 3D-рендер)
node compare.mjs reference.png .proof/ui/shot-1440x900.png

# 3D: рендер с 4 сторон и проверка шарниров
blender -b model.blend -P blender_turnaround.py -- --out .proof/render
blender -b model.blend -P blender_rig_check.py -- --out .proof/rig

# Minecraft-плагин на настоящем сервере с ботом
node mc_test.mjs --jar target/MyPlugin.jar --steps .proof/mc-steps.json
```

## Как это устроено

```
proofkit/
├─ plugin.json, hooks.json      манифест и хуки (Antigravity)
├─ rules/AGENTS.md              правила, которые всегда в контексте
├─ agents/playtester.md         субагент-ревьюер
├─ scripts/gate.mjs             хуки: карта проекта на старте, шлагбаум на выходе, починка команд
├─ skills/
│  ├─ proof-verify/             главный скилл: метод проверки + рецепты + инструменты
│  │  ├─ SKILL.md
│  │  ├─ references/            подробные рецепты (игры, Blender, Minecraft, шаги сценариев, карта проекта)
│  │  └─ scripts/               ui_probe, route_tour, visual_diff, icon_check, compare, blender_*, mc_test, pw
│  ├─ design-quality/           дизайн без «нейрослопа», сохранение существующего дизайна
│  ├─ systematic-debugging/     из superpowers (MIT)
│  └─ test-driven-development/  из superpowers (MIT)
└─ install.mjs                  установщик
```

В исходниках вместо путей стоит метка `{{PROOFKIT_DIR}}` — установщик заменяет её на настоящую папку установки.

## Результаты

Проверено на Gemini 3.8 Flash (High) в Antigravity, независимой приёмкой (своими тестами, а не отчётом агента):

| Задача | Без proofkit | С proofkit |
|---|---|---|
| Тетрис | 27–29/32, крошечное поле, фейковые рекорды | 32/32, 0 проблем интерфейса |
| Видеоплеер | перекрытая кнопка | 40/40, 0 проблем |
| Самолёт по референсу + игра | рули отрываются при отклонении, новичка сбивают за 15 с | рули на шарнирах, новичок выживает, 144 FPS |
| Minecraft-плагин «киты» | — | 17/17 на живом сервере с ботом |
| Фикс в большом проекте (2 строки по смыслу) | 45 мин, 82 строки в 4 файлах | ~12 мин, 3–28 строк |
| Новый элемент в существующем дизайне | — | выглядит родным, diff «до/после» — только нужные места |

## Ограничения (честно)

- Сделано и проверено на **Windows**; скрипты кроссплатформенные, но на macOS/Linux пока не тестировались.
- Полная версия (хуки, ревьюер, шлагбаум) — только для **Antigravity**. В остальных агентах — скиллы, инструменты и правила.
- Модель остаётся моделью: качество между прогонами немного плавает, а 3D по референсу — узнаваемо, но не копия.
- Агент работает дольше, потому что реально проверяет. На мелких фиксах это минуты, на больших задачах — десятки минут.

## Благодарности и лицензия

MIT — см. [LICENSE](LICENSE). Скиллы `systematic-debugging` и `test-driven-development` взяты из
[superpowers](https://github.com/obra/superpowers) (MIT, © Jesse Vincent) — см. `skills/LICENSE-superpowers.txt`.
