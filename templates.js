// Copyright (C) 2024–2026 Aiko Hanasaki
// SPDX-License-Identifier: AGPL-3.0-only

import { Handlebars } from '../../../../lib.js';

/**
 * Main settings template
 */
export const settingsTemplate = Handlebars.compile(`
    <div class="stmb-workspace">
        <header class="stmb-workspace-header">
          <h2 data-i18n="STMemoryBooks_Settings">📕 Memory Books</h2>
          {{#if slothCharacterAvailable}}
          <span class="stmb-current-character">{{slothCharacterName}}</span>
          {{/if}}
        </header>
        <div class="stmb-workspace-tabs" role="tablist" aria-label="Memory Books" data-i18n="[aria-label]STMemoryBooks_Settings">
          <button type="button" id="stmb-sloth-tab" role="tab" aria-selected="true" aria-controls="stmb-sloth-panel" data-stmb-workspace-tab="sloth">For 게으름뱅이 🦥</button>
          <button type="button" id="stmb-original-tab" role="tab" aria-selected="false" aria-controls="stmb-original-panel" tabindex="-1" data-stmb-workspace-tab="original" data-i18n="STMemoryBooks_OriginalTab">Original Memory Books</button>
        </div>
        <section id="stmb-sloth-panel" class="stmb-tab-panel" role="tabpanel" aria-labelledby="stmb-sloth-tab">
        {{#unless isGroupChat}}
        <details id="stmb-sloth-lorebooks" open class="stmb-sloth-roles stmb-box stmb-workspace-drawer" aria-labelledby="stmb-sloth-roles-title">
          <summary id="stmb-sloth-roles-title" data-i18n="STMemoryBooks_SlothRolesTitle">Lorebook setup</summary>
          {{#if slothCharacterAvailable}}
            {{#if slothLinkedBooksAvailable}}
              {{#unless slothRoleActive}}
                <p data-i18n="STMemoryBooks_SlothRolesDescription">Choose the existing books to use for Nexus and Memory.</p>
              {{/unless}}
            {{else}}
              {{#if slothFirstSetup}}
              <p data-i18n="STMemoryBooks_SlothNoBooksYet">Nexus and Memory will be created and linked when you confirm your first collection.</p>
              {{else}}
              <p class="stmb-sloth-warning" data-i18n="STMemoryBooks_SlothNoLinkedBooks">No lorebooks are linked to this character in SillyTavern. Connect them in the character lorebook settings first.</p>
              {{/if}}
            {{/if}}
            {{#if slothRoleChoicesAvailable}}
              <div class="stmb-sloth-role-grid">
                <label for="stmb-sloth-role-nexus">
                  <strong data-i18n="STMemoryBooks_SlothNexusRole">Nexus · key facts and current state</strong>
                  <select id="stmb-sloth-role-nexus" class="text_pole">
                    <option value="" data-i18n="STMemoryBooks_SlothUnassigned">Choose a lorebook</option>
                    {{#if slothNexusMissing}}
                    <option selected disabled value="{{slothNexusMissingName}}">⚠ {{slothNexusMissingName}}</option>
                    {{/if}}
                    {{#each slothNexusRoleOptions}}
                    <option value="{{name}}" {{#if selected}}selected{{/if}} {{#if disabled}}disabled{{/if}}>{{name}}</option>
                    {{/each}}
                    {{#if slothUnlinkedBooks}}
                    <optgroup label="Unlinked lorebooks" data-i18n="[label]STMemoryBooks_SlothUnlinkedBooks" disabled>
                      {{#each slothUnlinkedBooks}}<option value="{{this}}">{{this}}</option>{{/each}}
                    </optgroup>
                    {{/if}}
                  </select>
                </label>
                <label for="stmb-sloth-role-memory">
                  <strong data-i18n="STMemoryBooks_SlothMemoryRole">Memory · scenes to remember</strong>
                  <select id="stmb-sloth-role-memory" class="text_pole">
                    <option value="" data-i18n="STMemoryBooks_SlothUnassigned">Choose a lorebook</option>
                    {{#if slothMemoryMissing}}
                    <option selected disabled value="{{slothMemoryMissingName}}">⚠ {{slothMemoryMissingName}}</option>
                    {{/if}}
                    {{#each slothMemoryRoleOptions}}
                    <option value="{{name}}" {{#if selected}}selected{{/if}} {{#if disabled}}disabled{{/if}}>{{name}}</option>
                    {{/each}}
                    {{#if slothUnlinkedBooks}}
                    <optgroup label="Unlinked lorebooks" data-i18n="[label]STMemoryBooks_SlothUnlinkedBooks" disabled>
                      {{#each slothUnlinkedBooks}}<option value="{{this}}">{{this}}</option>{{/each}}
                    </optgroup>
                    {{/if}}
                  </select>
                </label>
              </div>
              {{#if slothSharedBook}}
              <p class="stmb-sloth-warning" data-i18n="STMemoryBooks_SlothSharedBook">This book is already assigned to another character. Choose a separate book for these memories.</p>
              {{/if}}
              {{#if slothNexusMissing}}
              <p class="stmb-sloth-warning" data-i18n="STMemoryBooks_SlothMissingRole">A selected book is no longer linked to this character. Reconnect it or choose another.</p>
              {{else}}{{#if slothMemoryMissing}}
              <p class="stmb-sloth-warning" data-i18n="STMemoryBooks_SlothMissingRole">A selected book is no longer linked to this character. Reconnect it or choose another.</p>
              {{/if}}{{/if}}
            {{/if}}
            {{#if slothHasWorldBooks}}
            <label class="checkbox_label stmb-sloth-chat-override">
              <input id="stmb-sloth-linked-books-only" type="checkbox" {{#if slothLinkedBooksOnly}}checked{{/if}}>
              <span data-i18n="STMemoryBooks_SlothLinkedBooksOnly">Show only lorebooks linked to this character</span>
            </label>
            {{/if}}
            {{#if slothChatOverrideAvailable}}
            <label class="checkbox_label stmb-sloth-chat-override" for="stmb-sloth-chat-override">
              <input id="stmb-sloth-chat-override" type="checkbox" {{#if slothChatOverrideActive}}checked{{/if}}>
              <span data-i18n="STMemoryBooks_SlothChatOverride">Choose books for this chat only</span>
            </label>
            <small data-i18n="STMemoryBooks_SlothChatOverrideHelp">Other chats still use the character's default books.</small>
            {{/if}}
            {{#if slothChatOverrideInvalid}}
            <p class="stmb-sloth-warning" data-i18n="STMemoryBooks_SlothChatOverrideInvalid">This chat override is invalid. Turn it off, or choose two different connected lorebooks.</p>
            {{/if}}
            {{#if slothMissingCompanion}}
              <button type="button" class="menu_button" data-stmb-sloth-action="companion" data-i18n="STMemoryBooks_SlothPrepareCompanion">Create the missing lorebook</button>
            {{/if}}
          {{else}}
            <p data-i18n="STMemoryBooks_SlothSelectCharacter">Choose a character to configure its lorebooks.</p>
          {{/if}}
        </details>
        {{else}}
          <p data-i18n="STMemoryBooks_SlothSelectCharacter">Choose an individual character chat to connect lorebooks.</p>
        {{/unless}}
        {{#if slothCharacterAvailable}}
        <details id="stmb-sloth-collection-settings" open class="stmb-workspace-panel stmb-workspace-drawer" aria-labelledby="stmb-sloth-settings-title">
          <summary id="stmb-sloth-settings-title" data-i18n="STMemoryBooks_SlothCollectionSettings">Collection settings</summary>
        <label for="stmb-sloth-profile-select" class="stmb-sloth-select-row">
            <span data-i18n="STMemoryBooks_SlothAIModule">Memory collection AI</span>
            <select id="stmb-sloth-profile-select" class="text_pole">
                {{#if slothConnectionProfileMissing}}
                <option value="st:{{slothConnectionProfileId}}" selected disabled data-i18n="STMemoryBooks_MissingConnectionProfile">Missing connection profile</option>
                {{/if}}
                {{#each slothProfiles}}
                <option value="{{@index}}" {{#unless @root.slothConnectionProfileId}}{{#if isSlothProfile}}selected{{/if}}{{/unless}}>{{name}}</option>
                {{/each}}
                {{#each slothConnectionProfiles}}
                <option value="st:{{id}}" {{#if selected}}selected{{/if}} title="{{model}}">{{name}}</option>
                {{/each}}
            </select>
        </label>
        <label for="stmb-sloth-memory-recall" class="stmb-sloth-select-row">
          <span data-i18n="STMemoryBooks_SlothMemoryRecall">Older memory conversion</span>
          <select id="stmb-sloth-memory-recall" class="text_pole">
            <option value="vector" {{#if slothMemoryUsesVector}}selected{{/if}} data-i18n="STMemoryBooks_NexusRecallVector">Vector</option>
            <option value="keyword" {{#if slothMemoryUsesKeywords}}selected{{/if}} data-i18n="STMemoryBooks_SlothRecallKeywords">Keywords</option>
          </select>
        </label>
        <small id="stmb-sloth-native-recall-help" data-i18n="STMemoryBooks_SlothMemoryRecallHelp">The next collection converts older memories to the selected type. The latest three stay always on.</small>
        <label class="checkbox_label">
          <input id="stmb-sloth-summary-review" type="checkbox" aria-describedby="stmb-sloth-summary-review-help" {{#if slothSummaryReview}}checked{{/if}}>
          <span data-i18n="STMemoryBooks_SlothSummaryReview">Review and retry summaries</span>
        </label>
        <small id="stmb-sloth-summary-review-help" data-i18n="STMemoryBooks_SlothSummaryReviewHelp">Check for major omissions or distortions and repair them with up to one extra AI request.</small>
        <div data-stmb-prompt-library-slot="summary"></div>
        </details>
        {{/if}}
        {{#if slothCanCollect}}
        <section class="stmb-workspace-panel stmb-collection" aria-labelledby="stmb-collection-title">
          <div class="stmb-collection-action">
            <h3 id="stmb-collection-title" data-i18n="STMemoryBooks_SlothCollectionTitle">Collect memories</h3>
            <p data-i18n="STMemoryBooks_SlothManualHelp">The AI finds events to summarize in messages you have not collected yet.</p>
            <ol class="stmb-collection-steps">
              <li data-i18n="STMemoryBooks_SlothCollectStepRange">Check the collection range and number of memories.</li>
              <li data-i18n="STMemoryBooks_SlothCollectStepHide">Choose whether to hide the saved messages.</li>
              <li data-i18n="STMemoryBooks_SlothCollectStepSave">Confirm to start writing and saving the summaries.</li>
            </ol>
            <button type="button" class="menu_button" data-stmb-sloth-action="collect" data-i18n="STMemoryBooks_SlothCollectButton">Collect memories</button>
          </div>
        </section>
        {{/if}}
        <details id="stmb-sloth-auto" class="stmb-workspace-panel stmb-workspace-drawer">
          <summary data-i18n="STMemoryBooks_SlothAutoTitle">Automatic collection</summary>
          <div class="stmb-sloth-auto-fields">
            <label class="checkbox_label">
              <input id="stmb-sloth-auto-enabled" type="checkbox" {{#if slothAutoEnabled}}checked{{/if}}>
              <span data-i18n="STMemoryBooks_SlothAutoEnable">Collect memories automatically</span>
            </label>
            <label class="stmb-sloth-select-row" for="stmb-sloth-auto-mode">
              <span data-i18n="STMemoryBooks_SlothAutoIntervalUnit">Interval unit</span>
              <select class="text_pole" id="stmb-sloth-auto-mode">
                <option value="tokens" {{#if slothAutoUsesTokens}}selected{{/if}} data-i18n="STMemoryBooks_Tokens">Tokens</option>
                <option value="messages" {{#unless slothAutoUsesTokens}}selected{{/unless}} data-i18n="STMemoryBooks_SlothAutoMessageUnit">Messages</option>
              </select>
            </label>
            <label class="stmb-sloth-select-row" for="stmb-sloth-auto-interval">
              <span data-i18n="STMemoryBooks_SlothAutoInterval">Collect every</span>
              <input id="stmb-sloth-auto-interval" type="number" min="1" max="{{slothAutoIntervalMax}}" class="text_pole" value="{{slothAutoInterval}}">
            </label>
            <small data-i18n="STMemoryBooks_SlothAutoHelp">In chats with Nexus and Memory linked, completed events are saved after a reply once enough unsaved messages accumulate. Messages stay visible.</small>
          </div>
        </details>
        <details id="stmb-sloth-side-prompts" open class="stmb-workspace-panel stmb-workspace-drawer" aria-labelledby="stmb-sloth-side-title">
          <summary id="stmb-sloth-side-title" data-i18n="STMemoryBooks_Compaction_TypeSidePrompt">Side Prompt</summary>
          <p data-i18n="STMemoryBooks_SlothSidePromptHelp">Save diaries and other records using your choice of lorebook for each prompt.</p>
          <div data-stmb-prompt-library-slot="side"></div>
          <div class="stmb-sloth-controls">
            {{#if slothRoleActive}}
            <button type="button" class="menu_button" data-stmb-sloth-action="followup" data-i18n="STMemoryBooks_SlothSidePromptAction">Run Side Prompts</button>
            {{/if}}
          </div>
        </details>
        {{#if slothRoleActive}}
          <details id="stmb-manage-memories" class="stmb-workspace-drawer stmb-sloth-maintenance">
            <summary data-i18n="STMemoryBooks_SlothManageBooks">Manage existing memories</summary>
            <div>
              <div class="stmb-management-action">
              <button type="button" class="menu_button" data-stmb-sloth-action="merge" data-i18n="STMemoryBooks_SlothMergeButton">Review existing Scene merges</button>
              <small data-i18n="STMemoryBooks_SlothMergeHelp">Existing complete Scenes can be reviewed for causal overlaps. You choose a pair, check the combined text, and back up Memory before any change. Nothing merges automatically.</small>
              </div><div class="stmb-management-action">
              <button type="button" class="menu_button" data-stmb-sloth-action="split" data-i18n="STMemoryBooks_SlothSplitButton">Review splitting a Scene</button>
              <small data-i18n="STMemoryBooks_SlothSplitHelp">Review completed Scenes with visible original messages and verifiable order. Each source message is accounted for and the original is kept in the archive.</small>
              </div>
              <div class="stmb-management-action">
                <button type="button" class="menu_button" data-stmb-sloth-action="compress" data-i18n="STMemoryBooks_SlothCompress">Shorten an event</button>
                <small data-i18n="STMemoryBooks_SlothCompressHelp">Choose what to keep and review the shorter memory.</small>
              </div>
            </div>
          </details>
        {{/if}}
        <details id="stmb-sloth-advanced" class="stmb-workspace-drawer">
          <summary data-i18n="STMemoryBooks_SlothAdvanced">Advanced settings</summary>
          <div class="stmb-sloth-advanced-fields">
            <label class="checkbox_label">
              <input id="stmb-sloth-composer-enabled" type="checkbox" {{#if slothComposerEnabled}}checked{{/if}}>
              <span data-i18n="STMemoryBooks_SlothComposerToggle">Show the collection icon</span>
            </label>
            <label for="stmb-sloth-composer-position" class="stmb-sloth-inline-field">
              <span data-i18n="STMemoryBooks_SlothComposerPosition">Collection icon position</span>
              <select id="stmb-sloth-composer-position" class="text_pole">
                <option value="left" {{#unless slothComposerOnRight}}selected{{/unless}} data-i18n="STMemoryBooks_SlothComposerLeft">Left · Extensions menu</option>
                <option value="right" {{#if slothComposerOnRight}}selected{{/if}} data-i18n="STMemoryBooks_SlothComposerRight">Right icon row</option>
              </select>
            </label>
            <div class="stmb-sloth-inline-field stmb-sloth-icon-field">
              <span id="stmb-sloth-composer-icon-label" data-i18n="STMemoryBooks_SlothComposerIcon">Collect button icon</span>
              <button type="button" id="stmb-sloth-icon-trigger" class="menu_button" aria-labelledby="stmb-sloth-composer-icon-label"
                aria-expanded="false" aria-controls="stmb-sloth-icon-popover" title="{{slothComposerIcon.title}}">
                <i class="fa-solid fa-{{slothComposerIcon.id}}" aria-hidden="true"></i>
              </button>
              <div id="stmb-sloth-icon-popover" class="stmb-sloth-icon-popover" popover="auto" hidden
                role="group" aria-labelledby="stmb-sloth-composer-icon-label">
                <div class="stmb-sloth-icon-options">
                  {{#each slothComposerIcons}}
                  <label title="{{title}}">
                    <input type="radio" name="stmb-sloth-composer-icon" value="{{id}}" aria-label="{{title}}" {{#if selected}}checked{{/if}}>
                    <i class="fa-solid fa-{{id}}" aria-hidden="true"></i>
                  </label>
                  {{/each}}
                </div>
              </div>
            </div>
            <label for="stmb-sloth-composer-size" class="stmb-sloth-inline-field">
              <span data-i18n="STMemoryBooks_SlothComposerSize">Collect button size</span>
              <select id="stmb-sloth-composer-size" class="text_pole">
                {{#each slothComposerSizes}}<option value="{{size}}" {{#if selected}}selected{{/if}}>{{size}} px</option>{{/each}}
              </select>
            </label>
            <hr class="stmb-sloth-settings-rule">
            <label for="stmb-sloth-hide-recent" class="stmb-sloth-inline-field">
              <span data-i18n="STMemoryBooks_SlothHideRecent">Recent collected messages to keep visible</span>
              <input id="stmb-sloth-hide-recent" type="number" min="0" max="9999" class="text_pole" value="{{slothHideRecent}}">
            </label>
          </div>
        </details>

        </section>
        <section id="stmb-original-panel" class="stmb-tab-panel stmb-original-panel" role="tabpanel" aria-labelledby="stmb-original-tab" hidden>
        {{#if showOriginalSettings}}
        <details class="stmb-help-drawer info-block hint">
            <summary>
                <i class="fa-solid fa-circle-question" aria-hidden="true"></i>
                <span data-i18n="STMemoryBooks_HelpGuidesSummary">Help &amp; Guides</span>
            </summary>
            <div class="stmb-help-drawer-content">
                <p class="stmb-help-drawer-copy" data-i18n="STMemoryBooks_AIReferenceManualOption">Download the Memory Books AI Reference Manual, upload it to your preferred assistant, and ask it questions about Memory Books.</p>
                <a class="menu_button menu_button_icon interactable stmb-help-drawer-link justifyCenter"
                    href="{{aiReferenceManualUrl}}" download="{{aiReferenceManualFilename}}">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                    <span data-i18n="STMemoryBooks_DownloadAIReferenceManual">Download AI Reference Manual (.md)</span>
                </a>
                <small class="stmb-help-languages">
                    <a href="https://github.com/aikohanasaki/SillyTavern-MemoryBooks/tree/main/userguides"
                        target="_blank" rel="noopener noreferrer"
                        data-i18n="STMemoryBooks_BrowseGuideLanguages">Browse the guide in other languages</a>
                </small>
            </div>
        </details>

        {{#if hasScene}}
        <div id="stmb-scene" class="padding10 marginBot10">
            <div class="marginBot5" data-i18n="STMemoryBooks_CurrentScene">Current Scene:</div>
            <div class="padding10 marginTop5 stmb-box">
                <pre><code id="stmb-scene-block"><span data-i18n="STMemoryBooks_Start">Start</span>: <span data-i18n="STMemoryBooks_Message">Message</span> #{{sceneData.sceneStart}} ({{sceneData.startSpeaker}})
{{sceneData.startExcerpt}}

<span data-i18n="STMemoryBooks_End">End</span>: <span data-i18n="STMemoryBooks_Message">Message</span> #{{sceneData.sceneEnd}} ({{sceneData.endSpeaker}})
{{sceneData.endExcerpt}}

<span data-i18n="STMemoryBooks_Messages">Messages</span>: {{sceneData.messageCount}} | <span data-i18n="STMemoryBooks_EstimatedTokens">Estimated tokens</span>: {{sceneData.estimatedTokens}}</code></pre>
                {{#if sceneData.hasMostlyHiddenMessages}}
                <small class="warning">⚠️ <span data-i18n="STMemoryBooks_MostlyHiddenSceneWarning">More than 50% of the messages in this scene are hidden. Please ensure that the scene selection is correct.</span></small>
                {{/if}}
            </div>
        </div>
        {{else}}
        <div class="info-block warning">
            <span data-i18n="STMemoryBooks_NoSceneMarkers">No scene markers set. Use the chevron buttons in chat messages to mark start (►) and end (◄) points.</span>
        </div>
        {{/if}}

        {{#if hasHighestMemoryProcessed}}
        <div id="stmb-memory-status" class="info-block">
            <span>📊 <span data-i18n="STMemoryBooks_MemoryStatus">Memory Status</span>:
                {{#if highestMemoryProcessedManuallySet}}<span data-i18n="STMemoryBooks_LastProcessedManuallySet">last processed message manually set to</span> #{{highestMemoryProcessed}}.
                {{else}}<span data-i18n="STMemoryBooks_ProcessedUpTo">Processed up to message</span> #{{highestMemoryProcessed}}.
            {{/if}}</span>
        </div>
        {{else}}
        <div id="stmb-memory-status" class="info-block">
            <span>📊 <span data-i18n="STMemoryBooks_MemoryStatus">Memory Status</span>: <span data-i18n="STMemoryBooks_NoMemoriesProcessed">No memories have been processed for this chat yet</span> <small data-i18n="STMemoryBooks_SinceVersion">(since updating to version 3.6.2 or higher.)</small></span>
            <br />
            <small data-i18n="STMemoryBooks_AutoSummaryNote">Please note that Auto-Summary requires you to "prime" every chat with at least one manual memory. After that, summaries will be made automatically.</small>
        </div>
        {{/if}}

        <h3 class="stmb-section-title" data-i18n="STMemoryBooks_CurrentLorebookConfig">Current Lorebook Configuration</h3>

        <div class="info-block">
            <small class="opacity50p" data-i18n="STMemoryBooks_Mode">Mode:</small>
            <h5 id="stmb-mode-badge">{{lorebookMode}}</h5>

            <small class="opacity50p" data-i18n="STMemoryBooks_ActiveLorebook">Active Lorebook:</small>
            <h5 id="stmb-active-lorebook" class="{{#unless currentLorebookName}}opacity50p{{/unless}}">
                {{#if currentLorebookName}}
                    {{currentLorebookName}}
                {{else}}
                    <span data-i18n="STMemoryBooks_NoneSelected">None selected</span>
                {{/if}}
            </h5>

            <div id="stmb-manual-controls" style="display: {{#if manualModeEnabled}}block{{else}}none{{/if}};">
                <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap" id="stmb-manual-lorebook-buttons">
                    <!-- Manual lorebook buttons will be dynamically inserted here -->
                </div>
                <div id="stmb-manual-group-lorebook-bindings" class="marginTop10">
                    <!-- Group character lorebook bindings will be dynamically inserted here -->
                </div>
            </div>

            <div id="stmb-automatic-info" class="marginTop5" style="display: {{#if manualModeEnabled}}none{{else}}block{{/if}};">
                <small class="opacity50p">
                    {{#if slothRoleActive}}
                        <span data-i18n="STMemoryBooks_SlothRoleActive">🦥 Sloth: using the character Memory lorebook in this chat</span>
                    {{else}}{{#if chatBoundLorebookName}}
                        <span data-i18n="STMemoryBooks_UsingChatBound">Using chat-bound lorebook</span> "{{chatBoundLorebookName}}"
                    {{else}}
                        <span data-i18n="STMemoryBooks_NoChatBound">No chat-bound lorebook. Memories will require lorebook selection.</span>
                    {{/if}}{{/if}}
                </small>
            </div>
        </div>

        <div class="world_entry_form_control">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-manual-mode-enabled" {{#if manualModeEnabled}}checked{{/if}} {{#if autoCreateLorebook}}disabled{{/if}}>
                <span data-i18n="STMemoryBooks_EnableManualMode">Enable Manual Lorebook Mode</span>
            </label>
            <small class="opacity50p" data-i18n="STMemoryBooks_ManualModeDesc">When enabled, you must specify a lorebook for memories instead of using the one bound to the chat.</small>
        </div>

        {{#unless isGroupChat}}
        <div class="world_entry_form_control">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-narrator-mode-enabled" {{#if narratorModeEnabled}}checked{{/if}}>
                <span data-i18n="STMemoryBooks_NarratorMode">Narrator Mode</span>
            </label>
            <small class="opacity50p" data-i18n="STMemoryBooks_NarratorModeDesc">Use one omniscient Memory Book plus separate Memory Books for a manually selected cast.</small>
            <div id="stmb-manage-narrator-cast-container" class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap {{#unless narratorModeEnabled}}displayNone{{/unless}}">
                <button type="button" id="stmb-manage-narrator-cast" class="menu_button interactable whitespacenowrap">
                    <i class="fa-solid fa-users"></i>
                    <span data-i18n="STMemoryBooks_ManageNarratorCast">Manage Narrator Cast</span>
                    {{#if narratorMemberCount}} ({{narratorMemberCount}}){{/if}}
                </button>
            </div>
        </div>
        {{/unless}}

        <div class="world_entry_form_control">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-auto-create-lorebook" {{#if autoCreateLorebook}}checked{{/if}} {{#if manualModeEnabled}}disabled{{/if}}>
                <span data-i18n="STMemoryBooks_AutoCreateLorebook">Auto-create lorebook if none exists</span>
            </label>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoCreateLorebookDesc">When enabled, automatically creates and binds a lorebook to the chat if none exists.</small>
        </div>

        <div class="world_entry_form_control">
            <label for="stmb-lorebook-name-template">
                <h4 data-i18n="STMemoryBooks_LorebookNameTemplate">Lorebook Name Template:</h4>
                <small class="opacity50p" data-i18n="STMemoryBooks_LorebookNameTemplateDesc">Template for auto-created lorebook names. Supports {{char}}, {{user}}, {{chat}} placeholders.</small>
                <input type="text" id="stmb-lorebook-name-template" class="text_pole"
                    value="{{lorebookNameTemplate}}" data-i18n="[placeholder]STMemoryBooks_LorebookNameTemplatePlaceholder"
                    placeholder="LTM - {{char}} - {{chat}}"
                    {{#unless autoCreateLorebook}}disabled{{/unless}}>
            </label>
        </div>

        <h3 class="stmb-section-title" data-i18n="STMemoryBooks_Profiles">Memory Profiles:</h3>

            <div class="world_entry_form_control">
            <h4 data-i18n="STMemoryBooks_TitleFormat">Memory Title Format:</h4>
            <select id="stmb-title-format-select" class="text_pole">
                {{#each titleFormats}}
                <option value="{{value}}" {{#if isSelected}}selected{{/if}}>{{value}}</option>
                {{/each}}
                <option value="custom" {{#if isCustomTitleFormat}}selected{{/if}} data-i18n="STMemoryBooks_CustomTitleFormat">Custom Title Format...</option>
            </select>
            <input type="text" id="stmb-custom-title-format" class="text_pole marginTop5 {{#unless showCustomInput}}displayNone{{/unless}}"
                data-i18n="[placeholder]STMemoryBooks_EnterCustomFormat" placeholder="Enter custom format" value="{{titleFormat}}">
            <small class="opacity50p" data-i18n="STMemoryBooks_TitleFormatDesc">Use [0], [00], [000] for auto-numbering. Available: \{{title}}, \{{scene}}, &#123;&#123;char}}, &#123;&#123;groupname}}, \{{present}}, &#123;&#123;user}}, \{{messages}}, \{{profile}}, &#123;&#123;date}}, &#123;&#123;time}}</small>
        </div>

        <div class="world_entry_form_control">
            <select id="stmb-profile-select" class="text_pole">
                {{#each profiles}}
                <option value="{{@index}}" {{#if isDefault}}selected{{/if}}>{{name}}{{#if isDefault}} (Default){{/if}}</option>
                {{/each}}
            </select>
        </div>

        <div id="stmb-profile-summary" class="padding10 marginBot10">
            <div class="marginBot5" data-i18n="STMemoryBooks_ProfileSettings">Profile Settings:</div>
            <div><span data-i18n="STMemoryBooks_Provider">Provider</span>: <span id="stmb-summary-api">{{selectedProfile.connection.api}}</span></div>
            <div><span data-i18n="STMemoryBooks_Model">Model</span>: <span id="stmb-summary-model">{{selectedProfile.connection.model}}</span></div>
            <div><span data-i18n="STMemoryBooks_Temperature">Temperature</span>: <span id="stmb-summary-temp">{{selectedProfile.connection.temperature}}</span></div>
            <div><span data-i18n="STMemoryBooks_TitleFormat">Title Format</span>: <span id="stmb-summary-title">{{selectedProfile.titleFormat}}</span></div>
            <details class="marginTop10">
                <summary data-i18n="STMemoryBooks_ViewPrompt">View Prompt</summary>
                <div class="padding10 marginTop5 stmb-box">
                    <pre><code id="stmb-summary-prompt">{{selectedProfile.effectivePrompt}}</code></pre>
                </div>
            </details>
        </div>

        <h4 class="stmb-section-title" data-i18n="STMemoryBooks_ProfileActions">Profile Actions:</h4>
        <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap" id="stmb-profile-buttons">
            <!-- Profile buttons will be dynamically inserted here -->
        </div>

        <h4 class="stmb-section-title" data-i18n="STMemoryBooks_extraFunctionButtons">Extra Function Buttons:</h4>
        <input type="file" id="stmb-import-file" accept=".json" class="displayNone">
        <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap" id="stmb-extra-function-buttons">
            <!-- extra function buttons will be dynamically inserted here -->
        </div>

        <h4 class="stmb-section-title" data-i18n="STMemoryBooks_promptManagerButtons">Settings</h4>

        <div class="info-block">
            <small class="opacity50p" data-i18n="STMemoryBooks_PromptManagerButtonsHint">Use the buttons below to explore customization options.</small>
            <div class="buttons_block marginTop5 justifyCenter gap10px whitespacenowrap" id="stmb-prompt-manager-buttons">
                <!-- prompt manager buttons will be dynamically inserted here -->
            </div>
        </div>

        {{/if}}
        <div class="stmb-original-actions" id="stmb-original-actions"></div>
        </section>
    </div>

`);

