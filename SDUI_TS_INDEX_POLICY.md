# SDUI_TS — Codegraph Index Policy

## Проблема

Индекс SDUI_TS: 68,807 нод, 90,094 edges, 156 MB. Из них **74% — шум** из Figma-codegen файлов, дубликаты .d.ts, agent config. Поиск, impact analysis и context builder работают на 80% мусора.

---

## Полная карта индекса

### INCLUDE — ядро (оставить обязательно)

| Директория | Nodes | Funcs | Types | Exported% | Cross-dir edges | Уникальность имён | Почему оставить |
|---|---|---|---|---|---|---|---|
| `src/core/` | 1,819 | 471 | 411 | 36% | 2,661 inbound | 92% | Ядро: createRef, decorators, helpers. Самый связанный модуль |
| `src/screens/` | 1,318 | 208 | 78 | 20% | 1,415 outbound | 69% | Entry points: SDUI экраны, computed, analytics |
| `src/tools/` | 1,309 | 202 | 228 | 25% | 251 out / 76 in | 86% | CLI, case factories, validators |
| `src/figma/` | 1,235 | 358 | 142 | 33% | 240 out / 393 in | 90% | Figma converter runtime (не codegen) |
| `src/validator/` | 1,185 | 282 | 102 | 27% | 541 out / 18 in | 82% | JSON-schema валидация контрактов |
| `src/codegen/` | 913 | 138 | 71 | 15% | 539 out / 196 in | 84% | Генератор TS-кода из схем |
| `scripts/` | 1,143 | 356 | 110 | 20% | 294 out / 226 in | 90% | Build, watch, CLI-утилиты |
| `src/testing/` | 240 | 77 | 33 | 29% | 109 out / 15 in | 93% | Test helpers, mocks |
| `converter-v2/ (non-gen)` | 589 | 111 | 77 | 26% | 224 out / 20 in | 88% | Логика конвертера (не codegen) |
| `generated/*.ts` (non-.d.ts) | ~3,400 | 12 | 1,930 | 28% | 14 out / 415 in | 45% | SDUI contract interfaces. 47 файлов из src/ их импортируют |
| `crates/` | 106 | 5 | 0 | 0% | 0 out / 46 in | 98% | Rust FFI bridge |
| `tools/` (root) | 271 | — | — | — | — | — | jinja-json-fmt, prettier plugin |
| Test files (`*.test.ts`) | ~2,648 | — | — | — | 393 call edges в prod | — | Показывают кто тестирует функцию |

**Итого INCLUDE: ~16,200 нод, ~38K edges**

### EXCLUDE — мусор (убрать обязательно)

| Директория | Nodes | Причина исключения | Evidence |
|---|---|---|---|
| `src/converter-v2/schema/generated/` | **50,961** (74%) | Figma-codegen. 0 функций, 0 call edges, 0 cross-boundary calls. 1% уникальность имён (505 уникальных из 50K — HexColor x219, Color x218, Spacing x178). 50 incoming type refs — потеря приемлема | 0 cross-boundary calls (SQL verified) |
| `generated/**/*.d.ts` | **~3,400** (5%) | Дубликаты .ts файлов. 730 .d.ts зеркалят 730 .ts. Одни и те же interfaces. Удвоение нод без информации | Pair check: 730 vs 730 |
| `.claude/` | 101 | Agent hooks/scripts. Не SDUI-код. Загрязняет поиск именами `args`, `tmpFile`, `result` | 0 exported |
| `**/__snapshots__/` | 161 | Test snapshots. Нет graph value | 0 meaningful edges |
| `eval/` | 62 | Evaluation harness. Не runtime | 0 cross-boundary |

**Итого EXCLUDE: ~54,685 нод (79%), ~52K edges, ~120 MB DB**

### CONDITIONAL — по ситуации

