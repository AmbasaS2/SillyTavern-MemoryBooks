<!--
Copyright (C) 2024–2026 Aiko Hanasaki
SPDX-License-Identifier: AGPL-3.0-only
-->

# 📕 Memory Books — AmbasaS2 fork

Based on [Memory Books by Aiko Hanasaki](https://github.com/aikohanasaki/SillyTavern-MemoryBooks). This fork integrates my Sloth (게으름뱅이) memory workflow into Memory Books while retaining the original tools in a separate tab.

[한국어 안내 ↓](#-메모리북--ambasas2-포크) · [Original Memory Books](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) · [Original feature guides](./Start_Here.md)

## Who is this for?

- Long-running roleplayers who want to preserve distinct events rather than repeatedly merge all memories into one large summary.
- Players who want recent events remembered continuously, but old events recalled only when relevant.
- Players who find selecting every scene, writing summaries and manually changing old entries tedious.
- Players who want to use a separate AI to organize memories without changing the model they roleplay with.

If you prefer the original manual, consolidation or group-chat workflow, use the **Original Memory Books** tab or upstream itself.

## Install and set up once

1. Back up your chats, settings and lorebooks, especially when switching from the original Memory Books.
2. In SillyTavern's extension installer, enter:

   ```
   https://github.com/AmbasaS2/SillyTavern-MemoryBooks
   ```

3. Reload and open an individual character chat. Open **Memory Books** from the extension menu and select the **For 게으름뱅이 🦥** tab. Run only one Memory Books installation at a time.

### 1. Lorebook setup

The Sloth workflow separates two existing SillyTavern lorebooks:

| Book | What goes in it |
|---|---|
| **Nexus** | Key facts, ongoing state and continuity information; core state is kept active, with additional records managed according to their recall settings. |
| **Memory** | Individual completed events, preserved as separate entries instead of repeatedly merging the whole history. |

Choose two distinct books already linked to this character, or confirm your first collection to create and link the two books if the character has no linked books. If only one role is assigned, use the missing-book creation option. Use **Choose books for this chat only** if different chats with the same character need separate histories. Back up and check existing books before assigning their roles; do not assign another character's memories by mistake.

### 2. Collection settings

| Control | How to use it |
|---|---|
| Memory collection AI | Select a saved SillyTavern Chat Completion connection profile or Memory Books AI profile. Your RP model is not switched. |
| Older memory conversion | Choose **Vector** or **Keywords**. On the next collection, older scene entries change to this type; the latest three completed scenes stay always on. Vector mode requires SillyTavern's vector storage to be configured. |
| Review and retry summaries | Optional, off by default. Checks for major omissions or distortions and can make one additional AI request. |
| Summary prompt | Start with the built-in Sloth prompt. View it, copy it to customize the instructions, save named presets or import/export a compatible JSON preset. |

**Start with a collection AI and the default prompt.** You can leave automatic collection off while trying the manual workflow.

## Everyday use: roleplay, then collect memories

1. Press the collection icon in the chat input row, **Collect memories** in Memory Books, or `/sloth-collect`. Confirm the available message range to start analysis.
2. The collection AI reads the not-yet-collected messages and proposes completed events. Check the suggested ranges and number of memories. Incomplete events can remain for a later collection.
3. Choose whether to hide the successfully saved messages from the AI's active chat context, then approve. The AI writes the scene memories and updates relevant Nexus information.
4. Continue your RP. The latest three completed scenes stay active; older ones become keyword or vector entries according to your settings. Their full stored memory text is retained.

Hide is optional and does not delete the chat history. Only successfully saved ranges are eligible to be hidden. You can choose how many recent collected messages to keep visible. Review the proposed ranges and generated memories if exact continuity matters: model judgments can be wrong.

## Other settings and tools

| Section | When to use it |
|---|---|
| Automatic collection | Turn on **Collect memories automatically** and choose a token or message interval. Default is off; initial interval values are 50,000 tokens / 50 messages. Once enough unsaved content accumulates, collection runs after a reply in eligible chats with both books linked. It does not automatically hide messages. |
| Side Prompts | The built-in Diary defaults to a private, non-injected record. Add more prompts, check which ones to use for the character and choose a lorebook for each. You can continue an older entry or explicitly choose Little Things to create the character’s book on the first approved save. |
| Manage existing memories | Review merging related scenes, splitting an existing scene, or shortening an event. Choose and review the changes instead of automatically replacing memories. |
| Advanced settings | Show or hide the collection icon, place it next to Extensions or Send, choose its size (default 14 px), and choose how many recent collected messages to keep visible when hiding. |
| Original Memory Books | Original scene-marker tools, profiles, prompts, consolidation and other original features. Use the original feature guides for that workflow. |

Memory Books saves memories; it does not itself choose Jev recall during RP. For optional scene-aware lore selection and per-book budgets, see [the STLO fork](https://github.com/AmbasaS2/SillyTavern-LorebookOrdering). To read or edit the resulting lorebooks like a diary, see [the Lorebook Manager fork](https://github.com/AmbasaS2/lore-manager). Both are optional.

Collection, review, and side-prompt generation use AI requests; their cost and results depend on your provider, model, and chat size. Saved memories and chat excerpts may be sent to the selected AI provider. Back up existing data before switching or changing book assignments.

---

# 📕 메모리북 — AmbasaS2 포크

[원본 Memory Books](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)를 기반으로 제가 사용하던 게으름뱅이 메모리북 시스템을 확장 자체에 넣은 포크입니다. 원본 기능은 **기존 메모리북** 탭에서 사용할 수 있습니다.

## 이런 분들께 추천합니다!

- 장기 롤플을 하면서 오래된 기억을 계속 압축·통합해서 디테일을 잃고 싶지 않은 분
- 최근 사건은 계속 기억하되 과거 사건은 필요한 순간에만 불러오고 싶은 분
- 사건이 끝날 때마다 구간을 직접 지정하고, 기억을 만들고, 오래된 파란불을 초록불로 바꾸기 귀찮았던 분
- 롤플 모델은 그대로 두고 다른 AI에게 기억 정리를 맡기고 싶은 분

모든 기억을 상시 주입하거나 원본의 압축·통합 방식, 그룹 채팅 기능을 사용하고 싶다면 기존 메모리북 탭 또는 원본 확장을 사용하셔도 됩니다.

## 처음 한 번: 메모리북 설정

1. 기존 채팅·로어북·설정을 백업합니다. 원본과 이 포크를 동시에 실행하지 마세요.
2. 실리태번 확장 설치 메뉴에서 `https://github.com/AmbasaS2/SillyTavern-MemoryBooks`를 설치하고 새로고침합니다.
3. 1:1 캐릭터 채팅을 열고 확장 메뉴 → **Memory Books → For 게으름뱅이 🦥** 탭으로 들어갑니다.

### 1. 로어북 준비

게으름뱅이 시스템은 로어북을 두 권으로 나눠 사용합니다.

| 로어북 | 저장하는 내용 |
|---|---|
| **Nexus · 핵심 정보와 현재 상태** | 캐릭터와의 관계, 지속되는 사실, 현재 상태 등 앞으로의 롤플에 필요한 정보. 핵심 상태는 상시로 유지하고 추가 기록은 설정한 호출 방식을 따릅니다. |
| **Memory · 기억할 장면** | 롤플에서 실제로 일어난 사건을 장면별로 저장합니다. 이전 기억을 삭제하거나 모두 한 덩어리로 합치지 않습니다. |

이미 캐릭터에게 연결된 책이 있다면 Nexus와 Memory에 서로 다른 책을 지정합니다. 연결된 책이 없는 새 캐릭터는 첫 수집을 승인할 때 두 권을 생성·연결할 수 있습니다. 한 권만 지정되어 있다면 부족한 책 만들기 기능을 사용하세요.

같은 캐릭터와 여러 채팅에서 서로 다른 이야기를 진행한다면 **이 채팅에만 로어북 따로 지정**을 사용하세요. 다른 채팅의 기본 책은 유지됩니다.

### 2. 수집 설정

| 설정 | 언제, 어떻게 쓰나요? |
|---|---|
| 수집에 사용할 AI | 기억 정리에 사용할 실리태번 채팅 완성 연결 프로필 또는 메모리북 AI 프로필을 선택합니다. RP 모델을 바꾸지 않습니다. |
| 이전 기억 전환 방식 | 벡터 또는 키워드를 선택합니다. 다음 수집 때 오래된 기억을 해당 방식으로 전환하고 최근 기억 3개는 파란불로 유지합니다. 벡터를 쓰려면 실리태번 벡터 저장소를 별도로 설정하세요. |
| 요약 검증 및 재시도 | 큰 누락이나 왜곡을 검사할 때 켭니다. 기본 꺼짐이며 AI 호출이 최대 한 번 추가될 수 있습니다. |
| 사용할 요약 프롬프트 | 기본 게으름뱅이 프롬프트로 시작하세요. 전체 보기, 복사 후 수정, 이름 변경, 저장, 호환 JSON 가져오기·내보내기가 가능합니다. |

처음에는 수집 AI만 정하고 기본 프롬프트로 수동 수집을 한 번 해 보세요.

## 평소 사용법: 롤플하고 사건이 끝나면 수집!

1. 입력창의 **수집 아이콘**, 메모리북의 **기억 수집 하기** 또는 `/sloth-collect`를 사용합니다. 화면에 표시된 메시지 범위를 확인하면 분석을 시작합니다.
2. AI가 아직 수집하지 않은 메시지를 읽고 완결된 사건을 나눠 제안합니다. 분석 범위와 저장할 기억의 개수를 확인하세요. 진행 중인 사건은 다음 수집에 남길 수 있습니다.
3. **저장한 구간을 AI 대화 맥락에서 숨기기**를 사용할지 선택하고 승인합니다. AI가 사건별 기억을 작성하고 필요한 Nexus 정보를 갱신합니다.
4. 다시 롤플하면 됩니다. 최근 완료 Scene 3개는 상시로, 오래된 Scene은 선택한 벡터 또는 키워드 방식으로 관리됩니다.

Hide는 채팅 원문 삭제가 아닙니다. 저장된 범위만 AI가 읽는 채팅 맥락에서 숨기며, 수집한 메시지 중 최근 몇 개를 남길지도 지정할 수 있습니다. AI가 사건 범위를 잘못 판단하거나 중요한 내용을 놓칠 수 있으니 필요한 경우 수집 계획과 저장된 내용을 확인하세요.

## 나머지 설정은 필요할 때만!

| 설정 영역 | 활용법 |
|---|---|
| 자동 수집 | 기본 꺼짐. 새 미수집 내용이 일정 토큰 또는 채팅 개수만큼 쌓이면 답변 후 자동으로 완결 사건을 수집합니다. 기본 간격은 50,000토큰 / 50개 메시지이며 직접 변경할 수 있습니다. Nexus·Memory가 연결된 채팅에서 작동하며 자동으로 Hide하지 않습니다. |
| 사이드 프롬프트 | 기본 일기는 미주입으로 저장합니다. ‘사이드 프롬프트 추가’로 나만의 프롬프트를 만들고, 이 캐릭터에서 쓸 프롬프트만 체크한 뒤 각각 저장할 로어북을 고릅니다. 기존 항목에 이어 쓰거나, Little Things를 선택해 필요한 책을 첫 승인 저장 때 만들 수 있습니다. |
| 저장한 사건 수정 | 나뉜 사건 합치기, 한 기억을 사건별로 나누기, 사건 짧게 줄이기를 필요할 때 사용합니다. 자동 통합이 아니라 사용자가 대상과 변경안을 확인하는 작업입니다. |
| 고급 설정 | 수집 아이콘 표시 여부, 확장 메뉴 옆 또는 전송 버튼 옆 위치, 크기(기본 14px), Hide 시 남길 메시지 수(기본 0)를 설정합니다. |
| 기존 메모리북 | 원본의 구간 지정·프로필·프롬프트·압축·통합 등 기존 도구를 사용할 수 있습니다. |

### 다른 로어북 확장과 함께 사용하고 싶다면

- **[STLO 포크](https://github.com/AmbasaS2/SillyTavern-LorebookOrdering)**: 메모리북의 토큰 예산을 제한하고 상시 기억을 보호하거나, 제브로 현재 장면에 필요한 오래된 기억을 골라 불러올 수 있습니다. 제브 설정은 STLO에 있습니다.
- **[로어북 매니저 포크](https://github.com/AmbasaS2/lore-manager)**: 저장한 Memory를 일기장처럼 찾아 읽고 번역하거나 원문을 수정할 수 있습니다.

둘 다 필수 확장은 아닙니다. 수집·검증·사이드 프롬프트 작성에는 AI 호출이 발생하며 비용과 결과는 사용 모델·채팅 길이에 따라 달라집니다. 수집용 AI 제공자에게 채팅 및 기억 내용이 전달될 수 있다는 점을 고려해 주세요.

---

## Original Memory Books documentation / 원본 기능 안내

> **Not sure how AI memory actually works?**  
> Read [How Memory Works in SillyTavern](https://www.hanasaki.ai/ref/stmemory.html) for a plain-language explanation of chat history, summaries, lorebooks, vector retrieval, trackers, and where Memory Books fits.

- [Quickstart / 원본 기능 시작하기](./Start_Here.md)
- [Memory Books AI Reference Manual / 원본 AI 참조 매뉴얼](userguides/1%20Memory_Books_AI_Reference_Manual.md) — download and upload to an assistant to ask about the original features.
- [Original source / 원작 저장소](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)

Fork modifications and documentation: AmbasaS2. Thanks to Aiko Hanasaki for the original extension.

## Copyright and License

SillyTavern Memory Books is Copyright © 2024–2026 Aiko Hanasaki.

The original code in this repository is licensed under the GNU Affero General Public License v3.0. Modified versions and forks must preserve applicable copyright and license notices, identify their modifications, and comply with the AGPL's source-availability requirements. 

See [LICENSE](./LICENSE).