/** Automatic reminder controls are only shown in Automatic Memories. */
const automaticMemoryReminderSettingsFragment = `
    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" data-memory-reminder="automaticMemoryReminders" {{#if automaticMemoryReminders}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_Reminder_AutomaticEnabled">Turn on reminders for automatic memories</span>
        </label>
        <label>
            <span data-i18n="STMemoryBooks_Reminder_AutomaticInterval">Automatic reminder interval (messages)</span>
            <input type="number" class="text_pole" data-memory-reminder="automaticMemoryReminderInterval" value="{{automaticMemoryReminderInterval}}" min="1" step="1">
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_Reminder_AutomaticHelp">When auto-create is on, first remind at the message interval plus buffer plus this many messages, then repeat every this many additional messages. Always counts chat messages, even with token-triggered generation.</small>
    </div>
`;

const manualMemoryReminderSettingsFragment = `
    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" data-memory-reminder="manualMemoryReminders" {{#if manualMemoryReminders}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_Reminder_ManualEnabled">Turn on reminders to make memories manually</span>
        </label>
        <label>
            <span data-i18n="STMemoryBooks_Reminder_ManualInterval">Manual reminder interval (messages)</span>
            <input type="number" class="text_pole" data-memory-reminder="manualMemoryReminderInterval" value="{{manualMemoryReminderInterval}}" min="1" step="1">
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_Reminder_ManualHelp">When auto-create is off, remind after this many unprocessed chat messages, then repeat every this many additional messages.</small>
        <small class="opacity50p" data-i18n="STMemoryBooks_Reminder_CommonHelp">Reminders stay visible until dismissed and work independently of Show notifications.</small>
    </div>
`;