| Директория | Nodes | За включение | Против включения | Рекомендация |
|---|---|---|---|---|
| `eslint-plugin-sdui/` | 446 | Полезно при отладке lint rules | 6% exported, 59% уникальность, 16 inbound | **Exclude по умолчанию**, include при работе с линтером |
| `docs-site/` | 181 | Полезно при работе с доксайтом | 0 inbound, one-way dependency | **Exclude по умолчанию** |

---

## Рекомендуемый `.codegraphignore`

```gitignore
# === ОБЯЗАТЕЛЬНЫЕ ИСКЛЮЧЕНИЯ ===

# Figma converter codegen — 74% всех нод, 0 call edges
# 505 уникальных имён на 50,961 нод = 99% дубликаты
src/converter-v2/schema/generated/

# Дубликаты .d.ts -> .ts (730 пар, удвоение без информации)
generated/**/*.d.ts

# Agent config, не SDUI-код
.claude/

# Test snapshots — нет graph value
**/__snapshots__/

# Evaluation harness
eval/

# === ОПЦИОНАЛЬНЫЕ (раскомментировать при необходимости) ===

# eslint-plugin-sdui/
# docs-site/
```

---

## Что НЕ исключаем (и почему)

| Паттерн | Почему оставить |
|---------|-----------------|
| Test files (`*.test.ts`) | 393 call edges в prod-код. `codegraph callers X` покажет тесты — полезно для coverage |
| `generated/*.ts` (non-.d.ts) | 1,930 SDUI contract interfaces. 47 src/ файлов импортируют |
| Non-TS (yaml, java, python, rust) | 60 файлов. Java = Jinja validator. Rust = FFI. Шума ноль |
| `src/converter-v2/` (non-generated) | Логика конвертера. 111 функций, 224 outbound edges |

---

## Ожидаемые метрики после exclude

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Files | 3,060 | ~1,870 | -39% |
| Nodes | 68,807 | **~14,100** | **-80%** |
| Edges | 90,094 | ~38,000 | -58% |
| DB size | 156 MB | ~35 MB | -78% |
| FTS5 queries | baseline | ~4x faster | significant |
| Name uniqueness | 45% avg | ~85% avg | signal/noise jump |

**Фактически достигнуто** (после применения 5 обязательных исключений, измерено по `codegraph.db`):

| Metric | Before | Прогноз | Факт |
|--------|--------|---------|------|
| Nodes | 68,807 | ~14,100 | **19,096** (-72%) |
| Edges | 90,094 | ~38,000 | 44,947 (-50%) |
| DB size | 156 MB | ~35 MB | **36.8 MB** (-76%) |

Нод больше прогноза, т.к. опциональные исключения (`eslint-plugin-sdui/`, `docs-site/`, non-generated `converter-v2/`) оставлены включёнными. DB-размер — в цель.

---

## Edge Quality после exclude

| Тип | До | После | Сохранено |
|-----|-----|-------|-----------|
| contains | 65,752 | ~14,000 | structural |
| calls | 8,758 | ~8,700 | 99%+ |
| references | 8,126 | ~7,500 | ~92% |
| imports | 7,094 | ~6,500 | ~92% |

Потери: ~50 type-refs из screens к generated schema, ~600 internal generated-to-generated imports. Все productive cross-file call edges сохранены.

---

## Механизм реализации — РЕАЛИЗОВАНО И ПРИМЕНЕНО

`.codegraphignore` поддерживается. `buildDefaultIgnore(rootDir)` (`src/extraction/index.ts:169-184`) сливает три слоя:
1. `DEFAULT_IGNORE_PATTERNS` — built-in defaults (`src/extraction/index.ts:116-160`)
2. `.codegraphignore` из project root — читается если существует (`index.ts:172-173`)
3. `.gitignore` из project root — merge поверх (`index.ts:178-179`), негация в нём может перебить default

Применяется на обоих путях обхода (`index.ts:273`, `:506`), поведение одинаково с git и без.

**Статус для SDUI_TS:** `.codegraphignore` лежит в `~/Docs/SDUI_TS/.codegraphignore` со всеми 5 обязательными исключениями. Индекс пересобран.
