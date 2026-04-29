# Hermes Agent vs. OpenClaw – Vergleich (Stand April 2026)

## Versionen

| Projekt | Aktuelle Version | Veröffentlicht | Lizenz |
| --- | --- | --- | --- |
| **Hermes Agent** (Nous Research) | v0.11.0 / v2026.4.23 | 23. April 2026 | MIT |
| **OpenClaw** (P. Steinberger / Foundation) | 2026.4.26 | 26. April 2026 | Open Source |

## Kurzcharakterisierung

- **Hermes Agent**: Agent-First Runtime mit selbstlernender Skill-Schleife („Reflective Phase"). Kern ist ein synchroner *Do → Learn → Improve* Loop mit mehrschichtigem Memory-System (Session, Persistent, Skill). MCP-Integration, SQLite-Session-Persistenz, ACP-Anbindung. Pitch: „The agent that grows with you."
- **OpenClaw**: Gateway-First Assistant-Plattform. Eine zentrale Control-Plane verwaltet Sessions, Routing, Tools und State über 24 Messaging-Kanäle (WhatsApp, Discord, Telegram, …). Identität in `SOUL.md`, 100+ vorgefertigte AgentSkills, ClawHub-Marktplatz mit 13.000+ Community-Skills.

## User-Feedback (Synthese)

### Hermes Agent – Pro
- Selbstlernende Skills sparen laut TokenMix-Benchmark ~40 % Zeit bei wiederkehrenden Research-Aufgaben.
- Memory-System und Self-Improvement-Loop werden als „genuinely differentiated" gelobt.
- Power-User schätzen User-Control-First-Design (MIT, lokale Daten, lesbare Skills) und 40+ Built-in-Tools.

### Hermes Agent – Contra
- Kleine Community (r/hermesagent: 2.904 Subscriber, kleiner Discord).
- Skills sind domänenspezifisch — Transfer zwischen Aufgabentypen funktioniert kaum.
- 2–3× Token-Overhead via Telegram-Gateway gegenüber CLI (15–20 K vs. 6–8 K Tokens).

### OpenClaw – Pro
- Sehr breite Tool-/Plattform-Abdeckung, Setup auf einer 24 $/Monat-Droplet möglich.
- Spürbare Zeitersparnis (~45 min/Tag) nach Einrichtung; „delightful" Persönlichkeitssystem und persistentes Gedächtnis.
- Riesige Community: 345 K GitHub-Stars Anfang April 2026, ClawHub-Marktplatz.

### OpenClaw – Contra
- Setup komplex (Node ≥ 22, WSL2 unter Windows, manuelle Modellkonfig, ~45 min auf macOS).
- Mehrere öffentlich gemeldete Anthropic-Account-Bans bei Nutzung von Claude-Subscriptions mit dem Agenten.
- Over-Autonomy: markiert Tasks teils als erledigt, obwohl Output nur partiell ist; Reasoning-Loops driften.
- Browser-Automation und Opus-Nutzung treiben Kosten schnell (Test mit ~400 $).

## Vergleichstabelle (1–5 Sterne)

| Kriterium | Hermes Agent | OpenClaw |
| --- | --- | --- |
| Setup & Onboarding | ★★★★☆ | ★★☆☆☆ |
| Dokumentation | ★★★★☆ | ★★★★☆ |
| Tool-/Skill-Ökosystem | ★★★☆☆ | ★★★★★ |
| Multi-Channel-Integration (Messaging) | ★★★☆☆ | ★★★★★ |
| Memory & Personalisierung | ★★★★★ | ★★★★☆ |
| Selbstlern-/Skill-Improvement | ★★★★★ | ★★☆☆☆ |
| Zuverlässigkeit / Task-Completion | ★★★★☆ | ★★★☆☆ |
| Sicherheit & Sandboxing | ★★★★☆ | ★★★☆☆ |
| Kostenkontrolle (Token/Infra) | ★★★☆☆ | ★★★☆☆ |
| Community & Momentum | ★★★★☆ | ★★★★★ |
| User-Control & Transparenz | ★★★★★ | ★★★★☆ |
| Reife für Mainstream-Use | ★★★☆☆ | ★★☆☆☆ |
| **Gesamt-User-Zufriedenheit** | **★★★★☆** | **★★★☆☆** |

## Empfehlung

- **Wähle Hermes Agent**, wenn wiederkehrende, strukturierte Aufgaben und persönliche Personalisierung im Mittelpunkt stehen und du bereit bist, in einer kleineren, technischeren Community zu arbeiten.
- **Wähle OpenClaw**, wenn breite Tool-Abdeckung, viele Messaging-Kanäle und ein lebendiger Skill-Marktplatz wichtiger sind als selbstlernende Skills — und wenn du das Setup-Investment und die Sicherheits-/Autonomie-Risiken aktiv managen kannst.

## Quellen

- [Hermes Agent – Nous Research](https://hermes-agent.nousresearch.com/)
- [GitHub: NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- [Hermes Agent Review (TokenMix, 2026)](https://tokenmix.ai/blog/hermes-agent-review-self-improving-open-source-2026)
- [Hermes Agent Review – 30 Days Verdict](https://hermes-agent.ai/blog/hermes-agent-review-2026)
- [OpenClaw – Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- [OpenClaw.ai – Personal AI Assistant](https://openclaw.ai/)
- [„I Spent $400 Testing OpenClaw.ai"](https://ssntpl.com/i-spent-400-testing-openclaw-ai-an-honest-review/)
- [OpenClaw Review 2026 – Cybernews](https://cybernews.com/ai-tools/openclaw-review/)
- [„Don't use OpenClaw" – Medium](https://medium.com/data-science-in-your-pocket/dont-use-openclaw-a6ea8645cfd4)
- [OpenClaw vs. Hermes Agent – The New Stack](https://thenewstack.io/persistent-ai-agents-compared/)
- [Hermes Agent vs OpenClaw – ScreenshotOne](https://screenshotone.com/blog/hermes-agent-versus-openclaw/)
- [OpenClaw vs Hermes Agent – Kilo (Reddit-Synthese)](https://kilo.ai/articles/openclaw-vs-hermes-what-reddit-says)
- [Novita AI Sandbox Launch](https://www.morningstar.com/news/pr-newswire/20260428sf44822/novita-ai-launches-sandbox-to-secure-openclaw-hermes-agent-and-autonomous-systems)