export const generalSettingsTemplate = Handlebars.compile(`
    <h3 class="stmb-section-title" data-i18n="STMemoryBooks_Preferences">General Settings</h3>
    ${manualMemoryReminderSettingsFragment}

    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-always-use-default" {{#if alwaysUseDefault}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_AlwaysUseDefault">Always use default profile (no confirmation prompt)</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-show-memory-previews" {{#if showMemoryPreviews}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_ShowMemoryPreviews;[title]STMemoryBooks_ShowMemoryPreviewsTooltip" title="Shows previews for memories and side prompts returned from the AI.">Show memory previews</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-show-consolidation-previews" {{#if showConsolidationPreviews}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_ShowConsolidationPreviews;[title]STMemoryBooks_ShowConsolidationPreviewsTooltip" title="Shows previews for consolidation summaries returned from the AI.">Show consolidation previews</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-show-notifications" {{#if showNotifications}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_ShowNotifications">Show notifications</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-show-floating-clip-button" {{#if showFloatingClipButton}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_ShowFloatingClipButton">Show floating Clip button when text is highlighted</span>
        </label>
        <label for="stmb-memory-boundary-mode">
            <span data-i18n="STMemoryBooks_MemoryBoundaryMode">Memory boundary indicator</span>
            <small class="opacity50p" data-i18n="STMemoryBooks_MemoryBoundaryModeDesc">Show a chat divider, a jump button, or both at the Memory Books processed boundary.</small>
            <select id="stmb-memory-boundary-mode" class="text_pole">
                {{#each memoryBoundaryModeOptions}}
                    <option value="{{value}}" {{#if isSelected}}selected{{/if}}>{{label}}</option>
                {{/each}}
            </select>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-allow-scene-overlap" {{#if allowSceneOverlap}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_AllowSceneOverlap;[title]STMemoryBooks_AllowSceneOverlapTooltip" title="By default, STMB avoids message ID overlap between memories. Select this box to skip that check.">Allow scene overlap</span>
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_AllowSceneOverlapDesc">Check this box to skip checking for overlapping memories/scenes.</small>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-refresh-editor" {{#if refreshEditor}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_RefreshEditor">Refresh lorebook editor after adding memories</span>
        </label>
        <div class="padding10 marginTop5 stmb-box">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-nexus-scene-rotation" {{#if nexusSceneRotationEnabled}}checked{{/if}}>
                <span data-i18n="STMemoryBooks_NexusRotationEnabled">🦥 Sloth · keep the three latest completed Scenes always on</span>
            </label>
            <small class="opacity50p" data-i18n="STMemoryBooks_NexusRotationHelp">For the original single-Scene tool. Manual collection with assigned Nexus and Memory roles always keeps the latest three completed Scenes active.</small>
            <label for="stmb-nexus-older-scene-mode">
                <span data-i18n="STMemoryBooks_NexusRecallMode">Older Scene recall</span>
                <select id="stmb-nexus-older-scene-mode" class="text_pole">
                    <option value="vector" {{#if (eq nexusOlderSceneMode "vector")}}selected{{/if}} data-i18n="STMemoryBooks_NexusRecallVector">Vector</option>
                    <option value="keyword" {{#if (eq nexusOlderSceneMode "keyword")}}selected{{/if}} data-i18n="STMemoryBooks_NexusRecallKeyword">Keywords (must already exist)</option>
                </select>
            </label>
        </div>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-copy-memory-books-on-branch" {{#if copyMemoryBooksOnBranch}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_CopyMemoryBooksOnBranch">Copy Memory Books when branching</span>
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_CopyMemoryBooksOnBranchDesc">When enabled, new chat branches receive independent copies of their active chat-bound or manual Memory Books.</small>
        <div class="padding10 marginTop5 stmb-box">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-auto-rollback-enabled" {{#if autoRollbackEnabled}}checked{{/if}}>
                <span data-i18n="STMemoryBooks_AutoRollbackEnabled">Auto-rollback after message deletion</span>
            </label>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoRollbackDesc">When deleted messages invalidate processed Memories, apply the selected rollback actions. Deleting Memories or consolidations is irreversible.</small>
            <div id="stmb-auto-rollback-options" class="padding10 {{#unless autoRollbackEnabled}}opacity50p{{/unless}}">
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-auto-rollback-update-last-processed" {{#if autoRollbackUpdateLastProcessed}}checked{{/if}} {{#unless autoRollbackEnabled}}disabled{{/unless}}>
                    <span data-i18n="STMemoryBooks_AutoRollbackUpdateLastProcessed">Update last message ID processed</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-auto-rollback-delete-last-memory" {{#if autoRollbackDeleteLastMemory}}checked{{/if}} {{#unless autoRollbackEnabled}}disabled{{/unless}}>
                    <span data-i18n="STMemoryBooks_AutoRollbackDeleteLastMemory">Delete last Memory</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-auto-rollback-restore-side-prompts" {{#if autoRollbackRestorePreviousSidePrompts}}checked{{/if}} {{#unless autoRollbackEnabled}}disabled{{/unless}}>
                    <span data-i18n="STMemoryBooks_AutoRollbackRestoreSidePrompts">Restore previous Side Prompts</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="stmb-auto-rollback-branches" {{#if autoRollbackApplyToBranches}}checked{{/if}} {{#unless autoRollbackEnabled}}disabled{{/unless}}>
                    <span data-i18n="STMemoryBooks_AutoRollbackBranches">Apply auto-rollback to branches/checkpoints</span>
                </label>
                <small class="opacity50p" data-i18n="STMemoryBooks_AutoRollbackBranchesDesc">When a branch or checkpoint is opened, roll back Memories beyond its retained messages. This requires independent Memory Book copies.</small>
                <small class="warning" data-i18n="STMemoryBooks_AutoRollbackSidePromptLimit">Side Prompts can be rolled back only once, to their latest exact saved state. Older rollback layers are not retained.</small>
            </div>
        </div>
    </div>

    <div class="world_entry_form_control">
        <h4 class="stmb-section-title" data-i18n="STMemoryBooks_GroupChatSettings">Group Chat</h4>
        <label class="checkbox_label" title="Filter group-chat memories to participating characters. When unchecked, use ordinary single-book processing without character filters, participant selection, character copies, or separate group/character prompts. Existing entries keep their filters until rewritten." data-i18n="[title]STMemoryBooks_CharacterAwareMemoriesTooltip">
            <input type="checkbox" id="stmb-character-aware-memories" {{#if characterAwareMemories}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_CharacterAwareMemories">character-aware memories</span>
        </label>
        <label class="checkbox_label" title="Use the group side-prompt default for automatic runs. When unchecked, inherit the solo default. Explicit per-chat selections still apply. Independent of character-aware memories." data-i18n="[title]STMemoryBooks_SeparateGroupSidePromptsTooltip">
            <input type="checkbox" id="stmb-use-separate-group-side-prompts" {{#if useSeparateGroupSidePrompts}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_SeparateGroupSidePrompts">Use separate group side prompts</span>
        </label>
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-auto-accept-group-participants" {{#if autoAcceptGroupParticipants}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_GroupParticipants_AutoAccept">Automatically accept detected participants in future</span>
        </label>
    </div>

    <div class="world_entry_form_control">
        <h4 data-i18n="STMemoryBooks_DefaultAfterMemorySidePromptSets">Default After-Memory Side Prompt Sets</h4>
        <small class="opacity50p" data-i18n="STMemoryBooks_DefaultAfterMemorySidePromptSetsHelp">Chats without a per-chat override inherit the matching default. An empty selection uses individually-enabled side prompts.</small>
        <label for="stmb-default-solo-side-prompt-set">
            <span data-i18n="STMemoryBooks_DefaultSoloSidePromptSet">Default for solo chats</span>
            <select id="stmb-default-solo-side-prompt-set" class="text_pole">
                {{#each defaultSoloSidePromptSetOptions}}
                    <option value="{{key}}" {{#if isSelected}}selected{{/if}}>{{name}}</option>
                {{/each}}
            </select>
        </label>
        <label for="stmb-default-group-side-prompt-set">
            <span data-i18n="STMemoryBooks_DefaultGroupSidePromptSet">Default for group chats</span>
            <select id="stmb-default-group-side-prompt-set" class="text_pole">
                {{#each defaultGroupSidePromptSetOptions}}
                    <option value="{{key}}" {{#if isSelected}}selected{{/if}}>{{name}}</option>
                {{/each}}
            </select>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-max-tokens">
            <h4 data-i18n="STMemoryBooks_MaxTokens">Max Response Tokens:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_MaxTokensDesc">Maximum number of tokens to use for memory summaries.</small>
            <input type="number" id="stmb-max-tokens" class="text_pole"
                value="{{maxTokens}}" min="0" step="1"
                placeholder="4000">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-token-warning-threshold">
            <h4 data-i18n="STMemoryBooks_TokenWarning">Token Warning Threshold:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_TokenWarningDesc">Show confirmation dialog when estimated input tokens exceed this threshold. Default: 30,000</small>
            <input type="number" id="stmb-token-warning-threshold" class="text_pole"
                value="{{tokenWarningThreshold}}" min="1000" max="200000" step="1000"
                placeholder="30000">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-default-memory-count">
            <h4 data-i18n="STMemoryBooks_DefaultMemoryCount">Default Previous Memories Count:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_DefaultMemoryCountDesc">Default number of previous memories to include as context when creating new memories.</small>
            <select id="stmb-default-memory-count" class="text_pole">
                <option value="0" {{#if (eq defaultMemoryCount 0)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount0">None (0 memories)</option>
                <option value="1" {{#if (eq defaultMemoryCount 1)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount1">Last 1 memory</option>
                <option value="2" {{#if (eq defaultMemoryCount 2)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount2">Last 2 memories</option>
                <option value="3" {{#if (eq defaultMemoryCount 3)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount3">Last 3 memories</option>
                <option value="4" {{#if (eq defaultMemoryCount 4)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount4">Last 4 memories</option>
                <option value="5" {{#if (eq defaultMemoryCount 5)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount5">Last 5 memories</option>
                <option value="6" {{#if (eq defaultMemoryCount 6)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount6">Last 6 memories</option>
                <option value="7" {{#if (eq defaultMemoryCount 7)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount7">Last 7 memories</option>
            </select>
        </label>
    </div>

    <hr class="marginTop10 marginBot10">

    <div class="world_entry_form_control flex-container">
        <div class="flex flexFlowRow alignItemsBaseline">
            <label class="checkbox_label">
                <input type="checkbox" id="stmb-use-regex" {{#if useRegex}}checked{{/if}}>
                <span data-i18n="STMemoryBooks_UseRegexAdvanced">Use regex (advanced)</span>
            </label>
        </div>
        <div class="flex flexFlowRow buttons_block marginTop5 justifyCenter gap10px whitespacenowrap">
            <button id="stmb-configure-regex" class="menu_button whitespacenowrap" style="{{#unless useRegex}}display:none;{{/unless}}" data-i18n="STMemoryBooks_ConfigureRegex">
                📐 Configure regex…
            </button>
        </div>
        <small class="opacity70p" data-i18n="STMemoryBooks_RegexSelection_Desc">Selecting a regex here will run it REGARDLESS of whether it is enabled or disabled.</small>
    </div>

    <h3 class="stmb-section-title" data-i18n="STMemoryBooks_TokenSaving">Token Saving (Hide/Unhide Messages)</h3>

    <div class="world_entry_form_control">
        <label for="stmb-auto-hide-mode">
            <h4 data-i18n="STMemoryBooks_AutoHideMode">Auto-hide messages after adding memory:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoHideModeDesc">Choose what messages to automatically hide after creating a memory.</small>
            <select id="stmb-auto-hide-mode" class="text_pole">
                <option value="none" {{#if (eq autoHideMode "none")}}selected{{/if}} data-i18n="STMemoryBooks_AutoHideNone">Do not auto-hide</option>
                <option value="all" {{#if (eq autoHideMode "all")}}selected{{/if}} data-i18n="STMemoryBooks_AutoHideAll">Auto-hide all messages up to the last memory</option>
                <option value="last" {{#if (eq autoHideMode "last")}}selected{{/if}} data-i18n="STMemoryBooks_AutoHideLast">Auto-hide only messages in the last memory</option>
            </select>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-unhidden-entries-count">
            <h4 data-i18n="STMemoryBooks_UnhiddenCount">Messages to leave unhidden:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_UnhiddenCountDesc">Number of recent messages to leave visible when auto-hiding (0 = hide all up to scene end)</small>
            <input type="number" id="stmb-unhidden-entries-count" class="text_pole"
                value="{{unhiddenEntriesCount}}" min="0" max="50" step="1"
                placeholder="2">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-unhide-before-memory" {{#if unhideBeforeMemory}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_UnhideBeforeMemory">Unhide hidden messages for memory generation (runs /unhide X-Y)</span>
        </label>
    </div>
    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-topical-clip-include-hidden-messages" {{#if topicalClipIncludeHiddenMessages}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_TopicalClip_IncludeHiddenMessages">Also use hidden messages</span>
        </label>
    </div>
`);

/**
 * Automatic memories settings popup template
 */
export const automaticMemoriesSettingsTemplate = Handlebars.compile(`
    <h3 class="stmb-section-title" data-i18n="STMemoryBooks_AutoMemory">Automatic Memories</h3>
    ${automaticMemoryReminderSettingsFragment}
    ${manualMemoryReminderSettingsFragment}

    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-auto-summary-enabled" {{#if autoSummaryEnabled}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_AutoSummaryEnabled">Auto-create memory summaries</span>
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_AutoSummaryDesc;[title]STMemoryBooks_AutoSummaryWarnTooltip" title="Warning: enabling Auto-Summary may create one large memory from the existing backlog. Use /stmb-set-highest &lt;N|none&gt; to control the baseline.">Automatically run /nextmemory after a specified number of messages.</small>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-auto-summary-trigger-mode">
            <h4 data-i18n="STMemoryBooks_AutoSummaryTriggerMode">Auto-Summary Trigger:</h4>
            <select id="stmb-auto-summary-trigger-mode" class="text_pole">
                <option value="messages" data-i18n="STMemoryBooks_Messages" {{#if autoSummaryTriggerMessages}}selected{{/if}}>Messages</option>
                <option value="tokens" data-i18n="STMemoryBooks_Tokens" {{#if autoSummaryTriggerTokens}}selected{{/if}}>Tokens</option>
            </select>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-auto-summary-token-threshold">
            <h4 data-i18n="STMemoryBooks_AutoSummaryTokenThreshold">Auto-Summary Token Threshold:</h4>
            <input type="number" id="stmb-auto-summary-token-threshold" class="text_pole" value="{{autoSummaryTokenThreshold}}" min="1" max="1000000" step="1">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-auto-summary-interval">
            <h4 data-i18n="STMemoryBooks_AutoSummaryInterval">Auto-Summary Interval:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoSummaryIntervalDesc">Number of messages after which to automatically create a memory summary.</small>
            <input type="number" id="stmb-auto-summary-interval" class="text_pole"
                value="{{autoSummaryInterval}}" min="5" max="200" step="1"
                placeholder="50">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-auto-summary-buffer">
            <h4 data-i18n="STMemoryBooks_AutoSummaryBuffer">Auto-Summary Buffer:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoSummaryBufferDesc">Delay auto-summary by X messages (belated generation). Default 2, max 50.</small>
            <input type="number" id="stmb-auto-summary-buffer" class="text_pole"
                value="{{autoSummaryBuffer}}" min="0" max="50" step="1" placeholder="0">
        </label>
    </div>

    <div class="world_entry_form_control">
        <label class="checkbox_label">
            <input type="checkbox" id="stmb-auto-consolidation-prompt-enabled" {{#if autoConsolidationPromptEnabled}}checked{{/if}}>
            <span data-i18n="STMemoryBooks_AutoConsolidationEnabled">Prompt for consolidation when a tier is ready</span>
        </label>
        <small class="opacity50p" data-i18n="STMemoryBooks_AutoConsolidationDesc">Shows a yes/no prompt when any selected summary tier has enough eligible source entries. Uses each tier's saved minimum.</small>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-auto-consolidation-target-tier">
            <h4 data-i18n="STMemoryBooks_AutoConsolidationTier">Auto-Consolidation Tiers:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_AutoConsolidationTierDesc">Choose which summary tiers should trigger the confirmation prompt.</small>
        </label>
    </div>

    <select id="stmb-auto-consolidation-target-tier" class="text_pole" multiple size="6">
        {{#each autoConsolidationTierOptions}}
        <option value="{{value}}" {{#if isSelected}}selected{{/if}}>{{label}}</option>
        {{/each}}
    </select>
`);

/**
 * Simplified confirmation popup template
 */
export const simpleConfirmationTemplate = Handlebars.compile(`
    <h3 data-i18n="STMemoryBooks_CreateMemory">Create Memory</h3>
    <div id="stmb-scene" class="padding10 marginBot10">
        <div class="marginBot5" data-i18n="STMemoryBooks_ScenePreview">Scene Preview:</div>
        <div class="padding10 marginTop5 stmb-box">
            <pre><code id="stmb-scene-block"><span data-i18n="STMemoryBooks_Start">Start</span>: <span data-i18n="STMemoryBooks_Message">Message</span> #{{sceneStart}} ({{startSpeaker}})
{{startExcerpt}}

<span data-i18n="STMemoryBooks_End">End</span>: <span data-i18n="STMemoryBooks_Message">Message</span> #{{sceneEnd}} ({{endSpeaker}})
{{endExcerpt}}

<span data-i18n="STMemoryBooks_Messages">Messages</span>: {{messageCount}} | <span data-i18n="STMemoryBooks_EstimatedTokens">Estimated tokens</span>: {{estimatedTokens}}</code></pre>
        </div>
    </div>

    <div class="world_entry_form_control">
        <h5><span data-i18n="STMemoryBooks_UsingProfile">Using Profile</span>: <span class="success">{{profileName}}</span></h5>

        <div id="stmb-profile-summary" class="padding10 marginBot10">
            <div class="marginBot5" data-i18n="STMemoryBooks_ProfileSettings">Profile Settings:</div>
            <div><span data-i18n="STMemoryBooks_Model">Model</span>: <span id="stmb-summary-model">{{profileModel}}</span></div>
            <div><span data-i18n="STMemoryBooks_Temperature">Temperature</span>: <span id="stmb-summary-temp">{{profileTemperature}}</span></div>
            <details class="marginTop10">
                <summary data-i18n="STMemoryBooks_ViewPrompt">View Prompt</summary>
                <div class="padding10 marginTop5 stmb-box">
                    <pre><code id="stmb-summary-prompt">{{effectivePrompt}}</code></pre>
                </div>
            </details>
        </div>
    </div>

    {{#if showWarning}}
    <div class="info-block warning marginTop10">
        ⚠️ <span data-i18n="STMemoryBooks_LargeSceneWarning">Large scene</span> ({{estimatedTokens}} tokens) <span data-i18n="STMemoryBooks_MayTakeTime">may take some time to process.</span>
    </div>
    {{/if}}

    <div class="marginTop10 opacity50p fontsize90p" data-i18n="STMemoryBooks_AdvancedOptionsHint">
        Click "Advanced Options" to customize prompt, context memories, or API settings.
    </div>
`);

/**
 * Advanced options popup template
 */
export const advancedOptionsTemplate = Handlebars.compile(`
    <h3 data-i18n="STMemoryBooks_AdvancedOptions">Advanced Memory Options</h3>
    <div class="world_entry_form_control">
        <h4 data-i18n="STMemoryBooks_SceneInformation">Scene Information:</h4>
        <div class="padding10 marginBot15" style="background-color: var(--SmartThemeBlurTintColor); border-radius: 5px;">
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Messages">Messages</span> {{sceneStart}}-{{sceneEnd}} ({{messageCount}} <span data-i18n="STMemoryBooks_Total">total</span>)</div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_BaseTokens">Base tokens</span>: {{estimatedTokens}}</div>
            <div class="fontsize90p" id="stmb-total-tokens-display"><span data-i18n="STMemoryBooks_TotalTokens">Total tokens</span>: {{estimatedTokens}}</div>
        </div>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-profile-select-advanced">
            <h4 data-i18n="STMemoryBooks_Profile">Profile:</h4>
            <small data-i18n="STMemoryBooks_ChangeProfileDesc">Change the profile to use different base settings.</small>
            <select id="stmb-profile-select-advanced" class="text_pole">
                {{#each profiles}}
                <option value="{{@index}}" {{#if isDefault}}selected{{/if}}>{{name}}{{#if isDefault}} (Default){{/if}}</option>
                {{/each}}
            </select>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-effective-prompt-advanced">
            <h4 data-i18n="STMemoryBooks_MemoryCreationPrompt">Memory Creation Prompt:</h4>
            <small data-i18n="STMemoryBooks_CustomizePromptDesc">Customize the prompt used to generate this memory.</small>
            <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-effective-prompt-advanced" title="Expand the editor" data-i18n="[title]STMemoryBooks_ExpandEditor"></i>
            <textarea id="stmb-effective-prompt-advanced" class="text_pole textarea_compact" rows="6" data-i18n="[placeholder]STMemoryBooks_MemoryPromptPlaceholder" placeholder="Memory creation prompt">{{effectivePrompt}}</textarea>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-context-memories-advanced">
            <h4 data-i18n="STMemoryBooks_IncludePreviousMemories">Include Previous Memories as Context:</h4>
            <small>
                <span data-i18n="STMemoryBooks_PreviousMemoriesDesc">Previous memories provide context for better continuity.</span>
                {{#if availableMemories}}
                <br><span data-i18n="STMemoryBooks_Found">Found</span> {{availableMemories}} {{#if (eq availableMemories 1)}}<span data-i18n="STMemoryBooks_ExistingMemorySingular">existing memory in lorebook.</span>{{else}}<span data-i18n="STMemoryBooks_ExistingMemoriesPlural">existing memories in lorebook.</span>{{/if}}
                {{else}}
                <br><span data-i18n="STMemoryBooks_NoMemoriesFound">No existing memories found in lorebook.</span>
                {{/if}}
            </small>
            <select id="stmb-context-memories-advanced" class="text_pole">
                <option value="0" {{#if (eq defaultMemoryCount 0)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount0">None (0 memories)</option>
                <option value="1" {{#if (eq defaultMemoryCount 1)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount1">Last 1 memory</option>
                <option value="2" {{#if (eq defaultMemoryCount 2)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount2">Last 2 memories</option>
                <option value="3" {{#if (eq defaultMemoryCount 3)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount3">Last 3 memories</option>
                <option value="4" {{#if (eq defaultMemoryCount 4)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount4">Last 4 memories</option>
                <option value="5" {{#if (eq defaultMemoryCount 5)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount5">Last 5 memories</option>
                <option value="6" {{#if (eq defaultMemoryCount 6)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount6">Last 6 memories</option>
                <option value="7" {{#if (eq defaultMemoryCount 7)}}selected{{/if}} data-i18n="STMemoryBooks_MemoryCount7">Last 7 memories</option>
            </select>
        </label>
    </div>

    <div class="world_entry_form_control">
        <h4 data-i18n="STMemoryBooks_APIOverride">API Override Settings:</h4>

        <div class="padding10 marginBot10" style="background-color: var(--SmartThemeBlurTintColor); border-radius: 5px; filter: brightness(1.2);">
            <div class="marginBot5" data-i18n="STMemoryBooks_ProfileSettings">Profile Settings:</div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Model">Model</span>: <span class="success" id="stmb-profile-model-display">{{profileModel}}</span></div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Temperature">Temperature</span>: <span class="success" id="stmb-profile-temp-display">{{profileTemperature}}</span></div>
        </div>

        <div class="padding10 marginBot10" style="background-color: var(--SmartThemeBlurTintColor); border-radius: 5px;">
            <div class="marginBot5" data-i18n="STMemoryBooks_CurrentSTSettings">Current SillyTavern Settings:</div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Model">Model</span>: <span style="color: var(--SmartThemeQuoteColor);">{{currentModel}}</span></div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Temperature">Temperature</span>: <span style="color: var(--SmartThemeQuoteColor);">{{currentTemperature}}</span></div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_API">API</span>: <span style="color: var(--SmartThemeQuoteColor);">{{currentApi}}</span></div>
        </div>

        <label class="checkbox_label">
            <input type="checkbox" id="stmb-override-settings-advanced">
            <span data-i18n="STMemoryBooks_UseCurrentSettings">Use current SillyTavern settings instead of profile settings</span>
        </label>
        <small class="opacity50p marginTop5" data-i18n="STMemoryBooks_OverrideDesc">
            Override the profile's model and temperature with your current SillyTavern settings.
        </small>
    </div>

    <div class="world_entry_form_control displayNone" id="stmb-save-profile-section-advanced">
        <h4 data-i18n="STMemoryBooks_SaveAsNewProfile">Save as New Profile:</h4>
        <label for="stmb-new-profile-name-advanced">
            <h4 data-i18n="STMemoryBooks_ProfileName">Profile Name:</h4>
            <small data-i18n="STMemoryBooks_SaveProfileDesc">Your current settings differ from the selected profile. Save them as a new profile.</small>
            <input type="text" id="stmb-new-profile-name-advanced" class="text_pole" data-i18n="[placeholder]STMemoryBooks_EnterProfileName" placeholder="Enter new profile name" value="{{suggestedProfileName}}">
        </label>
    </div>

    {{#if showWarning}}
    <div class="info-block warning marginTop10" id="stmb-token-warning-advanced">
        <span data-i18n="STMemoryBooks_LargeSceneWarningShort">⚠️ Large scene may take some time to process.</span>
    </div>
    {{/if}}
`);

/**
 * Memory preview dialog template
 */
export const memoryPreviewTemplate = Handlebars.compile(`
    <h3 data-i18n="STMemoryBooks_MemoryPreview">📖 Memory Preview</h3>
    <div class="world_entry_form_control">
        <small class="marginBot10" data-i18n="STMemoryBooks_MemoryPreviewDesc">Review the generated memory below. You can edit the content while preserving the structure.</small>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-preview-title">
            <h4 data-i18n="STMemoryBooks_MemoryTitle">Memory Title:</h4>
            <input type="text" id="stmb-preview-title" class="text_pole" value="{{#if title}}{{title}}{{else}}Memory{{/if}}" data-i18n="[placeholder]STMemoryBooks_MemoryTitlePlaceholder" placeholder="Memory title" {{#if titleReadonly}}readonly disabled{{/if}}>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-preview-content">
            <h4 data-i18n="STMemoryBooks_MemoryContent">Memory Content:</h4>
            <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-preview-content" title="Expand the editor" data-i18n="[title]STMemoryBooks_ExpandEditor"></i>
            <textarea id="stmb-preview-content" class="text_pole textarea_compact" rows="8" data-i18n="[placeholder]STMemoryBooks_MemoryContentPlaceholder" placeholder="Memory content">{{#if content}}{{content}}{{else}}{{/if}}</textarea>
        </label>
    </div>

    <div class="world_entry_form_control">
        <label for="stmb-preview-keywords">
            <h4 data-i18n="STMemoryBooks_Keywords">Keywords:</h4>
            <small class="opacity50p" data-i18n="STMemoryBooks_KeywordsDesc">Separate keywords with commas</small>
            <input type="text" id="stmb-preview-keywords" class="text_pole" value="{{#if keywordsText}}{{keywordsText}}{{else}}{{/if}}" data-i18n="[placeholder]STMemoryBooks_KeywordsPlaceholder" placeholder="keyword1, keyword2, keyword3">
        </label>
    </div>

    <div class="world_entry_form_control">
        <h4 data-i18n="STMemoryBooks_SceneInformation">Scene Information:</h4>
        <div class="padding10 marginBot10 stmb-box">
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Messages">Messages</span>: {{#if sceneStart}}{{sceneStart}}{{else}}?{{/if}}-{{#if sceneEnd}}{{sceneEnd}}{{else}}?{{/if}} ({{#if messageCount}}{{messageCount}}{{else}}?{{/if}} <span data-i18n="STMemoryBooks_Total">total</span>)</div>
            <div class="fontsize90p"><span data-i18n="STMemoryBooks_Profile">Profile</span>: {{#if profileName}}{{profileName}}{{else}}<span data-i18n="STMemoryBooks_UnknownProfile">Unknown Profile</span>{{/if}}</div>
        </div>
    </div>
`);

/**
 * Consolidation preview dialog template
 */
export const consolidationPreviewTemplate = Handlebars.compile(`
    <h3 data-i18n="STMemoryBooks_ConsolidationPreview_Title">Consolidation Preview</h3>
    <div class="world_entry_form_control">
        <small class="marginBot10" data-i18n="STMemoryBooks_ConsolidationPreview_Desc">Review generated summaries before saving. You can edit title, summary, and keywords.</small>
    </div>

    {{#if ambiguousAssignments}}
    <div class="info-block warning marginBot10" data-i18n="STMemoryBooks_ConsolidationPreview_AmbiguousAssignments">
        Multiple consolidation returned more than one summary but the memory assignments were not clearly stated and it is not known which memories belong to which summary. Individual summary edit/accept is not available--the entire batch must be approved or rejected for regeneration.
    </div>
    {{/if}}

    {{#if lockedCount}}
    <div class="info-block marginBot10">
        <span data-i18n="STMemoryBooks_ConsolidationPreview_BankedCount">Already accepted summaries</span>: {{lockedCount}}
    </div>
    {{/if}}

    <div class="stmb-consolidation-preview-list">
        {{#each summaries}}
        <div class="world_entry_form_control stmb-consolidation-preview-card" data-summary-index="{{index}}">
            <h4>{{tierLabel}} {{displayNumber}}</h4>

            {{#if ../allowIndividualActions}}
            <div class="flex flexFlowRow gap10px marginBot10">
                <label class="checkbox_label">
                    <input type="radio" name="stmb-consolidation-action-{{index}}" value="accept" checked>
                    <span data-i18n="STMemoryBooks_ConsolidationPreview_AcceptSummary">Accept this summary</span>
                </label>
                <label class="checkbox_label">
                    <input type="radio" name="stmb-consolidation-action-{{index}}" value="reject">
                    <span data-i18n="STMemoryBooks_ConsolidationPreview_RegenerateSummary">Regenerate consolidation with the same memories</span>
                </label>
            </div>
            {{/if}}

            <label>
                <h4 data-i18n="STMemoryBooks_ConsolidationPreview_SummaryTitle">Summary Title:</h4>
                <input type="text" class="text_pole stmb-consolidation-preview-title" value="{{title}}" data-i18n="[placeholder]STMemoryBooks_ConsolidationPreview_TitlePlaceholder" placeholder="Summary title">
            </label>

            <label>
                <h4 data-i18n="STMemoryBooks_ConsolidationPreview_SummaryContent">Summary Content:</h4>
                <i class="editor_maximize fa-solid fa-maximize right_menu_button" data-for="stmb-consolidation-preview-content-{{index}}" title="Expand the editor" data-i18n="[title]STMemoryBooks_ExpandEditor"></i>
                <textarea id="stmb-consolidation-preview-content-{{index}}" class="text_pole textarea_compact stmb-consolidation-preview-content" rows="8" data-i18n="[placeholder]STMemoryBooks_ConsolidationPreview_ContentPlaceholder" placeholder="Summary content">{{summary}}</textarea>
            </label>

            <label>
                <h4 data-i18n="STMemoryBooks_Keywords">Keywords:</h4>
                <small class="opacity50p" data-i18n="STMemoryBooks_KeywordsDesc">Separate keywords with commas</small>
                <input type="text" class="text_pole stmb-consolidation-preview-keywords" value="{{keywordsText}}" data-i18n="[placeholder]STMemoryBooks_KeywordsPlaceholder" placeholder="keyword1, keyword2, keyword3">
            </label>

            <details class="marginTop10">
                <summary data-i18n="STMemoryBooks_ConsolidationPreview_AssignedMemories">Assigned source memories</summary>
                <div class="padding10 marginTop5 stmb-box">
                    {{#if sources.length}}
                    {{#each sources}}
                    <div class="marginBot10">
                        <strong>{{title}}</strong>
                        <div class="opacity70p fontsize90p">{{excerpt}}</div>
                    </div>
                    {{/each}}
                    {{else}}
                    <div class="opacity70p" data-i18n="STMemoryBooks_ConsolidationPreview_NoAssignedMemories">No assigned source memories found.</div>
                    {{/if}}
                </div>
            </details>
        </div>
        {{/each}}
    </div>

    {{#if pendingCount}}
    <div class="info-block marginTop10">
        <span data-i18n="STMemoryBooks_ConsolidationPreview_PendingCount">Pending source memories after this round</span>: {{pendingCount}}
    </div>
    {{/if}}
`);
